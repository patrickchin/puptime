// Schedule a one-off reminder a few minutes ahead on the dedicated emulator,
// then pass its rem_ identifier and Unix-millisecond time to this check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [device, id, due] = process.argv.slice(2), at = Number(due);
assert.ok(device && /^rem_[a-f0-9]{32}$/.test(id) && Number.isSafeInteger(at));
const app = 'com.patrickchin.puptime';
const adb = (...args) => execFileSync('adb', ['-s', device, ...args], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }).toString();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
assert.match(adb('emu', 'avd', 'name'), /^Puptime_Widget_Responsiveness_20f7/m);
assert.ok(at > Date.now() + 30000 && at < Date.now() + 600000, 'Choose a reminder 30 seconds to 10 minutes ahead.');
const output = join(homedir(), 'Pictures/Screenshots/Codex/puptime-exact-reminders');
mkdirSync(output, { recursive: true });
function exactAlarm() {
  const dump = adb('shell', 'dumpsys', 'alarm');
  const block = dump.split(/(?=    RTC_WAKEUP #)/).find(block => block.includes(`origWhen ${at} `) && block.includes(app));
  assert.ok(block?.includes('window=0 exactAllowReason=permission'), 'The reminder must be an exact permission-backed alarm.');
  return dump;
}
exactAlarm();
// Reboot proves Expo's persisted native request is restored without opening JS.
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
adb('reboot');
adb('wait-for-device');
let booted = false;
for (let attempt = 0; attempt < 120; attempt++) {
  if (adb('shell', 'getprop', 'sys.boot_completed').trim() === '1') { booted = true; break; }
  await pause(500);
}
assert.ok(booted, 'The dedicated emulator did not reboot.');
adb('root'); adb('wait-for-device');
await pause(1500);
writeFileSync(join(output, 'alarms-after-reboot.txt'), exactAlarm());
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
const pid = adb('shell', `pidof ${app} || true`).trim();
if (pid) adb('shell', 'kill', '-9', ...pid.split(/\s+/));
await pause(500);
assert.equal(adb('shell', `pidof ${app} || true`).trim(), '', 'The app process must be stopped before the idle test.');
let created;
try {
  adb('shell', 'dumpsys', 'battery', 'unplug');
  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  adb('shell', 'dumpsys', 'deviceidle', 'force-idle');
  assert.equal(adb('shell', 'dumpsys', 'deviceidle', 'get', 'deep').trim(), 'IDLE');
  while (Date.now() < at + 15000) {
    const dump = adb('shell', 'dumpsys', 'notification', '--noredact');
    const record = dump.split('NotificationRecord(').find(part => part.includes(`tag=${id} `));
    const time = record?.match(/mCreationTimeMs=(\d+)/)?.[1];
    if (time) { created = Number(time); writeFileSync(join(output, 'delivered-notification.txt'), record); break; }
    await pause(500);
  }
  assert.ok(created, 'The reminder did not arrive while the app was closed and the device was idle.');
  assert.ok(created >= at && created - at <= 5000, `Reminder creation missed the requested time by ${created - at} ms.`);
} finally {
  adb('shell', 'dumpsys', 'deviceidle', 'unforce');
  adb('shell', 'dumpsys', 'battery', 'reset');
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
}
const result = { device, id, at, created, latencyMs: created - at, survivedReboot: true, idle: true };
writeFileSync(join(output, 'exact-delivery.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
