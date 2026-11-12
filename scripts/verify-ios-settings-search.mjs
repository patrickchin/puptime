// Real Settings controls on a dedicated, populated iOS simulator.
// Start this worktree's Expo server, then pass UDID PORT [--seed].
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDatabase, initializeLocalDatabase } from '../src/local/database.ts';
import { sqliteTestConnection } from '../src/local/sqlite-test-adapter.ts';
import { createLocalRuntime } from '../src/local/runtime-factory.ts';
import { entityId } from '../src/entity-id.ts';

const [udid, port = '8093'] = process.argv.slice(2), app = 'com.patrickchin.puptime';
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const devices = Object.values(JSON.parse(simctl('list', 'devices', 'available', '-j')).devices).flat();
assert.match(devices.find(device => device.udid === udid)?.name ?? '', /^Puptime afee Settings Search/);
const output = join(homedir(), 'Pictures/Screenshots/Codex/puptime-settings-search');
mkdirSync(output, { recursive: true });
const directory = join(simctl('get_app_container', udid, app, 'data'), 'Documents/SQLite');
const path = join(directory, 'puptime-v2.db');
if (process.argv.includes('--seed')) {
  try { simctl('terminate', udid, app); } catch {}
  mkdirSync(directory, { recursive: true });
  const database = await createLocalDatabase(sqliteTestConnection(path));
  try {
    const { petId } = await initializeLocalDatabase(database);
    assert.equal((await database.read(sql => sql.getFirstAsync('SELECT count(*) n FROM local_sync_owner'))).n, 0);
    assert.equal((await database.read(sql => sql.getFirstAsync('SELECT count(*) n FROM events'))).n, 0, 'Only seed an empty, unowned fixture.');
    const { storage } = await createLocalRuntime(database, petId);
    await storage.savePuppyName('Mochi');
    await storage.saveLanguagePreference('en');
    await storage.saveThemePreference('light');
    await storage.completeOnboarding();
    await storage.appendEvents(Array.from({ length: 1000 }, (_, index) => ({
      id: entityId('evt'), type: ['pee', 'poop', 'meal'][index % 3], at: Date.now() - index * 300000, source: 'app',
    })));
  } finally { await database.close(); }
}
const db = new DatabaseSync(path, { readOnly: true });
const events = () => db.prepare('SELECT * FROM events ORDER BY id').all();
const before = events();
assert.ok(before.length >= 1000);
assert.equal(db.prepare('SELECT count(*) n FROM local_sync_owner').get().n, 0);
const flow = join(output, 'verify.yaml');
writeFileSync(flow, `appId: ${app}
---
- launchApp:
    arguments:
      RCT_jsLocation: "localhost:${port}"
    permissions: {}
- extendedWaitUntil:
    visible:
      id: screen.today
    timeout: 90000
- tapOn:
    id: nav.open
- tapOn:
    id: nav.settings
- assertVisible:
    id: settings.search
- takeScreenshot: settings-search-default
- tapOn:
    id: settings.search
- inputText: apperance
- assertVisible:
    id: settings.theme.open
- assertNotVisible:
    id: settings.language.open
- takeScreenshot: settings-search-typo
- tapOn:
    id: settings.theme.open
- assertVisible:
    id: appearance.theme.dark
- tapOn:
    id: appearance.theme.dark
- tapOn:
    id: appearance.close
- assertVisible:
    id: settings.search
- takeScreenshot: settings-search-dark
- tapOn:
    id: settings.search.clear
- inputText: widgte
- assertVisible:
    id: settings.widget.open
- tapOn:
    id: settings.widget.open
- assertVisible:
    id: settings.widget.action.pee
- takeScreenshot: settings-search-widget-open
- tapOn:
    id: settings.widget.close
- tapOn:
    id: settings.search.clear
- inputText: spaceship
- assertVisible:
    id: settings.search.empty
- assertNotVisible:
    id: settings.widget.open
- takeScreenshot: settings-search-empty
- tapOn:
    id: settings.search.clear
- inputText: restore
- tapOn:
    id: settings.backups.open
- extendedWaitUntil:
    visible:
      id: backups.close
    timeout: 15000
- takeScreenshot: settings-search-backups-open
- tapOn:
    id: backups.close
- tapOn:
    id: settings.search.clear
- inputText: potty
- tapOn:
    id: settings.notifications.open
- assertVisible:
    id: screen.notifications
- takeScreenshot: settings-search-notifications-open
`);
try {
  execFileSync(process.env.MAESTRO_BIN ?? 'maestro', ['--device', udid, 'test', flow, '--test-output-dir', join(output, 'results')], {
    stdio: 'inherit', timeout: 600000, env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' },
  });
  for (const file of readdirSync(join(output, 'results'), { recursive: true }).filter(file => /settings-search-.*\.png$/.test(String(file)))) {
    cpSync(join(output, 'results', file), join(output, String(file).split('/').at(-1)));
  }
  assert.deepEqual(events(), before, 'Searching and opening settings must preserve all 1,000 saved events.');
  console.log('PASS fuzzy search, clear, no results, Appearance, dark mode, Widgets, Backups, Notifications, and unchanged populated history.');
} finally { db.close(); }
