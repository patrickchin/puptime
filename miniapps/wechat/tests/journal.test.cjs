const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const storage = new Map();
let failWrites = false;
global.wx = {
  getStorageSync: key => storage.has(key) ? structuredClone(storage.get(key)) : '',
  setStorageSync(key, value) { if (failWrites) throw Error('quota'); storage.set(key, structuredClone(value)); },
  getRandomValues({ length, success }) { const bytes = crypto.randomBytes(length); success({ randomValues: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }); },
  getAppBaseInfo: () => ({ language: 'en' }),
  setTabBarItem() {}, vibrateShort() {},
};
const j = require('../app/utils/journal');
const { copy } = require('../app/utils/copy');
beforeEach(() => { storage.clear(); failWrites = false; });

test('log/edit/delete survives reopening; failures preserve the last persisted journal', async () => {
  let state = await j.add(j.read(), 'pee', Date.now() - 90000);
  const event = state.events[0];
  assert.match(event.id, /^evt_[a-f0-9]{32}$/);
  assert.deepEqual(j.read(), state);
  state = j.change(state, event.id, { note: 'After breakfast' });
  assert.equal(j.read().events[0].note, 'After breakfast');
  failWrites = true;
  await assert.rejects(j.add(state, 'meal'), /quota/);
  assert.equal(j.read().events.length, 1);
  assert.equal(j.read().events[0].note, 'After breakfast');
  failWrites = false;
  j.remove(state, event.id);
  assert.equal(j.read().events.length, 0);
});

test('sample history is isolated from personal logs; totals reconcile and only edited row is patched', async () => {
  const now = new Date(2026, 10, 12, 15, 30).getTime();
  const personal = await j.add(j.read(), 'meal', now - 60000);
  await j.openDemo(now);
  const sample = j.read();
  assert.equal(sample.events.length, 501);
  assert.equal(new Set(sample.events.map(e => e.id)).size, 501);
  const t = copy(), before = j.view(sample, t, now, 30);
  assert.equal(before.groups.length, 21);
  const target = before.groups[4].rows[3];
  const changed = j.change(sample, target.id, { note: 'Just this row changes' });
  const after = j.view(changed, t, now, 30);
  assert.deepEqual(Object.keys(j.groupPatch(before.groups, after.groups)), ['groups[4].rows[3]']);
  const stats = j.statistics(changed, now);
  assert.equal(stats.total, stats.days.reduce((sum, d) => sum + d.total, 0));
  assert.equal(stats.total, stats.totals.reduce((sum, item) => sum + item.count, 0));
  assert.equal(stats.days.length, 7);
  assert.ok(stats.days.every(d => d.peeHeight + d.poopHeight + d.mealHeight <= 120.000001));
  j.closeDemo();
  assert.deepEqual(j.read(), personal);
  await j.openDemo(now);
  assert.equal(j.read().events.find(e => e.id === target.id).note, 'Just this row changes');
});

test('corrupt stored data and invalid dates are rejected without resetting existing storage', async () => {
  storage.set('puptime.mini.journal', { name: 'Scruffy', events: [{ at: 'bad' }] });
  const original = structuredClone(storage.get('puptime.mini.journal'));
  assert.throws(() => j.read(), /readError/);
  assert.deepEqual(storage.get('puptime.mini.journal'), original);
  assert.throws(() => j.parseTime('2026-02-30', '10:00'), /invalidDate/);
  assert.throws(() => j.parseTime('2099-01-01', '10:00'), /invalidDate/);
  const valid = new Date(2026, 1, 20, 10, 30).getTime();
  assert.equal(j.parseTime('2026-02-20', '10:30', valid + 60000), valid);
});

