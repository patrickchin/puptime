// Replaces only a dedicated synthetic simulator's storage, after retaining an
// untouched backup. Exercises the actual Expo SQLite runtime, not the Node adapter.
// Prepare: node --disable-warning=ExperimentalWarning scripts/verify-ios-migration-retry.mjs <UDID> <legacy-fixture.json>
// Recover: same command with recover <backup/state.json>, after the Maestro alert check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localSchema } from '../src/local/database.ts';
const [target, fixture] = process.argv.slice(2), app = 'com.patrickchin.puptime';
const recovery = target === 'recover' ? JSON.parse(readFileSync(fixture, 'utf8')) : null;
const udid = recovery?.udid ?? target;
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const devices = JSON.parse(simctl('list', 'devices', 'available', '-j'));
assert.ok(Object.values(devices.devices).flat().find(device => device.udid === udid)?.name.startsWith('Puptime Native Storage '), 'Use the dedicated synthetic storage simulator.');
const values = JSON.parse(readFileSync(recovery?.fixture ?? fixture, 'utf8')), events = JSON.parse(values['puptime.events.v1']);
assert.equal(Object.keys(values).length, 10);
assert.equal(events.length, 1000);
assert.ok(events.every(event => event.id.startsWith('legacy-fixture-')), 'Use synthetic legacy history only.');
const stop = () => { try { simctl('terminate', udid, app); } catch {} };
const launch = () => simctl('launch', udid, app);
stop();
if (recovery) {
  const sql = new DatabaseSync(recovery.path);
  try {
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM puppies').get().n, 0);
    assert.equal(sql.prepare("SELECT value FROM metadata WHERE key='migration_complete'").get(), undefined);
    const manifest = JSON.parse(readFileSync(join(recovery.legacy, 'manifest.json'), 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      const retained = manifest[key] === null ? readFileSync(join(recovery.legacy, createHash('md5').update(key).digest('hex')), 'utf8') : manifest[key];
      assert.equal(retained, value);
    }
    sql.exec('DROP TRIGGER verification_interrupt_migration'); launch();
    let completed = false;
    for (let i = 0; i < 90; i++) {
      if (sql.prepare("SELECT value FROM metadata WHERE key='migration_complete'").get()?.value === '1') { completed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(completed, 'Native migration retry timed out.');
    const actual = sql.prepare('SELECT body FROM events ORDER BY id').all().map(row => JSON.parse(row.body));
    assert.deepEqual(actual, [...events].sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const snapshots = Object.fromEntries(sql.prepare('SELECT key,raw_value FROM legacy_snapshots').all().map(row => [row.key, row.raw_value]));
    assert.deepEqual(snapshots, values);
    stop(); launch();
    console.log('PASS: native record501 failure rolls back all records/puppy/marker, keeps all10 originals, then retries to exact1000 records and originals.');
  } finally { sql.close(); }
  process.exit(0);
}
const data = simctl('get_app_container', udid, app, 'data'), group = simctl('get_app_container', udid, app, 'group.com.patrickchin.puptime');
const sqlDirectory = join(data, 'Documents/SQLite'), queueDirectory = join(group, 'ExpoWidgets');
const legacy = join(data, 'Library/Application Support', app, 'RCTAsyncLocalStorage_V1');
const backup = mkdtempSync(join(tmpdir(), 'puptime-synthetic-migration-backup-'));
for (const [source, name] of [[sqlDirectory, 'main'], [queueDirectory, 'widget'], [legacy, 'legacy']]) if (existsSync(source)) cpSync(source, join(backup, name), { recursive: true });
console.log('Retained pre-test synthetic storage at', backup);
rmSync(sqlDirectory, { recursive: true, force: true }); rmSync(queueDirectory, { recursive: true, force: true });
mkdirSync(sqlDirectory, { recursive: true }); mkdirSync(legacy, { recursive: true });
const manifest = {};
for (const [key, value] of Object.entries(values)) {
  if (Buffer.byteLength(value) > 1024) { writeFileSync(join(legacy, createHash('md5').update(key).digest('hex')), value); manifest[key] = null; }
  else manifest[key] = value;
}
writeFileSync(join(legacy, 'manifest.json'), JSON.stringify(manifest));
const path = join(sqlDirectory, 'puptime-v2.db');
const sql = new DatabaseSync(path); sql.exec(localSchema);
sql.exec("CREATE TRIGGER verification_interrupt_migration AFTER INSERT ON events WHEN NEW.id='legacy-fixture-500' BEGIN SELECT RAISE(ABORT,'synthetic mid-migration interruption'); END;");
launch();
// The device reaches its real load-error alert. A separate Maestro flow checks
// that alert; inspect state only after the launch has had time to attempt import.
console.log('Injected failure at record501. Run the migration-failure Maestro flow, then resume with the generated state file.');
writeFileSync(join(backup, 'state.json'), JSON.stringify({ udid, data, group, fixture, path, legacy }));
sql.close();
