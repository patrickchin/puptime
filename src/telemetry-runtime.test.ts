import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';
import * as policy from './product-telemetry.ts';
import * as ids from './entity-id.ts';

test('installed native PostHog SDK obeys consent, scrubs payloads and rotates identity', async () => {
  // Real installed SDK and native adapter; platform/storage/transport are local.
  // Device acceptance separately checks the actual Android runtime and UI.
  const require = createRequire(import.meta.url), storage = new Map<string, string>();
  const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load, originalFetch = globalThis.fetch;
  const previousKey = process.env.EXPO_PUBLIC_APP_POSTHOG_KEY;
  const previousHost = process.env.EXPO_PUBLIC_APP_POSTHOG_HOST;
  const native = { Platform: { OS: 'android', select: (values: Record<string, unknown>) => values.android ?? values.default },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    Dimensions: { get: () => ({ width: 400, height: 800 }) }, NativeModules: {} };
  const batches: any[] = [];
  let hold = false, aborted = 0, entered: (() => void) | undefined;
  let adapter: any;
  try {
    process.env.EXPO_PUBLIC_APP_POSTHOG_KEY = 'phc_synthetic_native_test';
    process.env.EXPO_PUBLIC_APP_POSTHOG_HOST = 'https://collector.invalid';
    loader._load = function(name, ...args) {
      if (name === 'react-native') return native;
      if (name === 'expo-application') return { nativeApplicationVersion: '1.12.0' };
      return originalLoad.call(this, name, ...args);
    };
    globalThis.fetch = (async (url: string, options: RequestInit) => {
      assert.equal(url.split('?')[0], 'https://collector.invalid/batch/');
      assert.equal(options.credentials, 'omit');
      if (hold) {
        entered?.();
        return await new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => { aborted++; reject(new Error('Request aborted')); }, { once: true });
        });
      }
      let bytes = options.body instanceof Blob ? Buffer.from(await options.body.arrayBuffer()) : Buffer.from(options.body as Uint8Array);
      if (bytes[0] === 31 && bytes[1] === 139) bytes = gunzipSync(bytes);
      batches.push(JSON.parse(bytes.toString()));
      return new Response('{"status":1}', { status: 200 });
    }) as typeof fetch;
    const source = readFileSync(new URL('./telemetry.native.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const modules: Record<string, unknown> = {
      '@react-native-async-storage/async-storage': { getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); } },
      'react-native': native, 'expo-application': { nativeApplicationVersion: '1.12.0' },
      './entity-id': ids, './product-telemetry': policy,
    };
    const module = { exports: {} };
    Function('require', 'module', 'exports', compiled)((name: string) => name in modules ? modules[name] : require(name), module, module.exports);
    adapter = module.exports;
    adapter.productTelemetry.setForeground(true);
    assert.equal(await adapter.initializeAppTelemetry(), false);
    adapter.productTelemetry.capture('app_press', { control: 'quick.pee' });
    await adapter.flushAppTelemetry(); assert.equal(batches.length, 0);
    await adapter.setAppTelemetryEnabled(true);
    assert.equal(await adapter.initializeAppTelemetry(), true, 'remount sees the current saved choice');
    adapter.productTelemetry.capture('app_press', { control: 'quick.pee', press_duration_ms: 750, note: 'PRIVATE_NOTE', email: 'PRIVATE_EMAIL', pet_id: 'PRIVATE_PET' });
    await adapter.flushAppTelemetry();
    assert.ok(batches.length, 'actual SDK produces a batch after opt-in');
    const first = batches.flatMap(value => value.batch);
    assert.ok(first.some(event => event.event === 'app_press' && event.properties.press_duration_ms === 750));
    assert.ok(!JSON.stringify(batches).includes('PRIVATE_'));
    for (const event of first) {
      assert.match(event.distinct_id, /^ano_[a-f0-9]{32}$/);
      assert.equal(event.properties.$process_person_profile, false);
      assert.equal(event.properties.$geoip_disable, true);
      assert.equal(event.properties.$set, undefined);
      assert.equal(event.properties.$device_model, undefined);
    }
    const previousId = first[0].distinct_id;
    adapter.productTelemetry.capture('app_press', { control: 'nav.open' });
    await adapter.setAppTelemetryEnabled(false);
    const count = batches.length;
    await adapter.flushAppTelemetry();
    adapter.productTelemetry.capture('app_press', { control: 'quick.pee' });
    await adapter.flushAppTelemetry(); assert.equal(batches.length, count, 'queued events cannot ship after withdrawal');
    assert.equal(await adapter.initializeAppTelemetry(), false);
    assert.ok(![...storage.values()].join('').includes(previousId), 'withdrawal removes the old anonymous identity');
    await adapter.setAppTelemetryEnabled(true); await adapter.flushAppTelemetry();
    assert.notEqual(batches.at(-1).batch[0].distinct_id, previousId);
    hold = true;
    const started = new Promise<void>(done => { entered = done; });
    adapter.productTelemetry.capture('app_press', { control: 'quick.pee' });
    const pending = adapter.flushAppTelemetry(); await started;
    await adapter.setAppTelemetryEnabled(false); await pending;
    assert.equal(aborted, 1, 'withdrawing consent aborts the in-flight transport');
    assert.equal(await adapter.initializeAppTelemetry(), false);
  } finally {
    await adapter?.setAppTelemetryEnabled(false);
    loader._load = originalLoad; globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.EXPO_PUBLIC_APP_POSTHOG_KEY; else process.env.EXPO_PUBLIC_APP_POSTHOG_KEY = previousKey;
    if (previousHost === undefined) delete process.env.EXPO_PUBLIC_APP_POSTHOG_HOST; else process.env.EXPO_PUBLIC_APP_POSTHOG_HOST = previousHost;
  }
});
