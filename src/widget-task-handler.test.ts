import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { PuppyEvent } from './domain.ts';

const state = {
  enabled:true,delivery:true,scope:'owner',renders:0,events: [] as PuppyEvent[], reads: 0, customReads: 0, redraws: 0,
  confirmations: [] as { eventId: string; type: string; at: number }[],
  hold: Promise.resolve(), readHold: Promise.resolve(), fail: false,
};
(globalThis as typeof globalThis & { __widgetTest: typeof state }).__widgetTest = state;
const handlerUrl = new URL('./widget-task-handler.tsx', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === handlerUrl) {
      if (['./storage', './local/runtime.native', './reminders', './quiet-status', './widgets/sync', './widgets/QuickLogWidget.android'].includes(specifier)) {
        return { url: `widget-test:${specifier}`, shortCircuit: true };
      }
      if (specifier.startsWith('.')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === handlerUrl) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
    const prefix = 'const s=globalThis.__widgetTest;';
    const sources: Record<string, string> = {
      'widget-test:./storage': `
        export async function loadEvents(){throw Error('Widget must not load the full history.');}
        export async function appendEvents(events){await Promise.resolve();if(s.fail)throw Error('disk full');s.events.push(...events);}
        export async function updateEvent(id,changes){await Promise.resolve();s.events=s.events.map(e=>e.id===id?{...e,...changes}:e);}
        export async function loadCustomActivities(){s.customReads++;return ['Training'];}
        export async function loadWidgetActions(){return ['pee','poop','meal'];}
        export async function loadThemePreference(){return 'system';}
        export async function loadNotificationPreferences(){return {widgetConfirmations:true};}
        export async function loadLanguagePreference(){return 'en';}`,
      'widget-test:./local/runtime.native': `
        export function getCareSelection(){return s.scope==='owner'?null:{id:'shared'};}
        export const getRuntimeForCare=()=>getLocalRuntime();
        export async function getLocalRuntime(){return {petId:s.scope,storage:{async loadQuietStatusEnabled(){return s.enabled;},async loadNotificationDelivery(){return s.delivery;},async appendEvents(events){await Promise.resolve();if(s.fail)throw Error('disk full');s.events.push(...events);},async updateEvent(id,changes){await Promise.resolve();s.events=s.events.map(e=>e.id===id?{...e,...changes}:e);}},activity:{async latestEvents(){s.reads++;await s.readHold;return [...s.events];}}};}`,
      'widget-test:./reminders': `
        export function configureReminderHandling(){}
        export async function showWidgetLogConfirmation(reference){s.confirmations.push(reference);return true;}
        export async function syncPottyReminders(){await s.hold;return true;}`,
      'widget-test:./quiet-status': 'export async function syncQuietStatus(){}',
      'widget-test:./widgets/sync': 'export async function updateHomeWidget(){s.redraws++;}',
      'widget-test:./widgets/QuickLogWidget.android': 'export function QuickLogWidget(){return null;}',
    };
    if (sources[url]) return { format: 'module', shortCircuit: true, source: prefix + sources[url] };
    return next(url, context);
  },
});
const { widgetTaskHandler } = await import('./widget-task-handler.tsx');
const tap = (type: string, tapAt: number,allowRender=false,notification?:{source:string;petId:string}) => widgetTaskHandler({
  widgetAction: 'WIDGET_CLICK', clickAction: 'LOG_EVENT', clickActionData: { type, tapAt, ...notification },
  widgetInfo: { widgetId: 1, widgetName: 'PuptimeQuickLog', width: 300, height: 100,
    screenInfo: { screenHeightDp: 900, screenWidthDp: 400, density: 2, densityDpi: 320 } },
  renderWidget() { if(allowRender){state.renders++;return;}throw Error('A tap must not redraw the same widget twice.'); },
});
function reset() {
  Object.assign(state, { enabled:true,delivery:true,scope:'owner',renders:0,events: [], reads: 0, customReads: 0, redraws: 0, confirmations: [], hold: Promise.resolve(), readHold: Promise.resolve(), fail: false });
}

test('confirmation starts after the save without waiting for widget history queries', async () => {
  reset();
  let release!: () => void;
  state.readHold = new Promise<void>(resolve => { release = resolve; });
  const pending = tap('pee', 123456);
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(state.events.length, 1);
    assert.equal(state.confirmations.length, 1);
    assert.equal(state.redraws, 0);
  } finally { release(); await pending; }
});

test('rapid different taps persist and confirm before slow reminders finish, with populated history', async () => {
  reset();
  state.events = Array.from({ length: 1000 }, (_, index) => ({ id: `evt_${index}`, type: 'pee', at: index + 1, source: 'app' }));
  let release!: () => void;
  state.hold = new Promise<void>(resolve => { release = resolve; });
  const first = tap('pee', 123456), second = tap('poop', 123457), third = tap('meal', 123458);
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.deepEqual(state.events.slice(1000).map(e => [e.type, e.at, e.source]), [
      ['pee', 123456, 'widget'], ['poop', 123457, 'widget'], ['meal', 123458, 'widget'],
    ]);
    assert.equal(new Set(state.events.map(e => e.id)).size, 1003);
    assert.equal(state.confirmations.length, 3);
    assert.equal(state.redraws, 0);
    assert.equal(state.customReads, 0);
    assert.equal(state.reads, 0);
  } finally { release(); await Promise.all([first, second, third]); }
  assert.equal(state.redraws, 1);
  assert.equal(state.reads, 1);
});

test('rapid nap taps start then end one nap', async () => {
  reset(); await Promise.all([tap('nap', 123456), tap('nap', 123457)]);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].endedAt, 123457);
  assert.equal(state.confirmations[0].eventId, state.confirmations[1].eventId);
});

test('a failed write never confirms and does not block the next tap; custom actions are validated', async () => {
  reset(); state.fail = true;
  await assert.rejects(tap('pee', 123456), /disk full/);
  assert.equal(state.confirmations.length, 0);
  state.fail = false;
  await tap('custom:training', 123457); await tap('custom:removed', 123458);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].customLabel, 'Training');
});


test('a queued Android widget tap cannot write to a puppy selected after the tap',async()=>{
 reset();let release!:()=>void;state.readHold=new Promise<void>(resolve=>{release=resolve;});
 const first=tap('nap',123456);await new Promise(resolve=>setImmediate(resolve));
 const queued=tap('pee',123457,true);await new Promise(resolve=>setImmediate(resolve));
 state.scope='another-puppy';release();await Promise.all([first,queued]);
 assert.deepEqual(state.events.map(event=>event.type),['nap']);assert.equal(state.renders,1);
 assert.deepEqual(state.confirmations.map(event=>event.type),['nap']);
});

test('notification actions stay in the background and reject disabled or stale pet cards', async () => {
  reset();
  const notification = {source:'notification',petId:'owner'};
  await tap('pee',123456,false,notification);
  assert.equal(state.events.length,1);
  state.enabled=false;await tap('poop',123457,false,notification);
  state.enabled=true;state.delivery=false;await tap('meal',123458,false,notification);
  state.delivery=true;await tap('pee',123459,false,{...notification,petId:'pet_old'});
  assert.equal(state.events.length,1);
  assert.equal(state.confirmations.length,1);
});