test('page editor keeps exact timestamp and sends no history changes while typing', async () => {
  let definition;
  global.Page = page => { definition = page; };
  require('../app/pages/journal/index');
  const patches = [];
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { patches.push(patch); Object.assign(this.data, patch); } };
  await j.openDemo();
  page.refresh();
  const target = page.data.groups[0].rows[0], at = target.at;
  page.edit({ detail: { id: target.id } });
  patches.length = 0;
  page.setNote({ detail: { value: 'Typed on phone' } });
  assert.equal(patches.length, 0);
  page.saveEdit();
  assert.equal(j.read().events.find(e => e.id === target.id).at, at);
  const historyKeys = patches.flatMap(patch => Object.keys(patch)).filter(k => k.startsWith('groups'));
  assert.deepEqual(historyKeys, ['groups[0].rows[0]']);
  // Native WeChat dialogs reject button labels longer than four characters.
  let opened = false;
  wx.showModal = options => {
    assert.ok(options.confirmText.length <= 4);
    assert.ok(options.cancelText.length <= 4);
    opened = true;
  };
  require('../app/pages/settings/index');
  const settings = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  settings.refresh();
  settings.rename();
  assert.equal(opened, true);
  j.closeDemo(); settings.refresh();
  settings.switchSample();
});


test('shared frequency uses recorded days, the 10-day window, and positive intervals', () => {
  const { activityFrequencyStats, monthlyActivityStats } = require('../app/utils/analytics');
  const now = new Date(2026, 10, 12, 15).getTime();
  const at = (day, hour = 10) => new Date(2026, 10, day, hour).getTime();
  const events = [{ type: 'pee', at: at(3) }, { type: 'pee', at: at(3, 12) },
    { type: 'meal', at: at(4) }, { type: 'poop', at: at(12) },
    { type: 'pee', at: at(2) }, { type: 'pee', at: at(13) }];
  const f = activityFrequencyStats(events, ['pee', 'poop'], 10, new Date(now));
  assert.equal(f.recordedDays, 3);
  assert.equal(f.stats[0].total, 2);
  assert.equal(f.stats[0].averagePerRecordedDay, 2 / 3);
  assert.equal(f.stats[0].minimumPerRecordedDay, 0);
  assert.equal(f.stats[0].medianIntervalMinutes, 120);
  assert.equal(f.stats[1].medianIntervalMinutes, undefined);
  const months = monthlyActivityStats(events);
  assert.equal(months[0].total, events.length);
  assert.equal(months[0].recordedDays, 5);
});

test('timeline keeps calendar days, filters, and all IDs when a bucket contains multiple logs', () => {
  const { timeline } = require('../app/utils/timeline');
  const now = new Date(2026, 10, 12, 15).getTime();
  const events = [{ id: 'evt_one', type: 'pee', at: now - 60_000 }, { id: 'evt_two', type: 'pee', at: now - 120_000 },
    { id: 'evt_three', type: 'meal', at: now - 60_000 }];
  const rows = timeline({ events }, ['pee'], 14, now), today = rows.find(row => row.today);
  assert.equal(rows.length, 16);
  assert.equal(rows.at(-1).key, '2026-11-14');
  assert.equal(today.events.length, 2);
  assert.equal(today.marks.length, 1);
  assert.deepEqual(today.marks[0].ids, ['evt_one', 'evt_two']);
  assert.equal(timeline({ events }, ['poop', 'meal'], 14, now).find(row => row.today).events.length, 1);
});

test('row delete cancellation and storage failure keep the journal intact', async () => {
  let definition;
  global.Page = page => { definition = page; };
  delete require.cache[require.resolve('../app/pages/journal/index')];
  require('../app/pages/journal/index');
  await j.add(j.read(), 'pee');
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  page.refresh();
  const id = j.read().events[0].id;
  wx.showModal = options => options.success({ confirm: false });
  page.deleteRow({ detail: { id } });
  assert.equal(j.read().events.length, 1);
  assert.equal(page.data.editor, null);
  failWrites = true;
  wx.showModal = options => options.success({ confirm: true });
  page.deleteRow({ detail: { id } });
  assert.equal(j.read().events.length, 1);
  assert.equal(page.data.error, copy().writeError);
});
