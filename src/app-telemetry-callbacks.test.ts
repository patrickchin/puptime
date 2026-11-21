import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createProductTelemetry, type ProductEvent, type ProductProperties } from './product-telemetry.ts';
import { EventDeletedError } from './storage-validation.ts';

// Execute the actual callbacks without loading App, native modules or a transport.
function callback(file: string, name: string, dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) matches.push(node.initializer);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.equal(matches.length, 1, name);
  const javascript = ts.transpileModule(`const actual = ${matches[0].getText(source).replace(/^export /, '')};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(dependencies), javascript + '\nreturn actual;')(...Object.values(dependencies));
}

function fixture() {
  const events: { event: ProductEvent; properties: ProductProperties }[] = [];
  const telemetry = createProductTelemetry((event, properties) => events.push({ event, properties }));
  telemetry.setForeground(true); telemetry.setEnabled(true); events.length = 0;
  const writes: string[] = [];
  const dependencies = {
    productTelemetry: telemetry, EventDeletedError, nativeApp: true,
    removeEvent: async () => { writes.push('delete'); },
    updateEvent: async () => { writes.push('edit'); },
    saveCustomActivity: async () => { writes.push('custom'); return []; },
    refreshCommittedState: async () => { writes.push('refresh'); },
    setNapAdjustments() {}, setCustomActivities() {}, customActivities: [],
    activityKey: (event: { type: string; customLabel?: string }) => event.customLabel ?? event.type,
    Haptics: { selectionAsync: async () => {} },
  };
  return { events, writes, telemetry, dependencies,
    errors: () => events.filter(event => event.event === 'app_error'),
    load: (name: string) => callback('../App.tsx', name, dependencies) };
}
const event = { id: 'evt_synthetic_private', type: 'pee', at: 1, source: 'app', note: 'PRIVATE_NOTE' };

test('actual edit/delete write rejection emits once, preserves the error and leaves existing recovery UI intact', async () => {
  for (const name of ['saveEventDetails', 'deleteEvent']) {
    const f = fixture(), failure = new Error('PRIVATE_STORAGE_MESSAGE');
    f.dependencies.updateEvent = f.dependencies.removeEvent = async () => { throw failure; };
    const operation = f.load(name);
    await assert.rejects(operation(event, { note: 'PRIVATE_EDIT' }), error => error === failure);
    assert.deepEqual(f.errors(), [{ event: 'app_error', properties: { screen: 'log', schema_version: 1, error_code: 'local_write_failed' } }]);
    assert.deepEqual(f.writes, []);

    let status = '', deleteFailed = false;
    const dependencies = {
      EventDeletedError, pendingDelete: event, deleting: false, onDelete: operation,
      setDeleting() {}, setDeleteFailed: (value: boolean) => { deleteFailed = value; }, setPendingDelete() {},
      setSaveStatus: (value: string) => { status = value; },
      inFlightRevisionRef: { current: -1 }, sessionRef: { current: 1 }, revisionRef: { current: 1 },
      savedRevisionRef: { current: 0 }, latestSaveRef: { current: Promise.resolve(true) },
      draftSaverRef: { current: { save: () => operation(event, { note: 'PRIVATE_EDIT' }) } },
    };
    f.events.length = 0;
    if (name === 'saveEventDetails') {
      assert.equal(await callback('./screens/LogScreen.tsx', 'persistDraft', dependencies)({}, 1, 1), false);
      assert.equal(status, 'error');
    } else {
      await callback('./screens/LogScreen.tsx', 'confirmDelete', dependencies)();
      assert.equal(deleteFailed, true);
    }
    assert.equal(f.errors().length, 1);
    assert.ok(!JSON.stringify(f.events).includes('PRIVATE'));
  }
});

test('success, refresh-only errors, expected deletion and cancelled deletion do not report write failures', async () => {
  for (const name of ['saveEventDetails', 'deleteEvent']) {
    const f = fixture(); await f.load(name)(event, { note: 'PRIVATE_EDIT' });
    assert.deepEqual(f.writes, [name === 'deleteEvent' ? 'delete' : 'edit', 'refresh']);
    assert.deepEqual(f.errors(), []);
    const readFailure = new Error('PRIVATE_READ_FAILURE');
    f.dependencies.refreshCommittedState = async () => { throw readFailure; };
    await assert.rejects(f.load(name)(event, {}), error => error === readFailure);
    assert.deepEqual(f.errors(), []);
    const deleted = new EventDeletedError();
    f.dependencies.updateEvent = f.dependencies.removeEvent = async () => { throw deleted; };
    await assert.rejects(f.load(name)(event, {}), error => error === deleted);
    assert.deepEqual(f.errors(), []);
    if (name === 'saveEventDetails') {
      let status = '';
      const refs = { EventDeletedError, setSaveStatus: (value: string) => { status = value; },
        inFlightRevisionRef: { current: -1 }, sessionRef: { current: 1 }, revisionRef: { current: 1 },
        savedRevisionRef: { current: 0 }, latestSaveRef: { current: Promise.resolve(true) },
        draftSaverRef: { current: { save: () => f.load(name)(event, {}) } } };
      assert.equal(await callback('./screens/LogScreen.tsx', 'persistDraft', refs)({}, 1, 1), false);
      assert.equal(status, 'deleted'); assert.deepEqual(f.errors(), []);
    }
  }
  let calls = 0;
  await callback('./screens/LogScreen.tsx', 'confirmDelete', { pendingDelete: null, deleting: false, onDelete: () => { calls++; } })();
  assert.equal(calls, 0);
});

test('web custom write rejects once; edit/delete failure capture remains opt-in, foreground-only and nonthrowing', async () => {
  const web = fixture(), failure = new Error('PRIVATE_CUSTOM_FAILURE');
  web.dependencies.nativeApp = false;
  web.dependencies.saveCustomActivity = async () => { throw failure; };
  await assert.rejects(web.load('saveEventDetails')(event, { type: 'custom', customLabel: 'PRIVATE_LABEL' }), error => error === failure);
  assert.equal(web.errors().length, 1); assert.deepEqual(web.writes, []);
  for (const name of ['saveEventDetails', 'deleteEvent']) for (const mode of ['optout', 'background', 'broken-sender']) {
    const f = fixture();
    if (mode === 'optout') f.telemetry.setEnabled(false);
    if (mode === 'background') f.telemetry.setForeground(false);
    if (mode === 'broken-sender') {
      const telemetry = createProductTelemetry(() => { throw new Error('PRIVATE_TRANSPORT_FAILURE'); });
      telemetry.setEnabled(true); telemetry.setForeground(true); f.dependencies.productTelemetry = telemetry;
    }
    f.dependencies.updateEvent = f.dependencies.removeEvent = async () => { throw failure; };
    await assert.rejects(f.load(name)(event, {}), error => error === failure);
    assert.deepEqual(f.errors(), []);
  }
});

test('actual sharing hooks own setup account time and restore sharing and nested foreground timing once', () => {
  let now = 0;
  const events: { event: ProductEvent; properties: ProductProperties }[] = [];
  const telemetry = createProductTelemetry((event, properties) => events.push({ event, properties }), () => now);
  telemetry.setScreen('pets'); telemetry.setForeground(true); telemetry.setEnabled(true);
  let cleanup: (() => void) | undefined;
  const hook = callback('./telemetry.native.ts', 'useTelemetryOverlay', {
    productTelemetry: telemetry, useEffect: (effect: () => (() => void) | undefined) => { cleanup = effect(); },
  });
  function mount(file: string, setup = false) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls: ts.CallExpression[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'useTelemetryOverlay') calls.push(node);
      ts.forEachChild(node, visit);
    }
    visit(source); assert.equal(calls.length, 1);
    const args = Function('setup', `return [${calls[0].arguments.map(arg => arg.getText(source)).join(',')}];`)(setup);
    hook(...args); return cleanup;
  }
  now = 100; const closeSharing = mount('./screens/SharePuppyScreen.tsx');
  now = 200; const closeShared = mount('./screens/SharedPuppiesScreen.tsx');
  now = 300; closeShared?.();
  now = 400; closeSharing?.();
  const closeAccount = mount('./screens/SharePuppyScreen.tsx', true);
  now = 500; closeAccount?.();
  const closeReturnedSharing = mount('./screens/SharePuppyScreen.tsx');
  now = 600; const closeReturnedShared = mount('./screens/SharedPuppiesScreen.tsx');
  now = 700; closeReturnedShared?.();
  now = 800; closeReturnedSharing?.();
  assert.deepEqual(events.filter(row => row.event === 'app_screen_view').map(row => row.properties.screen), ['pets', 'sharing', 'shared_puppies', 'sharing', 'pets', 'account', 'pets', 'sharing', 'shared_puppies', 'sharing', 'pets']);
  const time = (screen: string) => events.filter(row => row.event === 'app_screen_time' && row.properties.screen === screen).reduce((sum, row) => sum + Number(row.properties.duration_ms), 0);
  assert.equal(time('sharing'), 400); assert.equal(time('shared_puppies'), 200); assert.equal(time('account'), 100);
  assert.equal(events.filter(row => row.event === 'app_screen_time').reduce((sum, row) => sum + Number(row.properties.duration_ms), 0), 800);
});
