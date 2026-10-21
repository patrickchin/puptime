import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivityBackups, type BackupFiles } from './activity-backups.ts';
import { createLocalDatabase, initializeLocalDatabase } from './database.ts';
import { sqliteTestConnection } from './sqlite-test-adapter.ts';
import { createLocalRuntime } from './runtime-factory.ts';
import type { PuppyEvent } from '../domain.ts';

function fixture() {
  const disk = new Map<string, string>(); let time = new Date(2026, 9, 1, 12).getTime(), sequence = 0, reads = 0;
  let events: PuppyEvent[] = [{ id: 'evt_first', type: 'pee', at: time, source: 'app', note: '小狗 🐾' }];
  const files: BackupFiles = {
    async list() { return [...disk].map(([id, text]) => ({ id, bytes: Buffer.byteLength(text) })); },
    async read(id) { if (!disk.has(id)) throw new Error('missing'); return disk.get(id)!; },
    async write(id, text) { disk.set(id, text); }, async remove(id) { disk.delete(id); },
  };
  const options = { files, petId: 'pet_test', newId: () => `bkp_${(++sequence).toString(16).padStart(32, '0')}`, now: () => time,
    read: async () => { reads++; return { events, puppyName: 'Mochi 🐾' }; }, restore: async () => ({ imported: 0, skipped: 0 }) };
  return { disk, files, options, service: createActivityBackups(options), advance() { time += 86400000; },
    events(value: PuppyEvent[]) { events = value; }, reads: () => reads };
}

test('daily snapshots are compact, immutable, restart-safe, serial and retain 30 nonempty days', async () => {
  const f = fixture(); await Promise.all(Array.from({ length: 10 }, () => f.service.capture()));
  assert.equal(f.disk.size, 1); assert.equal(f.reads(), 1);
  const first = [...f.disk.values()][0]; assert.ok(Buffer.byteLength(first) < 400); assert.ok(first.includes('小狗 🐾'));
  f.events([]); await createActivityBackups(f.options).capture(); assert.equal(f.reads(), 1);
  f.advance(); await f.service.capture(); assert.equal(f.disk.size, 1);
  for (let index = 0; index < 35; index++) {
    f.advance(); f.events([{ id: `evt_${index}`, type: 'meal', at: f.options.now(), source: 'widget', estimated: true }]);
    await f.service.capture();
  }
  const { backups } = await f.service.list(); assert.equal(backups.length, 30); assert.equal(f.disk.size, 30);
  assert.ok(![...f.disk.values()].includes(first));
  assert.ok(backups[0].createdAt > backups[29].createdAt);
  // A recreated database can still discover snapshots from the previous puppy ID.
  const reset = createActivityBackups({ ...f.options, petId: 'pet_reset' });
  assert.equal((await reset.list()).backups.length, 30);
});

test('failed writes, corrupt snapshots and unrelated files preserve prior backups and allow retry', async () => {
  const f = fixture(); await f.service.capture(); const before = new Map(f.disk); f.advance();
  const broken = createActivityBackups({ ...f.options, files: { ...f.files, async write() { throw new Error('disk full'); } } });
  await assert.rejects(broken.capture(), /disk full/); assert.deepEqual(f.disk, before);
  await f.service.capture(); assert.equal(f.disk.size, 2);
  const damaged = 'bkp_ffffffffffffffffffffffffffffffff.json'; f.disk.set(damaged, '{broken'); f.disk.set('unrelated.json', '{}');
  assert.equal((await f.service.list()).unreadable, 1);
  await assert.rejects(f.service.restore(damaged));
  await assert.rejects(f.service.read('../data.db'));
  f.advance(); await f.service.capture(); assert.equal(f.disk.get(damaged), '{broken'); assert.ok(f.disk.has('unrelated.json'));
});

test('SQLite recovery restores exact activity fields, preserves edits, deduplicates and rolls back nap conflicts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'puptime-backup-'));
  const database = await createLocalDatabase(sqliteTestConnection(join(directory, 'data.db')));
  t.after(async () => { await database.close(); await rm(directory, { recursive: true, force: true }); });
  const { petId } = await initializeLocalDatabase(database, () => 'pet_test');
  const { storage, recoverEvents } = await createLocalRuntime(database, petId), f = fixture();
  const events: PuppyEvent[] = [
    { id: 'evt_pee', type: 'pee', at: 1000, source: 'widget', note: 'Original' },
    { id: 'evt_custom', type: 'custom', customLabel: 'Training', at: 2000, source: 'app', estimated: true, note: '小狗 🐾' },
    { id: 'evt_nap', type: 'nap', at: 3000, endedAt: null, source: 'app' },
  ];
  await storage.appendEvents(events);
  const service = createActivityBackups({ ...f.options, read: async () => ({ events: await storage.loadEvents(), puppyName: 'Mochi' }), restore: recoverEvents });
  await service.capture(); const id = (await service.list()).backups[0].id;
  await storage.updateEvent('evt_pee', { note: 'Current edit' }); await storage.removeEvent('evt_custom'); await storage.removeEvent('evt_nap');
  assert.deepEqual(await service.restore(id), { imported: 2, skipped: 1 });
  const saved = await storage.loadEvents();
  assert.deepEqual(saved.find(event => event.id === 'evt_custom'), events[1]);
  assert.deepEqual(saved.find(event => event.id === 'evt_nap'), events[2]);
  assert.equal(saved.find(event => event.id === 'evt_pee')!.note, 'Current edit');
  assert.deepEqual(await service.restore(id), { imported: 0, skipped: 3 });
  await storage.removeEvent('evt_custom'); await storage.removeEvent('evt_nap');
  await storage.appendEvents([{ id: 'evt_current_nap', type: 'nap', at: 4000, endedAt: null, source: 'app' }]);
  const before = await storage.loadEvents(); await assert.rejects(service.restore(id)); assert.deepEqual(await storage.loadEvents(), before);
});
