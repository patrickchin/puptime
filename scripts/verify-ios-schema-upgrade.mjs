// Install both real Release binaries on the dedicated synthetic simulator.
// Unlike the legacy-import qualifier, this never creates the old schema itself.
// Usage: node --disable-warning=ExperimentalWarning scripts/verify-ios-schema-upgrade.mjs <UDID> <legacy-fixture.json> <schema2.app> <schema3.app>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [udid, fixtureFile, previousApp, nextApp] = process.argv.slice(2);
const app = 'com.patrickchin.puptime';
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const devices = Object.values(JSON.parse(simctl('list', 'devices', 'available', '-j')).devices).flat();
assert.ok(devices.find(device => device.udid === udid)?.name.startsWith('Puptime Native Storage '), 'Use the dedicated synthetic storage simulator.');
assert.ok(previousApp && nextApp && previousApp !== nextApp && existsSync(previousApp) && existsSync(nextApp), 'Supply distinct existing schema2 and schema3 Release binaries.');
const values = JSON.parse(readFileSync(fixtureFile, 'utf8'));
const events = JSON.parse(values['puptime.events.v1']);
assert.equal(Object.keys(values).length, 10);
assert.equal(events.length, 1000);
assert.ok(events.every(event => event.id.startsWith('legacy-fixture-')), 'Use synthetic legacy records only.');
const stop = () => { try { simctl('terminate', udid, app); } catch {} };
const launch = () => simctl('launch', udid, app);
const container = () => simctl('get_app_container', udid, app, 'data');
const locations = () => {
  const data = container();
  return {
    data, sqlDirectory: join(data, 'Documents/SQLite'),
    legacy: join(data, 'Library/Application Support', app, 'RCTAsyncLocalStorage_V1'),
    widget: join(simctl('get_app_container', udid, app, 'group.com.patrickchin.puptime'), 'ExpoWidgets'),
    path: join(data, 'Documents/SQLite/puptime-v2.db'),
  };
};
const backup = mkdtempSync(join(tmpdir(), 'puptime-schema-upgrade-backup-'));
stop();
let paths = locations();
for (const [name, source] of Object.entries({ main: paths.sqlDirectory, widget: paths.widget, legacy: paths.legacy })) {
  if (existsSync(source)) cpSync(source, join(backup, name), { recursive: true });
}
writeFileSync(join(backup, 'state.json'), JSON.stringify({ udid, fixtureFile: resolve(fixtureFile), previousApp, nextApp, ...paths }));
console.log('Retained pre-test synthetic storage:', backup);

const open = () => {
  const sql = new DatabaseSync(locations().path);
  sql.exec('PRAGMA busy_timeout=5000');
  return sql;
};
const version = sql => sql.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value;
async function waitForVersion(expected) {
  for (let i = 0; i < 180; i++) {
    let sql;
    try {
      if (existsSync(locations().path)) {
        sql = open();
        if (version(sql) === expected) return;
      }
    } catch {} finally { sql?.close(); }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.fail(`Installed app did not reach schema ${expected}.`);
}
function originals() {
  const legacy = locations().legacy;
  const manifest = JSON.parse(readFileSync(join(legacy, 'manifest.json'), 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    assert.equal(manifest[key] === null ? readFileSync(join(legacy, createHash('md5').update(key).digest('hex')), 'utf8') : manifest[key], value);
  }
}
function contents(sql) {
  return Object.fromEntries(['puppies', 'events', 'routines', 'settings', 'pet_settings', 'legacy_snapshots'].map(table => [table,
    sql.prepare(`SELECT * FROM ${table}`).all().map(row => JSON.stringify(row)).sort(),
  ]));
}
function imported(sql) {
  assert.deepEqual(sql.prepare('SELECT body FROM events ORDER BY id').all().map(row => JSON.parse(row.body)), [...events].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  assert.deepEqual(Object.fromEntries(sql.prepare('SELECT key,raw_value FROM legacy_snapshots').all().map(row => [row.key, row.raw_value])), values);
  originals();
}

// The previous app must create schema2 from the actual native legacy store.
simctl('install', udid, previousApp);
paths = locations();
for (const path of [paths.sqlDirectory, paths.widget, paths.legacy]) rmSync(path, { recursive: true, force: true });
mkdirSync(paths.legacy, { recursive: true });
const manifest = {};
for (const [key, value] of Object.entries(values)) {
  if (Buffer.byteLength(value) > 1024) {
    writeFileSync(join(paths.legacy, createHash('md5').update(key).digest('hex')), value);
    manifest[key] = null;
  } else manifest[key] = value;
}
writeFileSync(join(paths.legacy, 'manifest.json'), JSON.stringify(manifest));
launch();
await waitForVersion('2');
stop();
let sql = open(), baseline;
try {
  imported(sql);
  baseline = contents(sql);
  assert.equal(sql.prepare("SELECT name FROM sqlite_master WHERE name='local_sync_owner'").get(), undefined);
  sql.exec("CREATE TRIGGER verification_interrupt_schema_upgrade BEFORE UPDATE ON metadata WHEN NEW.key='schema_version' AND NEW.value='3' BEGIN SELECT RAISE(ABORT,'synthetic schema upgrade interruption'); END;");
} finally { sql.close(); }
console.log('PASS: installed previous Release creates schema 2 with exactly 1000 records and all 10 original legacy values.');

simctl('install', udid, nextApp);
launch();
const output = join(backup, 'maestro');
execFileSync(process.env.MAESTRO_BIN ?? 'maestro', ['--device', udid, 'test', resolve('.maestro/native/ios-migration-failure.yaml'), '--test-output-dir', output], { stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' } });
stop();
sql = open();
try {
  assert.equal(version(sql), '2');
  assert.deepEqual(contents(sql), baseline);
  assert.equal(sql.prepare("SELECT name FROM sqlite_master WHERE name='local_sync_owner'").get(), undefined, 'New schema DDL must roll back together with the version marker.');
  imported(sql);
  sql.exec('DROP TRIGGER verification_interrupt_schema_upgrade');
} finally { sql.close(); }
console.log('PASS: installed new Release reports the real load failure; schema 2 data, settings, snapshots and new-table rollback are intact.');

launch();
await waitForVersion('3');
stop();
sql = open();
try {
  imported(sql);
  assert.deepEqual(contents(sql), baseline);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM local_sync_owner').get().n, 0);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM local_sync_outbox').get().n, 0);
} finally { sql.close(); }
launch();
await waitForVersion('3');
// Check after a second real startup, not merely a repeated SQL read.
await new Promise(resolve => setTimeout(resolve, 2000));
stop();
sql = open();
try { imported(sql); assert.deepEqual(contents(sql), baseline); } finally { sql.close(); }
launch();
console.log('PASS: native retry upgrades schema 2 to 3 without changing 1000 records, puppy identity, settings or originals; second restart is stable, free and unassociated.');
console.log('Recovery backup and evidence:', backup);
