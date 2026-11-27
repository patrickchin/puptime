// Artificial website journal only. Accepts no CSV, account, or personal data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLocalDatabase, initializeLocalDatabase } from '../src/local/database.ts';
import { sqliteTestConnection } from '../src/local/sqlite-test-adapter.ts';
import { createLocalRuntime } from '../src/local/runtime-factory.ts';
import { entityId } from '../src/entity-id.ts';
import { suggestScheduleFromEvents } from '../src/analytics.ts';

// A made-up daily rhythm per variant: [type, minutes after midnight, note today].
const rhythms = {
  full: [['pee', 420], ['meal', 435, 'Breakfast finished'], ['poop', 465], ['pee', 570, 'After a little play'], ['meal', 720], ['pee', 745], ['poop', 765, 'After lunch'], ['pee', 910], ['meal', 1080], ['poop', 1110], ['pee', 1200], ['pee', 1330]],
  // Three meals, each followed by a poop; no pee breaks.
  'poop-eat': [['meal', 435, 'Breakfast finished'], ['poop', 465], ['meal', 735], ['poop', 770, 'After lunch'], ['meal', 1080], ['poop', 1110]],
};
const [udid, variant = 'full'] = process.argv.slice(2), app = 'com.patrickchin.puptime';
assert.ok(process.argv.length <= 4 && udid, 'Supply the dedicated simulator ID and optionally a rhythm: ' + Object.keys(rhythms).join(', ') + '.');
const rhythm = rhythms[variant];
assert.ok(rhythm, 'Unknown rhythm ' + variant + '.');
assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Asia/Shanghai', 'Run with TZ=Asia/Shanghai.');
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const devices = Object.values(JSON.parse(simctl('list', 'devices', 'available', '-j')).devices).flat();
// Only a task-owned simulator named "Puptime Website Screenshots <task>" is accepted.
assert.match(devices.find(device => device.udid === udid)?.name ?? '', /^Puptime Website Screenshots \S/);
try { simctl('terminate', udid, app); } catch {}
const directory = join(simctl('get_app_container', udid, app, 'data'), 'Documents/SQLite');
const target = join(directory, 'puptime-v2.db');
assert.ok(!existsSync(target), 'Use a fresh dedicated installation; never replace an existing database.');
const output = resolve('output/website-capture');
mkdirSync(output, { recursive: true });
const path = join(output, udid + '.sqlite');
assert.ok(!existsSync(path), 'Keep prior fixture evidence.');
const database = await createLocalDatabase(sqliteTestConnection(path));
const events = [];
try {
  const { petId } = await initializeLocalDatabase(database);
  const { storage } = await createLocalRuntime(database, petId);
  await storage.completeOnboarding({ puppyName: 'Biscuit' });
  await storage.saveThemePreference('light');
  await storage.saveLanguagePreference('en');
  const anchor = new Date('2026-11-20T13:10:00+08:00').getTime();
  // Small, deterministic timing variations.
  for (let day = 14; day >= 0; day--) {
    for (const [slot, [type, minutes, todayNote]] of rhythm.entries()) {
      const date = new Date(anchor);
      date.setDate(date.getDate() - day);
      date.setHours(0, minutes + ((day * 7 + slot * 3) % 23) - 11, 0, 0);
      if (date.getTime() > anchor) continue;
      const note = day === 0 ? todayNote : undefined;
      events.push({ id: entityId('evt'), type, at: date.getTime(), source: 'app', ...(note ? { note } : {}) });
    }
  }
  assert.equal(events.length, { full: 175, 'poop-eat': 88 }[variant]);
  await storage.appendEvents(events);
  const suggestion = suggestScheduleFromEvents(events, 14, new Date(anchor));
  assert.ok(suggestion.entries.length >= 6, 'The example history should support a populated routine.');
  assert.deepEqual(new Set(suggestion.entries.map(entry => entry.type)), new Set(rhythm.map(([type]) => type)), 'The routine should contain only the rhythm\'s activities.');
  await storage.saveSchedule(suggestion.entries.map(entry => ({ ...entry, id: entityId('rtn'), reminder: false })));
  const saved = await storage.loadEvents();
  assert.equal(saved.length, events.length);
  assert.deepEqual(new Set(saved.map(event => event.id)), new Set(events.map(event => event.id)));
  assert.equal((await database.read(sql => sql.getFirstAsync('SELECT count(*) n FROM local_sync_owner'))).n, 0);
  // This ignored entry changes only the capture clock. The release uses index.ts.
  writeFileSync(join(output, 'capture-entry.js'), `const RealDate = Date, anchor = ${anchor};
function CaptureDate(...args) {
  if (new.target) return Reflect.construct(RealDate, args.length ? args : [anchor], new.target);
  return new RealDate(anchor).toString();
}
Object.setPrototypeOf(CaptureDate, RealDate);
CaptureDate.prototype = RealDate.prototype;
CaptureDate.now = () => anchor;
global.Date = CaptureDate;
require('../../index');
`);
  writeFileSync(join(output, 'fixture.json'), JSON.stringify({ kind: 'wholly-artificial', rhythm: variant, puppy: 'Biscuit', count: events.length, completedDays: 14, anchor: new Date(anchor).toISOString(), timeZone: 'Asia/Shanghai', account: false, importedData: false, suggestedRoutineEntries: suggestion.entries.length }, null, 2) + '\n');
} finally { await database.close(); }
mkdirSync(directory, { recursive: true });
cpSync(path, target);
simctl('status_bar', udid, 'override', '--time', '13:10', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100');
simctl('ui', udid, 'appearance', 'light');
console.log(`Seeded ${events.length} wholly artificial activities and a learned example routine; no account or imported data.`);
