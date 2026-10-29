import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import type { PuppyEvent } from './domain.ts';

const state = { files: new Map<string, string>(), legacy: [] as unknown[] };
(globalThis as typeof globalThis & { __iosWidgetTest: typeof state }).__iosWidgetTest = state;
const target = new URL('./widgets/sync.ios.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === target) {
      if (specifier === 'expo-file-system') return { url: 'ios-widget:files', shortCircuit: true };
      if (specifier === 'expo-widgets') return { url: 'ios-widget:widgets', shortCircuit: true };
      if (specifier === './PuptimeWidget.ios') return { url: 'ios-widget:timeline', shortCircuit: true };
      if (specifier === '../storage') return { url: 'ios-widget:storage', shortCircuit: true };
      if (specifier === '../local/runtime.native') return { url: 'ios-widget:runtime', shortCircuit: true };
      if (specifier.startsWith('.')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const mocks: Record<string, string> = {
      'ios-widget:widgets': `export const widgetsDirectory='file:///shared/ExpoWidgets';`,
      'ios-widget:runtime': `export async function getLocalRuntime(){return {petId:'pet_test',storage:{async loadQuietStatusEnabled(){return false;},async loadNotificationDelivery(){return true;},async loadPuppyName(){return 'Biscuit';}}};}`,
      'ios-widget:files': `
        export class File {
          constructor(name){this.name=name;}
          get exists(){return s.files.has(this.name);}
          async text(){return s.files.get(this.name);}
          delete(){s.files.delete(this.name);}
        }
        export class Directory {get exists(){return true;} list(){return [...s.files.keys()].map(name=>new File(name));}}`,
      'ios-widget:timeline': `export default {
        async getTimeline(){return [{props:{pending:s.legacy}}];},
        async updateSnapshot(props){s.legacy=props.pending;}
      };`,
      'ios-widget:storage': `
        export async function loadLanguagePreference(){return 'en';}
        export async function loadCustomActivities(){return [];}
        export async function loadThemePreference(){return 'system';}
        export async function loadWidgetActions(){return ['pee','poop','meal'];}
        export async function loadNotificationPreferences(){return {widgetConfirmations:true,pottyAfterPee:{enabled:false},pottyAfterMeal:{enabled:false}};}`,
    };
    if (mocks[url]) return { format: 'module', shortCircuit: true, source: 'const s=globalThis.__iosWidgetTest;' + mocks[url] };
    return next(url, context);
  },
});
const widget = await import('./widgets/sync.ios.ts');
const event = (index: number): PuppyEvent => ({ id: `evt_widget_${index}`, type: 'pee', at: index + 100, source: 'widget' });
const operation = (name: string, value: unknown) => state.files.set(`wop_${name}.json`, JSON.stringify(value));

test('iOS imports beyond the presentation cap, deduplicates legacy snapshots, and acknowledges only the committed batch', async () => {
  state.files.clear();
  const events = Array.from({ length: 250 }, (_, index) => event(index));
  state.legacy = events.slice(-100);
  events.forEach((value, index) => operation(index.toString(16), value));
  state.files.set('unrelated.json', '{}');
  const pending = await widget.readPendingWidgetEvents();
  assert.equal(pending.length, 250);
  // A save that failed has no acknowledgement; all operation files remain.
  assert.equal(state.files.size, 251);
  operation('abc123', event(251));
  await widget.acknowledgePendingWidgetEvents(pending);
  assert.deepEqual([...state.files.keys()].sort(), ['unrelated.json', 'wop_abc123.json']);
  await widget.updateHomeWidget(pending);
  assert.deepEqual(await widget.readPendingWidgetEvents(), [event(251)]);
});

test('a concurrent nap end survives acknowledgement and wins over an older open snapshot, including zero duration', async () => {
  state.files.clear();
  const nap = { id: 'evt_nap', type: 'nap', at: 100 };
  state.legacy = [nap]; operation('1', nap);
  const started = await widget.readPendingWidgetEvents();
  assert.equal(started[0].endedAt, null);
  operation('2', { ...nap, endedAt: 100 });
  await widget.acknowledgePendingWidgetEvents(started);
  const ended = await widget.readPendingWidgetEvents();
  assert.equal(ended.length, 1); assert.equal(ended[0].endedAt, 100);
  await widget.acknowledgePendingWidgetEvents(ended);
  assert.equal(state.files.size, 0);
});

test('corrupt operations fail visibly and remain available for recovery', async () => {
  state.files.clear(); state.legacy = [];
  state.files.set('wop_bad.json', '{broken');
  await assert.rejects(widget.readPendingWidgetEvents());
  assert.equal(state.files.get('wop_bad.json'), '{broken');
});
