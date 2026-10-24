// Destructive synthetic fixture: requires the dedicated a903 emulator and an installed app with a bundled script or configured Metro.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLocalDatabase, initializeLocalDatabase } from '../src/local/database.ts';
import { sqliteTestConnection } from '../src/local/sqlite-test-adapter.ts';
import { createLocalRuntime } from '../src/local/runtime-factory.ts';

const device = process.argv[2] ?? 'emulator-5590', app = 'com.patrickchin.puptime';
const adb = (...args) => {
  execFileSync('adb', ['-s', device, 'wait-for-device']);
  return execFileSync('adb', ['-s', device, ...args]);
};
assert.match(adb('emu', 'avd', 'name').toString(), /Puptime_Daily_Backups_a903/);
assert.equal(process.argv[3], '--replace-synthetic', 'Explicitly authorize reseeding the dedicated synthetic emulator.');
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
const open = `- launchApp\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 90000\n- tapOn:\n    id: nav.open\n- tapOn:\n    id: nav.settings\n- scrollUntilVisible:\n    element:\n      id: settings.backups.open\n    direction: DOWN\n- tapOn:\n    id: settings.backups.open\n- extendedWaitUntil:\n    visible:\n      id: backups.entry.0\n    timeout: 30000`;
stop();
let database = await createLocalDatabase(sqliteTestConnection(path));
const { petId } = await initializeLocalDatabase(database, () => 'pet_backup_fixture');
let runtime = await createLocalRuntime(database, petId);
await runtime.storage.completeOnboarding({ puppyName: 'Mochi' });
const now = Date.now();
await runtime.storage.appendEvents(Array.from({ length: 1000 }, (_, index) => ({
  id: `evt_backup_${index}`, type: index % 2 ? 'meal' : 'pee', at: now - index * 300000, source: 'app', note: `Backup fixture ${index}`,
})));
const otherPetId='pet_backup_other';
await database.write(sql=>sql.runAsync('INSERT INTO puppies(id,name) VALUES (?,?)',otherPetId,'Basil'));
let otherRuntime=await createLocalRuntime(database,otherPetId);
await otherRuntime.storage.appendEvents(Array.from({length:600},(_,index)=>({
  id:`evt_backup_${index}`,type:index%2?'meal':'pee',at:now-index*300000,source:'app',note:`Basil fixture ${index}`,
})));
await database.close();
// This dedicated synthetic emulator can be safely reset without touching any personal device.
shell('run-as', app, 'rm', '-rf', 'files/activity-backups'); upload(); launch();
flow('initial-snapshot', `${open}\n- assertVisible: '.*Mochi · 1000 logs.*'\n- assertVisible: '.*Basil · 600 logs.*'`);
writeFileSync(join(output, 'android-local-backups.png'), adb('exec-out', 'screencap', '-p'));
const names = shell('run-as', app, 'ls', 'files/activity-backups').toString().trim().split('\n').filter(name => name.endsWith('.json'));
assert.equal(names.length, 4);
const snapshots = names.map(name => JSON.parse(adb('exec-out', 'run-as', app, 'cat', `files/activity-backups/${name}`)));
assert.ok(snapshots.some(backup => backup.reason === 'before-update' && backup.events.length === 1000));
assert.ok(snapshots.some(backup => backup.reason === 'daily' && backup.events.length === 1000));
assert.ok(snapshots.some(backup => backup.petId===otherPetId && backup.reason === 'before-update' && backup.events.length === 600));
assert.ok(snapshots.some(backup => backup.petId===otherPetId && backup.reason === 'daily' && backup.events.length === 600));
const original = adb('exec-out', 'run-as', app, 'cat', `files/activity-backups/${names[0]}`);
const backup = JSON.parse(original); assert.ok([600,1000].includes(backup.events.length)); assert.ok(original.byteLength < 160000);
stop(); download();
database = await createLocalDatabase(sqliteTestConnection(path)); runtime = await createLocalRuntime(database, petId);
await runtime.storage.removeEvent('evt_backup_0'); await runtime.storage.updateEvent('evt_backup_1', { note: 'Current edit survives' });
otherRuntime=await createLocalRuntime(database,otherPetId);
await otherRuntime.storage.removeEvent('evt_backup_0'); await otherRuntime.storage.updateEvent('evt_backup_1',{note:'Basil current edit survives'});
await database.close(); upload(); launch();
const selectDog=name=>`- scrollUntilVisible:\n    element:\n      text: '.*${name} · .* logs.*'\n    direction: DOWN\n- tapOn:\n    text: '.*${name} · .* logs.*'\n    index: 0`;
flow('recover-inactive', `${open}\n${selectDog('Basil')}\n- assertVisible: 'Recover 600 logs to their original dog, Basil.*'\n- tapOn: Recover logs\n- assertVisible: 'Basil: 1 logs added. Already saved: 599.'`);
writeFileSync(join(output, 'android-inactive-recovered.png'), adb('exec-out', 'screencap', '-p'));
flow('repeat-inactive', `- tapOn: OK\n${selectDog('Basil')}\n- tapOn: Recover logs\n- assertVisible: 'Basil: 0 logs added. Already saved: 600.'\n- tapOn: OK`);
flow('recover-missing', `${selectDog('Mochi')}\n- assertVisible: 'Recover 1000 logs to their original dog, Mochi.*'\n- tapOn: Recover logs\n- assertVisible: 'Mochi: 1 logs added. Already saved: 999.'`);
writeFileSync(join(output, 'android-recovered.png'), adb('exec-out', 'screencap', '-p'));
flow('repeat-recovery', `- tapOn: OK\n${selectDog('Mochi')}\n- tapOn: Recover logs\n- assertVisible: 'Mochi: 0 logs added. Already saved: 1000.'\n- tapOn: OK`);
stop(); download();
database = await createLocalDatabase(sqliteTestConnection(path)); runtime = await createLocalRuntime(database, petId);
const events = await runtime.storage.loadEvents(); assert.equal(events.length, 1000);
assert.equal(events.find(event => event.id === 'evt_backup_1').note, 'Current edit survives');
otherRuntime=await createLocalRuntime(database,otherPetId);
const otherEvents=await otherRuntime.storage.loadEvents();assert.equal(otherEvents.length,600);
assert.equal(otherEvents.find(event=>event.id==='evt_backup_1').note,'Basil current edit survives');
assert.equal(otherEvents.find(event=>event.id==='evt_backup_0').note,'Basil fixture 0');
assert.equal(events.find(event=>event.id==='evt_backup_0').note,'Backup fixture 0');
await database.close();
assert.deepEqual(adb('exec-out', 'run-as', app, 'cat', `files/activity-backups/${names[0]}`), original);
console.log(`PASS both dogs' pre-update and daily snapshots (${original.byteLength} bytes for one snapshot), isolated recovery with overlapping IDs across 1,000/600-log histories, current edits, repeat recovery and immutable source. Evidence: ${output}`);
