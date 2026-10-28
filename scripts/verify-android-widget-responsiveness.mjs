// Requires the dedicated rootable emulator, a populated synthetic history,
// notification permission, and the Pee/Poop/Ate widget on the launcher.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const device = process.argv[2];
const widgetName = process.argv[3] ?? 'PuptimeQuickLog';
assert.ok(['PuptimeQuickLog', 'PuptimeActions'].includes(widgetName));
const grid = widgetName === 'PuptimeActions';
assert.ok(device, 'Pass the dedicated emulator serial.');
const app = 'com.patrickchin.puptime';
const adb = (...args) => execFileSync('adb', ['-s', device, ...args], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
assert.match(adb('emu', 'avd', 'name').toString(), /^Puptime_Widget_Responsiveness_20f7/m);
adb('root'); adb('wait-for-device');
adb('shell', 'am', 'start', '-W', '-n', `${app}/.MainActivity`);
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
const sql = query => JSON.parse(adb('shell', 'sqlite3', '-json', `/data/user/0/${app}/files/SQLite/puptime-v2.db`, `"${query}"`).toString() || '[]');
const rows = () => sql("SELECT id,type,at FROM events WHERE source='widget' ORDER BY at,id");
assert.ok(sql('SELECT COUNT(*) AS count FROM events')[0].count >= 1000, 'Seed at least 1,000 synthetic logs first.');
const hierarchy = JSON.parse(execFileSync('maestro', ['--device', device, 'hierarchy', '--no-ansi', '--no-reinstall-driver'], { timeout: 60000 }).toString());
const targets = {};
function visit(node, selected = false) {
  const a = node.attributes ?? {};
  if (a.class?.endsWith('LauncherAppWidgetHostView')) selected = a.accessibilityText === (grid ? 'Puptime · All activities' : 'Puptime · Quick log') || (!grid && a.accessibilityText === 'Puptime Quick Log');
  const type = /^Log (pee|poop|ate|out|walk|nap),/.exec(a.accessibilityText ?? '')?.[1];
  if (type && selected) {
    const [left, top, right, bottom] = a.bounds.match(/\d+/g).map(Number);
    targets[type === 'ate' ? 'meal' : type === 'out' ? 'pottyTrip' : type] = [Math.round((left + right) / 2), Math.round((top + bottom) / 2)];
  }
  node.children?.forEach(child => visit(child, selected));
}
visit(hierarchy);
assert.deepEqual(Object.keys(targets).sort(), grid ? ['meal', 'nap', 'pee', 'poop', 'pottyTrip', 'walk'] : ['meal', 'pee', 'poop']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
for (const cold of [false, true]) {
  if (cold) {
    await pause(1000); // Let the preceding WorkManager tasks acknowledge completion.
    // Process reclamation, not force-stop (which disables widget delivery).
    const pid = adb('shell', 'pidof', app).toString().trim();
    if (pid) adb('shell', 'kill', '-9', ...pid.split(/\s+/));
  }
  const before = new Set(rows().map(row => row.id));
  const actions = grid ? ['pee', 'poop', 'meal', 'pottyTrip', 'walk'] : ['pee', 'poop', 'meal', 'pee', 'meal', 'poop'];
  const started = Date.now();
  // One shell connection keeps taps close together and exercises real launcher
  // PendingIntents, including targets updated while subsequent taps arrive.
  // About ten taps per second, including repeated actions during the burst.
  adb('shell', actions.map(type => `input tap ${targets[type].join(' ')}; sleep 0.08`).join('; '));
  let added;
  do {
    added = rows().filter(row => !before.has(row.id));
    if (added.length >= actions.length) break;
    await pause(100);
  } while (Date.now() - started < 10000);
  assert.deepEqual(added.map(row => row.type), actions, `${cold ? 'Cold' : 'Warm'} burst lost or misrouted a tap.`);
  const burstPersistedMs = Date.now() - started;
  let latency;
  do {
    const notifications = adb('shell', 'dumpsys', 'notification', '--noredact').toString();
    latency = added.map(row => {
      const record = notifications.split('NotificationRecord(').find(part => part.includes(`tag=puptime-widget-${row.id} `));
      const created = record?.match(/mCreationTimeMs=(\d+)/)?.[1];
      return created ? Number(created) - row.at : null;
    });
    if (latency.every(ms => ms !== null)) break;
    await pause(100);
  } while (Date.now() - started < 10000);
  assert.ok(latency.every(ms => ms !== null && ms >= 0), 'Every saved tap must receive a confirmation.');
  results.push({ cold, taps: added.length, burstPersistedMs, notificationLatencyMs: latency });
}
const intents = adb('shell', 'dumpsys', 'activity', 'intents').toString();
const identities = new Set([...intents.matchAll(/dat=(puptime-widget:\/\/\S+)/g)].map(match => match[1]).filter(uri => uri.startsWith(`puptime-widget://${widgetName}/`)));
assert.equal(identities.size, grid ? 6 : 3, 'Each launcher button must retain its own stable PendingIntent.');
if (grid) {
  assert.equal(sql("SELECT COUNT(*) count FROM events WHERE type='nap' AND end_state=1")[0].count, 0, 'Finish the synthetic open nap first.');
  adb('shell', 'input', 'tap', ...targets.nap.map(String));
  let nap;
  for (let attempt = 0; attempt < 100; attempt++) {
    nap = sql("SELECT id,at FROM events WHERE type='nap' AND end_state=1")[0];
    if (nap) break;
    await pause(100);
  }
  assert.ok(nap, 'The sixth grid button must start a nap.');
  await pause(1000);
  const updated = JSON.parse(execFileSync('maestro', ['--device', device, 'hierarchy', '--no-ansi', '--no-reinstall-driver'], { timeout: 60000 }).toString());
  let end;
  function findEnd(node) { const a = node.attributes ?? {}; if (a.accessibilityText?.startsWith('End nap,')) { const [l,t,r,b] = a.bounds.match(/\d+/g).map(Number); end = [Math.round((l+r)/2),Math.round((t+b)/2)]; } node.children?.forEach(findEnd); }
  findEnd(updated);
  assert.deepEqual(end, targets.nap, 'Starting a nap must not rearrange the six grid targets.');
  adb('shell', 'input', 'tap', ...end.map(String));
  for (let attempt = 0; attempt < 100; attempt++) {
    if (sql(`SELECT ended_at FROM events WHERE id='${nap.id}'`)[0]?.ended_at >= nap.at) break;
    await pause(100);
  }
  assert.ok(sql(`SELECT ended_at FROM events WHERE id='${nap.id}'`)[0]?.ended_at >= nap.at, 'The same sixth button must end the nap.');
}
const output = join(homedir(), 'Pictures/Screenshots/Codex/puptime-widget-responsiveness');
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'android-widget.png'), adb('exec-out', 'screencap', '-p'));
console.log(JSON.stringify({ widgetName, results, identities: [...identities], napToggle: grid, screenshot: join(output, 'android-widget.png') }, null, 2));
