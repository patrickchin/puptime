// One CI-owned app copy and simulator; never reuse an account, host artifact or data.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, cpSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteOwnedSimulator, installTaskCleanup, ownProcess } from './native-task-cleanup.mjs';
import { standardFixtureEnvironment } from './native-standard-suite.mjs';

const expected = { version: '3.51.3', sourceId: '2026-03-13 10:38:09 737ae4a34738ffa0c3ff7f9bb18df914dd1cad163f28fd6b6e114a344fe6d618' };
const postimages = ['abc152fd93810c76628dcf415e66e6cdd3182ce1ede4f45a5ea8c64b83dc1dfe', '1be81cbb8a2cc6d943cd9f15f48001aa14073bcba750d8b475e0f7892bfca606'];
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function readSqliteEngineReceipt(path) {
  let descriptor;
  try {
    const directory = dirname(path);
    assert.equal(realpathSync(directory), directory); assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor); assert.ok(before.isFile() && before.size > 0 && before.size <= 256);
    const bytes = Buffer.alloc(257); let length = 0;
    while (length < bytes.length) { const count = readSync(descriptor, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    const after = fstatSync(descriptor), current = lstatSync(path);
    assert.ok(current.isFile() && !current.isSymbolicLink() && length === before.size && length <= 256);
    for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) { assert.equal(after[field], before[field]); assert.equal(current[field], before[field]); }
    const raw = bytes.subarray(0, length); assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(raw), JSON.stringify(expected));
    return raw;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

async function bundleProbe(copy, environment, own) {
  const child = spawn(process.execPath, ['node_modules/expo/bin/cli', 'export:embed', '--entry-file', 'index.sqlite-engine-probe.js', '--platform', 'ios', '--dev', 'false', '--bytecode', '--max-workers', '2', '--bundle-output', join(copy, 'main.jsbundle'), '--assets-dest', copy], { env: environment, stdio: 'ignore', detached: true });
  const stop = ownProcess(child); own(stop); let timer;
  try {
    await new Promise((passed, failed) => {
      timer = setTimeout(() => { void stop().then(() => failed(new Error('Engine probe export timed out.'))); }, 600000);
      child.once('error', failed); child.once('close', code => code === 0 ? passed() : failed(new Error('Engine probe export failed.')));
    });
    assert.ok(await stop(), 'Stop the owned export process group.');
  } finally { clearTimeout(timer); }
}

export async function verifyIosSqliteEngine() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.GITHUB_REPOSITORY, 'patrickchin/puptime'); assert.equal(process.platform, 'darwin');
  const runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT;
  assert.match(runId ?? '', /^[1-9][0-9]{0,19}$/); assert.match(attempt ?? '', /^[1-9][0-9]{0,14}$/); assert.ok(Number.isSafeInteger(Number(attempt)));
  const environment = standardFixtureEnvironment(process.env, 'https://127.0.0.1:1');
  delete environment.EXPO_OVERRIDE_METRO_CONFIG;
  const command = (binary, args, timeout = 120000) => execFileSync(binary, args, { encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'ignore'], timeout }).trim();
  const source = command('git', ['rev-parse', 'HEAD']), tree = command('git', ['rev-parse', 'HEAD^{tree}']);
  assert.match(source, /^[a-f0-9]{40}$/); assert.match(tree, /^[a-f0-9]{40}$/);
  const root = realpathSync(process.cwd()), host = join(root, 'build/ios-simulator/Build/Products/Release-iphonesimulator/Puptime.app');
  assert.ok(lstatSync(host).isDirectory() && !lstatSync(host).isSymbolicLink());
  const output = join(root, 'build/sqlite-engine-check'); assert.ok(!existsSync(output)); mkdirSync(output, { mode: 0o700 });
  const privateDirectory = mkdtempSync(join(tmpdir(), 'puptime-engine-ci-')), copy = join(privateDirectory, 'Puptime.app');
  const cleanup = { processesStopped: false, simulatorDeleted: false, copyRemoved: false };
  let device, stopBundle, failure, phase = 'source', hostHashes, engineBytes, probeBundleSHA256;
  const task = installTaskCleanup(async () => {
    try { cleanup.processesStopped = stopBundle ? await stopBundle() : true; assert.ok(cleanup.processesStopped); }
    finally {
      try { cleanup.simulatorDeleted = device ? deleteOwnedSimulator({ device, privateDirectory, preserve: false, command: (...args) => command('xcrun', ['simctl', ...args], 30000) }).deleted : true; assert.ok(cleanup.simulatorDeleted); }
      finally { rmSync(privateDirectory, { recursive: true, force: true }); cleanup.copyRemoved = !existsSync(privateDirectory); assert.ok(cleanup.copyRemoved); }
    }
  });
  try {
    assert.deepEqual(['sqlite3.c', 'sqlite3.h'].map(name => hash(join(root, 'node_modules/expo-sqlite/vendor/sqlite3', name))), postimages);
    hostHashes = ['Puptime', 'main.jsbundle'].map(name => hash(join(host, name)));
    phase = 'bundle'; cpSync(host, copy, { recursive: true, dereference: true, force: false, errorOnExist: true });
    await bundleProbe(copy, environment, stop => { stopBundle = stop; });
    phase = 'sign'; command('codesign', ['--force', '--deep', '--sign', '-', copy]); probeBundleSHA256 = hash(join(copy, 'main.jsbundle'));
    assert.deepEqual(['Puptime', 'main.jsbundle'].map(name => hash(join(host, name))), hostHashes, 'Keep the just-built host unchanged.');
    phase = 'create';
    const runtime = JSON.parse(command('xcrun', ['simctl', 'list', 'runtimes', '-j'])).runtimes.filter(item => item.isAvailable && item.identifier.includes('iOS-26')).at(-1); assert.ok(runtime);
    device = command('xcrun', ['simctl', 'create', `Puptime SQLite Engine CI ${runId} ${attempt}`, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', runtime.identifier]);
    assert.match(device, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
    phase = 'boot'; command('xcrun', ['simctl', 'boot', device]); command('xcrun', ['simctl', 'bootstatus', device, '-b'], 300000);
    phase = 'install'; command('xcrun', ['simctl', 'install', device, copy], 180000);
    const container = command('xcrun', ['simctl', 'get_app_container', device, 'com.patrickchin.puptime', 'data']), receipt = join(container, 'Documents/sqlite-engine-probe.json');
    assert.equal(realpathSync(container), container); mkdirSync(dirname(receipt), { recursive: true });
    assert.equal(realpathSync(dirname(receipt)), dirname(receipt)); rmSync(receipt, { force: true });
    phase = 'launch'; command('xcrun', ['simctl', 'launch', device, 'com.patrickchin.puptime']);
    phase = 'receipt'; const deadline = Date.now() + 60000;
    while (!existsSync(receipt) || lstatSync(receipt).size === 0) { assert.ok(Date.now() < deadline && task.signal === null, 'Require the native engine receipt.'); await new Promise(done => setTimeout(done, 250)); }
    engineBytes = readSqliteEngineReceipt(receipt); assert.equal(task.signal, null);
  } catch (error) { failure = error; }
  finally {
    try { await task.run(); } catch (error) { failure ??= error; } finally { task.dispose(); }
    try {
      if (hostHashes) assert.deepEqual(['Puptime', 'main.jsbundle'].map(name => hash(join(host, name))), hostHashes);
      if (!failure) writeFileSync(join(output, 'sqlite-engine-probe.json'), engineBytes, { mode: 0o600, flag: 'wx' });
      writeFileSync(join(output, 'sqlite-engine-provenance.json'), JSON.stringify({ schemaVersion: 1, stage: 'sqlite-engine-ci', status: failure ? 'failed' : 'passed', phase, checkoutCommit: source, checkoutTree: tree, runId, runAttempt: Number(attempt), device: device ?? null, nativeHostSHA256: hostHashes?.[0] ?? null, probeBundleSHA256: probeBundleSHA256 ?? null, cleanup }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    } catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 2); await verifyIosSqliteEngine(); }
  catch { console.error('SQLite engine CI check failed.'); process.exitCode = 1; }
}
