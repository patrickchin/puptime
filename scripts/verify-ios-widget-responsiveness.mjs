// Requires the dedicated simulator, a 1,000-log synthetic history, notification
// permission, and the medium widget already placed on the Home Screen.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const device = process.argv[2], app = 'com.patrickchin.puptime';
assert.ok(device, 'Pass the dedicated iOS simulator UDID.');
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', timeout: 60000 }).trim();
const devices = Object.values(JSON.parse(simctl('list', 'devices', 'available', '-j')).devices).flat();
assert.equal(devices.find(item => item.udid === device)?.name, 'Puptime Widget Responsiveness 20f7');
const data = simctl('get_app_container', device, app, 'data');
const bundle = simctl('get_app_container', device, app, 'app');
const group = simctl('get_app_container', device, app, 'groups').split('\n')
  .find(line => line.startsWith('group.com.patrickchin.puptime\t')).split('\t')[1];
const journal = join(group, 'ExpoWidgets/PuptimePending');
const directory = mkdtempSync(join(tmpdir(), 'puptime-ios-widget-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const operations = () => existsSync(journal) ? readdirSync(journal).filter(name => /^wop_[a-f0-9]+\.json$/.test(name)).map(name => {
  const path = join(journal, name);
  return { ...JSON.parse(readFileSync(path, 'utf8')), persistedAt: statSync(path).mtimeMs };
}) : [];
const databasePath = join(data, 'Documents/SQLite/puptime-v2.db');
const database = new DatabaseSync(databasePath, { readOnly: true });
assert.ok(database.prepare('SELECT count(*) AS count FROM events').get().count >= 1000);
const flow = (name, commands) => {
  const path = join(directory, name + '.yaml');
  writeFileSync(path, `appId: ${app}\n---\n${commands}\n`);
  try {
    execFileSync('maestro', ['--device', device, 'test', path, '--test-output-dir', join(directory, name)],
      { timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`Maestro ${name} failed in ${directory}:\n${error.stdout?.toString()}\n${error.stderr?.toString()}`);
  }
};
const notificationStore = resolve(data, '../../../../Library/UserNotifications');
const notifications = () => JSON.parse(execFileSync('python3', ['-c', `
import json,plistlib,pathlib,sys
root=pathlib.Path(sys.argv[1])
def archive(path):
 p=plistlib.load(path.open('rb'));o=p['$objects']
 def dec(v):
  if isinstance(v,plistlib.UID):return dec(o[v.data])
  if isinstance(v,list):return [dec(x) for x in v]
  if not isinstance(v,dict):return v
  if 'NS.keys' in v:return {str(dec(k)):dec(x) for k,x in zip(v['NS.keys'],v['NS.objects'])}
  if 'NS.objects' in v:return dec(v['NS.objects'])
  return {k:dec(x) for k,x in v.items() if k!='$class'}
 return dec(p['$top']['root'])
mapping=archive(root/'Library.plist')
path=root/mapping[sys.argv[2]]/'DeliveredNotifications.plist'
print(json.dumps(archive(path) if path.exists() else [],default=str))
`, notificationStore, app], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
const widgetProcesses = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  .filter(line => line.includes(bundle + '/PlugIns/ExpoWidgetsTarget.appex/ExpoWidgetsTarget'))
  .map(line => Number(line.trim().split(/\s+/)[0]));

simctl('launch', device, app);
flow('home', '- pressKey: Home');
const hierarchy = JSON.parse(execFileSync('maestro', ['--device', device, 'hierarchy', '--no-ansi', '--no-reinstall-driver'],
  { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 }));
const targets = {};
let viewport;
const bounds = text => text.match(/-?\d+/g).map(Number);
function visit(node, host) {
  const a = node.attributes ?? {};
  if (a.bounds) {
    const rectangle = bounds(a.bounds);
    if (rectangle[0] === 0 && rectangle[1] === 0 && rectangle[2] > 300 && rectangle[3] > 700) viewport = rectangle;
  }
  if (a.text === 'Widget' && a['resource-id'] === 'Puptime') host = bounds(a.bounds);
  const type = /^widget\.log\.(pee|poop|meal)$/.exec(a['resource-id'] ?? '')?.[1];
  if (type && host) {
    // WidgetKit reports control bounds in the remote view's coordinates.
    const [left, top, right, bottom] = bounds(a.bounds);
    targets[type] = [host[0] + (left + right) / 2, host[1] + (top + bottom) / 2];
  }
  node.children?.forEach(child => visit(child, host));
}
visit(hierarchy);
assert.deepEqual(Object.keys(targets).sort(), ['meal', 'pee', 'poop']);
assert.ok(viewport, 'Could not determine the simulator viewport.');
const root = viewport;
const width = root[2] - root[0], height = root[3] - root[1];
assert.ok(width > 300 && height > 700);
// Keep XCTest alive on this simulator. One synthesized record sends the entire
// burst at 120 ms intervals; separate Maestro commands add settling delays.
const driverFlow = join(directory, 'keep-driver.yaml');
writeFileSync(driverFlow, `appId: ${app}\n---\n- extendedWaitUntil:\n    visible:\n      id: nav.open\n    timeout: 180000\n`);
const runnerLines = () => execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  .filter(line => line.includes(`/CoreSimulator/Devices/${device}/`) && line.trim().endsWith('/maestro-driver-iosUITests-Runner'));
const previousRunners = new Set(runnerLines().map(line => Number(line.trim().split(/\s+/)[0])));
const driver = spawn('maestro', ['--device', device, 'test', driverFlow, '--test-output-dir', join(directory, 'driver')], { stdio: ['ignore', 'pipe', 'pipe'] });
let driverOutput = '';
for (const stream of [driver.stdout, driver.stderr]) stream.on('data', chunk => {
  driverOutput += chunk.toString();
  writeFileSync(join(directory, 'driver-output.log'), driverOutput);
});
const stopDriver = () => {
  if (driver.exitCode === null) driver.kill('SIGTERM');
  // Maestro's subprocess can outlive an interrupted CLI. Stop only XCTest
  // processes belonging to this dedicated simulator, leaving other work alone.
  for (const line of execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')) {
    const [pid, executable, ...args] = line.trim().split(/\s+/);
    const runner = executable?.includes(`/CoreSimulator/Devices/${device}/`) && executable.endsWith('/maestro-driver-iosUITests-Runner');
    const test = executable?.endsWith('/xcodebuild') && args.includes('test-without-building') && args.includes(`id=${device}`);
    if (runner || test) { try { process.kill(Number(pid), 'SIGTERM'); } catch {} }
  }
};
process.on('exit', stopDriver);
let runner;
for (let attempt = 0; attempt < 200; attempt++) {
  const line = runnerLines().find(line => !previousRunners.has(Number(line.trim().split(/\s+/)[0])));
  if (line && driverOutput.includes('Assert that id: nav.open is visible')) {
    const pid = Number(line.trim().split(/\s+/)[0]);
    try {
      const port = execFileSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' })
        .match(/n127\.0\.0\.1:(\d+)/)?.[1];
      if (port && (await fetch(`http://127.0.0.1:${port}/status`)).ok) { runner = pid; break; }
    } catch {}
  }
  await pause(100);
}
assert.ok(runner, 'The dedicated simulator XCTest runner did not start.');
const burst = actions => {
  const allocate = name => `((id(*)(id,SEL))objc_msgSend)(NSClassFromString(@"${name}"),NSSelectorFromString(@"alloc"))`;
  const points = actions.map(type => `{${targets[type][0]},${targets[type][1]}}`).join(',');
  const commands = [
    'expression -l objc++ -- @import UIKit; @import Foundation; @import ObjectiveC;',
    `expression -l objc++ -- id $puptimeRecord = ((id(*)(id,SEL,id,long))objc_msgSend)(${allocate('XCSynthesizedEventRecord')}, NSSelectorFromString(@"initWithName:interfaceOrientation:"), @"Puptime rapid widget taps", 1);`,
    `expression -l objc++ -- double points[6][2]={${points}}; for(int i=0;i<6;i++){id p=((id(*)(id,SEL,CGPoint,double))objc_msgSend)(${allocate('XCPointerEventPath')},NSSelectorFromString(@"initForTouchAtPoint:offset:"),CGPointMake(points[i][0],points[i][1]),i*0.12); ((void(*)(id,SEL,double))objc_msgSend)(p,NSSelectorFromString(@"liftUpAtOffset:"),i*0.12+0.01); ((void(*)(id,SEL,id))objc_msgSend)($puptimeRecord,NSSelectorFromString(@"addPointerEventPath:"),p);}`,
    'expression -l objc++ -- id $puptimeSession = ((id(*)(id,SEL))objc_msgSend)(NSClassFromString(@"XCTRunnerDaemonSession"),NSSelectorFromString(@"sharedSession")); id $puptimeProxy = ((id(*)(id,SEL))objc_msgSend)($puptimeSession,NSSelectorFromString(@"daemonProxy")); ((void(*)(id,SEL,id,id))objc_msgSend)($puptimeProxy,NSSelectorFromString(@"_XCT_synthesizeEvent:completion:"),$puptimeRecord,^(NSError *error){NSLog(@"Puptime burst finished: %@",error);});',
    'process detach',
  ];
  const path = join(directory, 'burst.lldb');
  writeFileSync(path, commands.join('\n') + '\n');
  const output = execFileSync('lldb', ['--batch', '-p', String(runner), '-s', path], { encoding: 'utf8', timeout: 60000 });
  writeFileSync(join(directory, 'last-burst.log'), output);
  assert.ok(!output.includes('error:'), 'XCTest gesture synthesis failed.');
};
const results = [], allAdded = [];
for (const cold of [false, true]) {
  if (cold) {
    await pause(500);
    try { simctl('terminate', device, app); } catch {}
    widgetProcesses().forEach(pid => process.kill(pid, 'SIGKILL'));
    await pause(100);
    assert.equal(widgetProcesses().length, 0, 'The widget extension must be stopped before the cold burst.');
  }
  const before = new Set(operations().map(event => event.id));
  const actions = ['pee', 'poop', 'meal', 'pee', 'meal', 'poop'];
  burst(actions);
  let added;
  for (let attempt = 0; attempt < 100; attempt++) {
    added = operations().filter(event => !before.has(event.id)).sort((a, b) => a.at - b.at);
    if (added.length >= actions.length) break;
    await pause(100);
  }
  // AppIntent callbacks may start in the same millisecond after a cold launch.
  assert.deepEqual(added.map(event => event.type).sort(), [...actions].sort(), `${cold ? 'Cold' : 'Warm'} iOS widget taps were lost or misrouted.`);
  let delivered;
  for (let attempt = 0; attempt < 50; attempt++) {
    delivered = notifications();
    if (added.every(event => delivered.some(item => item.UNNotificationUserInfo?.eventId === event.id))) break;
    await pause(100);
  }
  const notificationLatencyMs = added.map(event => {
    const notification = delivered.find(item => item.UNNotificationUserInfo?.eventId === event.id);
    assert.ok(notification, 'Every committed tap must receive a confirmation.');
    assert.equal(notification.InterruptionLevel, 0, 'Confirmations must not cover widget buttons.');
    return Math.round((notification.AppNotificationCreationDate['NS.time'] + 978307200) * 1000 - event.at);
  });
  const persistenceLatencyMs = added.map(event => Math.round(event.persistedAt - event.at));
  assert.ok(persistenceLatencyMs.every(ms => ms >= 0 && ms < 1000));
  results.push({ cold, taps: added.length, injectedTapSpacingMs: 120, measurementStart: 'AppIntent.perform', persistenceLatencyMs, notificationLatencyMs,
    intentStartSpacingMs: added.slice(1).map((event, index) => event.at - added[index].at) });
  allAdded.push(...added);
}
const output = join(homedir(), 'Pictures/Screenshots/Codex/puptime-widget-responsiveness');
mkdirSync(output, { recursive: true });
simctl('io', device, 'screenshot', join(output, 'ios-widget.png'));
simctl('launch', device, app);
for (let attempt = 0; attempt < 100; attempt++) {
  if (allAdded.every(event => database.prepare('SELECT id FROM events WHERE id=?').get(event.id)) && operations().length === 0) break;
  await pause(100);
}
assert.ok(allAdded.every(event => database.prepare('SELECT id FROM events WHERE id=?').get(event.id)), 'Opening the app must import every journaled event.');
assert.equal(operations().length, 0, 'Operations should be acknowledged after the SQLite commit.');
// Exercise the actual app/FileSystem/SQLite import beyond the presentation cap.
simctl('terminate', device, app);
const recovery = Array.from({ length: 250 }, (_, index) => ({ id: 'evt_' + randomBytes(16).toString('hex'), type: 'pee', at: Date.now() - 1000 + index }));
recovery.forEach(event => writeFileSync(join(journal, 'wop_' + randomBytes(16).toString('hex') + '.json'), JSON.stringify(event)));
simctl('launch', device, app);
for (let attempt = 0; attempt < 100; attempt++) {
  if (recovery.every(event => database.prepare('SELECT id FROM events WHERE id=?').get(event.id)) && operations().length === 0) break;
  await pause(100);
}
assert.ok(recovery.every(event => database.prepare('SELECT id FROM events WHERE id=?').get(event.id)), 'All 250 recovery records must import beyond the 100-record presentation cap.');
assert.equal(operations().length, 0);
database.close();
stopDriver();
writeFileSync(join(output, 'ios-verification.json'), JSON.stringify({ device, results, imported: allAdded.length, recovered: recovery.length }, null, 2));
console.log(JSON.stringify({ device, results, imported: allAdded.length, recovered: recovery.length, screenshot: join(output, 'ios-widget.png') }, null, 2));
