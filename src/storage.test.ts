import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { createEvent, createNapEvent } from './domain.ts';
import { csvToEvents, eventsToCsv } from './export.ts';

const eventsKey = 'puptime.events.v1';
const stored = new Map<string, string>();
let writes = 0;
let failedWrites = 0;
const backend = {
  async getItem(key: string) {
    return stored.get(key) ?? null;
  },
  async setItem(key: string, value: string) {
    writes += 1;
    if (failedWrites > 0) {
      failedWrites -= 1;
      throw new Error('Storage is full');
    }
    stored.set(key, value);
  },
};

Reflect.set(globalThis, '__puptimeTestStorage', backend);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === '@react-native-async-storage/async-storage'
      ? { url: 'puptime-storage-test:async-storage', shortCircuit: true }
      : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url === 'puptime-storage-test:async-storage'
      ? { format: 'module', source: 'export default globalThis.__puptimeTestStorage;', shortCircuit: true }
      : nextLoad(url, context);
  },
});
const storage = await import('./storage.ts');
hooks.deregister();

test('event persistence keeps failed writes isolated and imports without losing saved data', async (t) => {
  const first = { ...createEvent('pee', 'app', 100), id: 'first' };
  const second = { ...createEvent('meal', 'widget', 200), id: 'second' };

  await t.test('successful append, update and remove return committed events', async () => {
    stored.clear();
    assert.deepEqual(await storage.loadEvents(), []);
    assert.deepEqual(await storage.appendEvents([first, second]), [second, first]);
    assert.deepEqual(await storage.updateEvent('first', { at: 300, note: 'Edited' }), [
      { ...first, at: 300, note: 'Edited' }, second,
    ]);
    assert.deepEqual(await storage.removeEvent('second'), [{ ...first, at: 300, note: 'Edited' }]);
    assert.deepEqual(await storage.loadEvents(), [{ ...first, at: 300, note: 'Edited' }]);
  });

  await t.test('a failed write rejects that caller and the queued next write still succeeds', async () => {
    stored.clear();
    failedWrites = 1;
    const failed = storage.appendEvents([first]);
    const retry = storage.appendEvents([second]);
    await assert.rejects(failed, /Storage is full/);
    assert.deepEqual(await retry, [second]);
    assert.deepEqual(await storage.loadEvents(), [second]);
  });

  await t.test('corrupt JSON or invalid saved events cannot be overwritten by any event write', async () => {
    for (const raw of ['{broken', '', 'null', '{}', '[{"id":"first"}]', JSON.stringify([first, first])]) {
      stored.set(eventsKey, raw);
      const before = writes;
      await assert.rejects(storage.loadEvents(), storage.EventsStorageError);
      await assert.rejects(storage.appendEvents([second]), storage.EventsStorageError);
      await assert.rejects(storage.updateEvent('first', { note: 'Overwrite' }), storage.EventsStorageError);
      await assert.rejects(storage.removeEvent('first'), storage.EventsStorageError);
      await assert.rejects(storage.importEvents([second]), storage.EventsStorageError);
      assert.equal(stored.get(eventsKey), raw);
      assert.equal(writes, before);
    }
    stored.set(eventsKey, JSON.stringify([first]));
    assert.deepEqual(await storage.appendEvents([second]), [second, first]);
  });

  await t.test('import skips existing IDs, preserves newer edits, and duplicate reimports do not write', async () => {
    const edited = { ...first, note: 'Keep the current edit', at: 250 };
    stored.set(eventsKey, JSON.stringify([edited]));
    assert.deepEqual(await storage.importEvents([first, second]), {
      events: [edited, second], imported: 1, skipped: 1,
    });
    const before = writes;
    assert.deepEqual(await storage.importEvents([first, second]), {
      events: [edited, second], imported: 0, skipped: 2,
    });
    assert.equal(writes, before);
  });

  await t.test('an invalid event anywhere in an import rejects the whole batch before writing', async () => {
    stored.set(eventsKey, JSON.stringify([first]));
    const raw = stored.get(eventsKey);
    const before = writes;
    for (const invalid of [
      { ...second, id: '   ' },
      { ...second, at: NaN },
      { ...second, at: Infinity },
      { ...second, at: 0.5 },
      { ...second, endedAt: 300 },
      { ...second, note: 42 },
      { ...second, estimated: 'yes' },
      { ...createNapEvent('app', 200), endedAt: 100 },
    ]) {
      await assert.rejects(storage.importEvents([second, invalid] as Parameters<typeof storage.importEvents>[0]), TypeError);
      assert.equal(stored.get(eventsKey), raw);
    }
    await assert.rejects(storage.importEvents([second, second]), TypeError);
    assert.equal(writes, before);
  });

  await t.test('import rejects conflicting open naps without writing other additions', async () => {
    const nap = { ...createNapEvent('app', 300), id: 'nap' };
    stored.set(eventsKey, JSON.stringify([nap]));
    const raw = stored.get(eventsKey);
    const before = writes;
    await assert.rejects(storage.importEvents([second, createNapEvent('app', 400)]), storage.EventsImportError);
    assert.equal(stored.get(eventsKey), raw);
    assert.equal(writes, before);
    assert.deepEqual(await storage.importEvents([{ ...nap, endedAt: 500 }, second]), {
      events: [nap, second], imported: 1, skipped: 1,
    });
  });

  await t.test('widget upserts and editing cannot remove stored estimate provenance', async () => {
    const nap = { ...createNapEvent('app', 300), id: 'estimated-nap', estimated: true, note: 'Keep the nap note' };
    stored.set(eventsKey, JSON.stringify([nap]));
    const widgetCompletion = { ...createNapEvent('widget', 300), id: nap.id, endedAt: 500 };
    assert.deepEqual(await storage.appendEvents([widgetCompletion]), [{ ...widgetCompletion, estimated: true, note: nap.note }]);
    assert.deepEqual(await storage.updateEvent(nap.id, { note: 'Revised' }), [
      { ...widgetCompletion, estimated: true, note: 'Revised' },
    ]);
  });

  await t.test('a CSV backup restores deleted history without replacing newer records', async () => {
    const nap = { ...createNapEvent('app', 300), id: 'backup-nap', endedAt: 600, estimated: true };
    const custom = { ...createEvent('custom', 'widget', 400, '训练, play'), id: 'backup-custom', note: 'Line one\n"Line two"' };
    const backup = csvToEvents(eventsToCsv([first, nap, custom]));
    const edited = { ...first, note: 'Newer than the backup', at: 500 };
    stored.set(eventsKey, JSON.stringify([edited]));
    const result = await storage.importEvents(backup);
    assert.equal(result.imported, 2);
    assert.equal(result.skipped, 1);
    assert.deepEqual(await storage.loadEvents(), [edited, custom, nap]);
    assert.deepEqual(await storage.importEvents(backup), {
      events: [edited, custom, nap], imported: 0, skipped: 3,
    });
  });
});


test('removed theme preferences fall back to default without touching activity data', async () => {
  stored.clear();
  const events = JSON.stringify([createEvent('pee', 'app', 100)]);
  stored.set(eventsKey, events);
  for (const theme of ['meadow', 'sunrise', 'midnight', 'paper', 'bubblegum', 'blueprint', 'trail', 'tide', 'plum', 'contrast']) {
    stored.set('puptime.theme.v1', theme);
    assert.equal(await storage.loadThemePreference(), 'system');
    assert.equal(stored.get(eventsKey), events);
  }
  for (const theme of ['system', 'puppy-journal', 'soft-play', 'day-trails'] as const) {
    await storage.saveThemePreference(theme);
    assert.equal(await storage.loadThemePreference(), theme);
  }
});
