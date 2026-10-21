// Destructive synthetic fixture: requires the dedicated a903 backup emulator and a running Metro.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLocalDatabase, initializeLocalDatabase } from '../src/local/database.ts';
import { sqliteTestConnection } from '../src/local/sqlite-test-adapter.ts';
import { createLocalRuntime } from '../src/local/runtime-factory.ts';

const device = process.argv[2] ?? 'emulator-5590', app = 'com.patrickchin.puptime';
const adb = (...args) => execFileSync('adb', ['-s', device, ...args]);
assert.match(adb('emu', 'avd', 'name').toString(), /Puptime_Daily_Backups_a903/);
const directory = mkdtempSync(join(tmpdir(), 'puptime-android-backups-'));
const output = resolve('output/daily-backups'); mkdirSync(output, { recursive: true });
const shell = (...args) => adb('shell', ...args);
const stop = () => shell('am', 'force-stop', app);
const launch = () => shell('am', 'start', '-n', `${app}/.MainActivity`);
const path = join(directory, 'puptime-v2.db');
const remote = 'files/SQLite/puptime-v2.db';
function upload() {
  shell('run-as', app, 'mkdir', '-p', 'files/SQLite');
  shell('run-as', app, 'rm', '-f', remote, `${remote}-wal`, `${remote}-shm`);
  execFileSync('adb', ['-s', device, 'shell', '-T', 'run-as', app, 'dd', `of=${remote}`], { input: readFileSync(path), stdio: ['pipe', 'pipe', 'pipe'] });
}
function download() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { writeFileSync(path + suffix, adb('exec-out', 'run-as', app, 'cat', remote + suffix)); }
    catch { if (!suffix) throw new Error('Missing fixture database.'); }
  }
}
function flow(name, commands) {
  const file = join(directory, `${name}.yaml`);
  writeFileSync(file, `appId: ${app}\n---\n${commands}\n`);
  execFileSync('maestro', ['--device', device, 'test', file, '--test-output-dir', join(directory, name)], { stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' } });
}
const open = `- launchApp\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 90000\n- tapOn:\n    id: settings.open\n- tapOn:\n    id: settings.backups.open\n- extendedWaitUntil:\n    visible:\n      id: backups.entry.0\n    timeout: 30000`;
stop();
let database = await createLocalDatabase(sqliteTestConnection(path));
const { petId } = await initializeLocalDatabase(database, () => 'pet_backup_fixture');
let runtime = await createLocalRuntime(database, petId);
await runtime.storage.completeOnboarding({ puppyName: 'Mochi' });
const now = Date.now();
await runtime.storage.appendEvents(Array.from({ length: 1000 }, (_, index) => ({
  id: `evt_backup_${index}`, type: index % 2 ? 'meal' : 'pee', at: now - index * 300000, source: 'app', note: `Backup fixture ${index}`,
})));
await database.close();
// This dedicated synthetic emulator can be safely reset without touching any personal device.
shell('run-as', app, 'rm', '-rf', 'files/activity-backups'); upload(); launch();
flow('initial-snapshot', `${open}\n- assertVisible: 'Mochi · 1000 logs.*'`);
writeFileSync(join(output, 'android-local-backups.png'), adb('exec-out', 'screencap', '-p'));
const names = shell('run-as', app, 'ls', 'files/activity-backups').toString().trim().split('\n').filter(name => name.endsWith('.json'));
assert.equal(names.length, 1);
const original = adb('exec-out', 'run-as', app, 'cat', `files/activity-backups/${names[0]}`);
const backup = JSON.parse(original); assert.equal(backup.events.length, 1000); assert.ok(original.byteLength < 160000);
stop(); download();
database = await createLocalDatabase(sqliteTestConnection(path)); runtime = await createLocalRuntime(database, petId);
await runtime.storage.removeEvent('evt_backup_0'); await runtime.storage.updateEvent('evt_backup_1', { note: 'Current edit survives' });
await database.close(); upload(); launch();
flow('recover-missing', `${open}\n- tapOn:\n    id: backups.entry.0\n- assertVisible: 'Recover missing logs.*'\n- tapOn: Recover logs\n- assertVisible: 'Added 1 logs. Kept 999 existing logs.'`);
writeFileSync(join(output, 'android-recovered.png'), adb('exec-out', 'screencap', '-p'));
flow('repeat-recovery', `- tapOn: OK\n- tapOn:\n    id: backups.entry.0\n- tapOn: Recover logs\n- assertVisible: 'Added 0 logs. Kept 1000 existing logs.'\n- tapOn: OK`);
stop(); download();
database = await createLocalDatabase(sqliteTestConnection(path)); runtime = await createLocalRuntime(database, petId);
const events = await runtime.storage.loadEvents(); assert.equal(events.length, 1000);
assert.equal(events.find(event => event.id === 'evt_backup_1').note, 'Current edit survives');
await database.close();
assert.deepEqual(adb('exec-out', 'run-as', app, 'cat', `files/activity-backups/${names[0]}`), original);
console.log(`PASS 1,000-log daily backup (${original.byteLength} bytes), missing-log recovery, current edits, repeat recovery and immutable source. Evidence: ${output}`);
