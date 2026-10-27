// Requires the dedicated rootable emulator, a populated synthetic history,
// notification permission, and the Pee/Poop/Ate widget on the launcher.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const device = process.argv[2];
assert.ok(device, 'Pass the dedicated emulator serial.');
const app = 'com.patrickchin.puptime';
const adb = (...args) => execFileSync('adb', ['-s', device, ...args], { timeout: 30000 });
assert.match(adb('emu', 'avd', 'name').toString(), /^Puptime_Widget_Responsiveness_20f7/m);
adb('root'); adb('wait-for-device');
adb('shell', 'am', 'start', '-W', '-n', `${app}/.MainActivity`);
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
const sql = query => JSON.parse(adb('shell', 'sqlite3', '-json', `/data/user/0/${app}/files/SQLite/puptime-v2.db`, `"${query}"`).toString() || '[]');
const rows = () => sql("SELECT id,type,at FROM events WHERE source='widget' ORDER BY at,id");
assert.ok(sql('SELECT COUNT(*) AS count FROM events')[0].count >= 1000, 'Seed at least 1,000 synthetic logs first.');
const hierarchy = JSON.parse(execFileSync('maestro', ['--device', device, 'hierarchy', '--no-ansi', '--no-reinstall-driver'], { timeout: 60000 }).toString());
const targets = {};
function visit(node) {
  const a = node.attributes ?? {};
  const type = /^Log (pee|poop|ate),/.exec(a.accessibilityText ?? '')?.[1];
  if (type) {
    const [left, top, right, bottom] = a.bounds.match(/\d+/g).map(Number);
    targets[type === 'ate' ? 'meal' : type] = [Math.round((left + right) / 2), Math.round((top + bottom) / 2)];
  }
  node.children?.forEach(visit);
}
visit(hierarchy);
assert.deepEqual(Object.keys(targets).sort(), ['meal', 'pee', 'poop']);
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
  const actions = ['pee', 'poop', 'meal', 'pee', 'meal', 'poop'];
  const started = Date.now();
  // One shell connection keeps taps close together and exercises real launcher
  // PendingIntents, including targets updated while subsequent taps arrive.
  adb('shell', actions.map(type => `input tap ${targets[type].join(' ')}`).join('; '));
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
const identities = new Set([...intents.matchAll(/dat=(puptime-widget:\/\/\S+)/g)].map(match => match[1]));
assert.equal(identities.size, 3, 'Each launcher button must retain its own stable PendingIntent.');
const output = join(homedir(), 'Pictures/Screenshots/Codex/puptime-widget-responsiveness');
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'android-widget.png'), adb('exec-out', 'screencap', '-p'));
console.log(JSON.stringify({ results, identities: [...identities], screenshot: join(output, 'android-widget.png') }, null, 2));
