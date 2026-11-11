import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import type { PuppyEvent } from './domain.ts';
import { updateNotifications } from './notification-write-queue.ts';

const state = { files: new Map<string, string>(), legacy: [] as unknown[], scope: 'owner', delivery: true, canLog: true, ended:false, expiresAt: null as number|null, snapshot: null as any, actions:['pee','poop','meal'] as string[], events:[] as PuppyEvent[],nativeCalls:0,nativeFailure:false,hold:null as null|(()=>Promise<void>) };
(globalThis as typeof globalThis & { __iosWidgetTest: typeof state }).__iosWidgetTest = state;
const target = new URL('./widgets/sync.ios.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === target) {
      if (specifier === 'expo-modules-core') return {url:'ios-widget:native',shortCircuit:true};
      if (specifier === 'expo-file-system') return { url: 'ios-widget:files', shortCircuit: true };
      if (specifier === 'expo-widgets') return { url: 'ios-widget:widgets', shortCircuit: true };
      if (specifier === './PuptimeWidget.ios') return { url: 'ios-widget:timeline', shortCircuit: true };
      if (specifier === '../care-access') return {url:'ios-widget:access',shortCircuit:true};
      if (specifier === '../storage') return { url: 'ios-widget:storage', shortCircuit: true };
      if (specifier === '../local/runtime.native') return { url: 'ios-widget:runtime', shortCircuit: true };
      if (specifier.startsWith('.')) return next(new URL(specifier + '.ts', context.parentURL).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const mocks: Record<string, string> = {
      'ios-widget:native': `export function requireNativeModule(){return {async syncPuptimePottyReminders(source){s.nativeCalls=(s.nativeCalls??0)+1;if(s.nativeFailure)throw new Error('Native scheduling failed');}};}`,
      'ios-widget:access': `export async function getCareAccess(){return {scope:s.scope,petId:s.scope==='owner'?'owner-pet':s.scope,expiresAt:s.expiresAt,canLog:s.canLog,ended:s.ended};}`,
      'ios-widget:widgets': `export const widgetsDirectory='file:///shared/ExpoWidgets';`,
      'ios-widget:runtime': `export async function getLocalRuntime(){return {petId:s.scope==='owner'?'owner-pet':s.scope,activity:{async latestEvents(){return s.events;}},storage:{async loadQuietStatusEnabled(){return false;},async loadNotificationDelivery(){return s.delivery;},async loadPuppyName(){return 'Biscuit';}}};}`,
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
        async updateSnapshot(props){if(s.hold)await s.hold();s.snapshot=props;s.legacy=props.pending;}
      };`,
      'ios-widget:storage': `
        export async function loadLanguagePreference(){return 'en';}
        export async function loadCustomActivities(){return [];}
        export async function loadThemePreference(){return 'system';}
        export async function loadWidgetActions(){return s.actions;}
        export async function loadNotificationPreferences(){return {widgetConfirmations:true,pottyAfterPee:{enabled:true,delayMinutes:120},pottyAfterMeal:{enabled:true,delayMinutes:30}};}`,
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


test('widget actions remain with their original puppy when the active puppy changes',async()=>{
 state.files.clear();state.legacy=[];state.scope='shared-puppy';
 operation('a',{...event(1),scope:'owner'});operation('b',{...event(2),scope:'shared-puppy'});
 const pending=await widget.readPendingWidgetEvents();assert.deepEqual(pending,[event(2)]);
 await widget.acknowledgePendingWidgetEvents(pending);assert.deepEqual([...state.files.keys()],['wop_a.json']);
 state.scope='owner';assert.deepEqual(await widget.readPendingWidgetEvents(),[event(1)]);
});


test('a late journal refresh cannot publish one puppy’s events into another puppy’s widget',async()=>{
 state.files.clear();state.scope='owner';state.legacy=[event(9)];
 await widget.updateHomeWidget([], 'another-puppy');assert.deepEqual(state.legacy,[event(9)]);
});


test('iOS snapshots publish committed delivery and access rather than captured widget targets',async()=>{
 state.scope='owner';state.delivery=false;state.canLog=true;
 await widget.updateHomeWidget([]);
 assert.equal(state.snapshot.notificationDelivery,false);
 assert.equal(state.snapshot.pottyAfterPeeMinutes,0);assert.equal(state.snapshot.pottyAfterMealMinutes,0);
 state.delivery=true;await widget.updateHomeWidget([]);
 assert.equal(state.snapshot.notificationDelivery,true);assert.equal(state.snapshot.pottyAfterPeeMinutes,120);
 state.canLog=false;state.ended=true;await widget.updateHomeWidget([]);
 assert.equal(state.snapshot.canLog,false);assert.equal(state.snapshot.pottyAfterMealMinutes,0);
 state.canLog=true;state.ended=false;
});

test('an opt-out queued behind a native snapshot write publishes disabled policy last',async()=>{
 state.scope='owner';state.delivery=true;
 let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 state.hold=()=>{entered();return gate;};
 const before=widget.updateHomeWidget([]);await ready;
 state.delivery=false;const after=widget.updateHomeWidget([]);
 state.hold=null;release();await Promise.all([before,after]);
 assert.equal(state.snapshot.notificationDelivery,false);assert.equal(state.snapshot.pottyAfterPeeMinutes,0);
 state.delivery=true;
});

test('conflicting naps remove the widget nap action without disabling other logs',async()=>{
 state.actions=['nap','pee','meal'];
 state.events=[{id:'nap1',type:'nap',at:100,endedAt:null,source:'app'},{id:'nap2',type:'nap',at:200,endedAt:null,source:'app'}];
 await widget.updateHomeWidget([]);
 assert.equal(state.snapshot.openNap,false);assert.equal(state.snapshot.napConflict,true);assert.deepEqual(state.snapshot.actions,['pee','meal']);
 assert.equal(state.snapshot.canLog,true);
 state.actions=['pee','poop','meal'];state.events=[];
});


test('snapshot publishing awaits native reminder reconciliation and propagates failure',async()=>{
 state.scope='owner';state.delivery=true;state.nativeFailure=true;
 await assert.rejects(widget.updateHomeWidget([]),/Native scheduling failed/);
 state.nativeFailure=false;const before=state.nativeCalls;await widget.updateHomeWidget([]);
 assert.equal(state.nativeCalls,before+1);
});


test('an old caller cannot replace committed event timers with its stale array',async()=>{
 state.events=[{id:'latest',type:'pee',at:500,source:'app'}];
 await widget.updateHomeWidget([{id:'old',type:'pee',at:100,source:'app'}]);
 assert.equal(state.snapshot.lastEventAt.pee,500);state.events=[];
});


test('native potty reconciliation shares the host queue with routine and one-off writes',async()=>{
 let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const hostWrite=updateNotifications(async()=>{entered();await gate;});await ready;
 const before=state.nativeCalls;const snapshot=widget.updateHomeWidget([]);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(state.nativeCalls,before);
 release();await Promise.all([hostWrite,snapshot]);assert.equal(state.nativeCalls,before+1);
});


test('view-only carers retain personal potty reminders while logging stays disabled',async()=>{
 state.scope='shared-puppy';state.canLog=false;state.ended=false;state.delivery=true;
 await widget.updateHomeWidget([]);
 assert.equal(state.snapshot.canLog,false);assert.equal(state.snapshot.canNotify,true);
 assert.equal(state.snapshot.pottyAfterPeeMinutes,120);assert.equal(state.snapshot.pottyAfterMealMinutes,30);
 state.scope='owner';state.canLog=true;
});
