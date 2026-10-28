// Local collector + dedicated Android emulator only. See docs/app-telemetry.md.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const device = process.argv[2], app = 'com.patrickchin.puptime';
assert.ok(device, 'Pass the dedicated Puptime_Telemetry_b36b emulator.');
const adb = (...args) => execFileSync('adb', ['-s', device, ...args], { encoding: 'utf8' }).trim();
assert.match(adb('emu', 'avd', 'name'), /^Puptime_Telemetry_b36b\b/);
const output = resolve('output/app-telemetry'), screenshots = join(homedir(), 'Pictures/Screenshots/Codex/puptime-telemetry');
mkdirSync(output, { recursive: true }); mkdirSync(screenshots, { recursive: true });
const wait = ms => new Promise(done => setTimeout(done, ms));
function hierarchy() { adb('shell', 'uiautomator', 'dump', '/sdcard/telemetry.xml'); return adb('shell', 'cat', '/sdcard/telemetry.xml'); }
function find(id, xml = hierarchy()) {
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(match => match[0]).find(text => {
    if (!text.includes(`resource-id="${id}"`)) return false;
    const bounds = text.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);
    return bounds && bounds[2] - bounds[0] >= 44 && bounds[3] - bounds[1] >= 44;
  });
}
async function node(id) { for (let i = 0; i < 10; i++) { const item = find(id); if (item) return item; await wait(500); } assert.fail('Missing ' + id); }
async function tap(id, duration) {
  const bounds = (await node(id)).match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
  const x = String((bounds[0] + bounds[2]) / 2), y = String((bounds[1] + bounds[3]) / 2);
  if (duration) adb('shell', 'input', 'swipe', x, y, x, y, String(duration)); else adb('shell', 'input', 'tap', x, y);
}
async function analytics() {
  for (let i = 0; i < 6; i++) { if (find('settings.analytics')) return; adb('shell', 'input', 'swipe', '1030', '1700', '1030', '600', '400'); }
  assert.fail('Analytics switch is reachable in Settings.');
}
function screenshot(name) { writeFileSync(join(screenshots, name + '.png'), execFileSync('adb', ['-s', device, 'exec-out', 'screencap', '-p'])); }
const rows = () => JSON.parse(adb('exec-out', 'run-as', app, 'cat', 'files/row-render-probe.json')).renders;
const events = [], errors = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => {
    if (request.url?.split('?')[0] === '/batch/') {
      try {
        let bytes = Buffer.concat(chunks);
        if (bytes[0] === 31 && bytes[1] === 139) bytes = gunzipSync(bytes);
        events.push(...JSON.parse(bytes.toString()).batch);
      } catch (error) { errors.push(String(error)); }
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/api/config' ? { providers: { apple: false, google: false, email: false } } : { status: 1 }));
  });
});
await new Promise(done => server.listen(8896, '127.0.0.1', done));
try {
  if (process.argv.includes('--seed')) {
    const { createLocalDatabase, initializeLocalDatabase } = await import('../src/local/database.ts');
    const { sqliteTestConnection } = await import('../src/local/sqlite-test-adapter.ts');
    const { createLocalRuntime } = await import('../src/local/runtime-factory.ts');
    const path = join(output, 'fixture.db');
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    const database = await createLocalDatabase(sqliteTestConnection(path));
    const { petId } = await initializeLocalDatabase(database), runtime = await createLocalRuntime(database, petId);
    await runtime.storage.completeOnboarding({ puppyName: 'PrivateTelemetryPuppy' });
    await runtime.storage.saveLanguagePreference('en'); await runtime.storage.saveThemePreference('light');
    await runtime.storage.saveCustomActivity('PrivateCustomActivity');
    await runtime.storage.appendEvents(Array.from({ length: 1000 }, (_, i) => ({ id: `evt_telemetry_${i}`, type: ['pee', 'meal', 'poop', 'walk'][i % 4], at: Date.now() - i * 20 * 60000, source: 'app', note: 'PrivateTelemetryNote' })));
    await database.close();
    adb('shell', 'am', 'force-stop', app); adb('shell', 'pm', 'clear', app);
    adb('shell', 'run-as', app, 'mkdir', '-p', 'files/SQLite');
    execFileSync('adb', ['-s', device, 'shell', '-T', 'run-as', app, 'dd', 'of=files/SQLite/puptime-v2.db'], { input: readFileSync(path) });
  }
  adb('reverse', 'tcp:8896', 'tcp:8896');
  adb('shell', 'am', 'force-stop', app); adb('shell', 'am', 'start', '-n', app + '/.MainActivity');
  await node('event.pee.edit');
  await tap('nav.open'); await tap('nav.settings'); await analytics();
  assert.ok((await node('settings.analytics')).includes('checked="false"'), 'Start with a fresh consent preference.');
  await wait(16_000); assert.equal(events.length, 0, 'No events before opt-in.');
  screenshot('android-analytics-off');
  await tap('settings.analytics'); await wait(16_000);
  assert.ok(events.some(event => event.event === 'app_screen_view'), 'Installed SDK sends real native events to the local collector.');
  screenshot('android-analytics-on');
  await tap('settings.back'); await node('event.pee.edit');
  const before = rows(); assert.ok(Object.keys(before).length > 20, 'Use the populated 1,000-log fixture and render probe.');
  await tap('event.pee.edit'); await node('editor');
  assert.deepEqual(rows(), before, 'Opening the editor leaves all existing rows unchanged.');
  await tap('editor.adjust.back.15');
  await tap('editor.close'); await node('event.pee.edit');
  const after = rows(), changed = Object.keys(before).filter(id => before[id] !== after[id]);
  assert.equal(changed.length, 1, 'Only the edited log redraws.');
  await tap('quick.pee', 800); await tap('nav.switch'); await node('timeline.filter.pee');
  const tracks = () => JSON.parse(adb('exec-out', 'run-as', app, 'cat', 'files/timeline-render-probe.json'));
  const chartXml = hierarchy();
  const mark = [...chartXml.matchAll(/resource-id="(timeline.mark.point.[^"]+)"/g)].map(match => match[1]).find(id => find(id, chartXml));
  assert.ok(mark, 'Populated timeline contains recorded marks.');
  const chartBefore = tracks(); await tap(mark); await node('timeline.details');
  const chartAfter = tracks(); assert.deepEqual(chartAfter.date, chartBefore.date, 'Details do not redraw date rows.');
  assert.ok(Object.keys(chartBefore.track).filter(key => chartBefore.track[key] !== chartAfter.track[key]).length <= 1, 'Details only update the selected day track.');
  await tap('timeline.details.close'); await tap('nav.switch');
  await node('screen.today'); await wait(16_000);
  assert.ok(events.some(event => event.event === 'app_press' && event.properties.control === 'quick.pee' && event.properties.press_duration_ms >= 600));
  assert.ok(events.some(event => event.event === 'app_log_action' && event.properties.action === 'create' && event.properties.activity_type === 'pee'));
  assert.ok(events.some(event => event.event === 'app_log_action' && event.properties.action === 'update'));
  assert.ok(events.some(event => event.event === 'app_navigation' && event.properties.from_screen === 'log' && event.properties.to_screen === 'timeline'));
  assert.ok(events.some(event => event.event === 'app_navigation' && event.properties.from_screen === 'timeline' && event.properties.to_screen === 'log'));
  assert.ok(events.some(event => event.event === 'app_screen_time' && event.properties.duration_ms > 0));
  assert.ok(!JSON.stringify(events).includes('PrivateTelemetry'), 'Puppy names and saved note text never reach the collector.');
  assert.ok(!JSON.stringify(events).includes('PrivateCustomActivity'), 'Custom labels never reach the collector.');
  await tap('nav.open'); await tap('nav.settings'); await analytics(); await tap('settings.analytics');
  assert.ok((await node('settings.analytics')).includes('checked="false"'), 'Withdrawal is acknowledged by the native control.');
  const length = events.length; await tap('settings.back'); await tap('quick.pee'); await wait(17_000);
  assert.equal(events.length, length, 'Queued events and new actions cannot ship after withdrawal.');
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ passed: true, eventCount: events.length, uniqueEventCount: new Set(events.map(event => event.uuid)).size, changedRows: changed, events }, null, 2));
  console.log('PASS native collection, consent, press duration, navigation, log outcomes, private-content exclusion and history row stability.');
} finally {
  writeFileSync(join(output, 'collector.json'), JSON.stringify({ events, errors }, null, 2));
  server.closeAllConnections(); await new Promise(done => server.close(done));
}
