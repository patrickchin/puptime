import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {DEFAULT_NOTIFICATION_PREFERENCES} from './notification-config.ts';

// Exercise the real scheduler with the OS boundary replaced; native prompt
// and scheduled-request inspection are qualified separately on the simulator.
const state={delivery:false,granted:true,canAskAgain:true,answer:true,requests:0,writes:[] as boolean[],scheduled:[] as Array<{identifier:string;[key:string]:unknown}>,cancelled:[] as string[],hold:null as null|(()=>Promise<void>),scheduleHold:null as null|(()=>Promise<void>)};
(globalThis as typeof globalThis&{__puptimeNotificationTest:typeof state}).__puptimeNotificationTest=state;
registerHooks({
 resolve(specifier,context,next){
  if(context.parentURL===new URL('./reminders.ts',import.meta.url).href){
   if(specifier==='expo-notifications')return {url:'puptime-test:notifications',shortCircuit:true};
   if(specifier==='react-native')return {url:'puptime-test:platform',shortCircuit:true};
   if(specifier==='./cloud/notification-delivery')return {url:'puptime-test:delivery',shortCircuit:true};
   if(specifier.startsWith('.'))return next(new URL(specifier+'.ts',context.parentURL).href,context);
  }
  return next(specifier,context);
 },
 load(url,context,next){
  if(url==='puptime-test:platform')return {format:'module',source:"export const Platform={OS:'ios'};",shortCircuit:true};
  if(url==='puptime-test:delivery')return {format:'module',source:'const s=globalThis.__puptimeNotificationTest;export async function getNotificationDelivery(){return s.delivery;} export async function setNotificationDelivery(value){s.delivery=value;s.writes.push(value);}',shortCircuit:true};
  if(url==='puptime-test:notifications')return {format:'module',shortCircuit:true,source:`
   const s=globalThis.__puptimeNotificationTest;
   export const IosAuthorizationStatus={PROVISIONAL:3,EPHEMERAL:4};
   export const SchedulableTriggerInputTypes={DATE:'date',DAILY:'daily'};
   export async function getPermissionsAsync(){return {granted:s.granted,canAskAgain:s.canAskAgain};}
   export async function requestPermissionsAsync(){if(s.writes.at(-1)!==true)throw new Error('Persist device intent before prompting.');s.requests++;s.granted=s.answer;return {granted:s.granted,canAskAgain:false};}
   export async function getAllScheduledNotificationsAsync(){if(s.hold)await s.hold();return structuredClone(s.scheduled);}
   export async function cancelScheduledNotificationAsync(id){s.cancelled.push(id);s.scheduled=s.scheduled.filter(item=>item.identifier!==id);}
   export async function scheduleNotificationAsync(value){if(s.scheduleHold)await s.scheduleHold();s.scheduled.push(value);}
   export async function setNotificationCategoryAsync(){}
  `};
  return next(url,context);
 }
});
const reminders=await import('./reminders.ts');
const routine={id:'break',type:'pee' as const,minutes:420,reminder:true};
function reset(){Object.assign(state,{delivery:false,granted:true,canAskAgain:true,answer:true,requests:0,writes:[],scheduled:[],cancelled:[],hold:null,scheduleHold:null});}

test('device delivery off cancels only owned reminders even with granted permission and synced preferences',async()=>{
 reset();state.scheduled=[{identifier:'puptime-routine-old'},{identifier:'puptime-activity-afterPee'},{identifier:'puptime-widget-keep'},{identifier:'another-request'}];
 const now=Date.now();
 assert.equal(await reminders.syncScheduleReminders([routine]),false);
 assert.equal(await reminders.syncPottyReminders([{id:'fresh',type:'pee',at:now,source:'app'}],DEFAULT_NOTIFICATION_PREFERENCES,'en',now),false);
 assert.deepEqual(state.scheduled.map(value=>value.identifier),['puptime-widget-keep','another-request']);
 assert.equal(state.requests,0);
});

test('explicit opt-in is saved before allow deny or blocked permission actions',async()=>{
 for(const [granted,canAskAgain,answer,expected,requests] of [[false,true,true,true,1],[false,true,false,false,1],[false,false,false,false,0],[true,false,true,true,0]]){
  reset();Object.assign(state,{granted,canAskAgain,answer});
  assert.equal(await reminders.requestReminderPermission(),expected);assert.equal(state.requests,requests);assert.deepEqual(state.writes,[true]);
 }
});

test('delivery opt-in still requires current OS access and never replays old restored potty logs',async()=>{
 reset();state.delivery=true;
 await reminders.syncScheduleReminders([routine]);assert.equal(state.scheduled.length,1);
 state.granted=false;assert.equal(await reminders.syncScheduleReminders([routine]),false);assert.equal(state.scheduled.length,0);
 state.granted=true;const now=Date.now();
 assert.equal(await reminders.syncPottyReminders([{id:'old',type:'pee',at:now-86400000,source:'app'}],DEFAULT_NOTIFICATION_PREFERENCES,'en',now),true);assert.equal(state.scheduled.length,0);
 assert.equal(await reminders.syncPottyReminders([{id:'fresh',type:'pee',at:now,source:'app'}],DEFAULT_NOTIFICATION_PREFERENCES,'en',now),true);assert.equal(state.scheduled.length,1);
 state.delivery=false;await reminders.syncPottyReminders([],DEFAULT_NOTIFICATION_PREFERENCES,'en',now);assert.equal(state.scheduled.length,0);
});

test('turning delivery off wins over a notification write already in flight',async()=>{
 reset();state.delivery=true;
 let release!:()=>void,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 state.scheduleHold=()=>{entered();return gate;};
 const previous=reminders.syncScheduleReminders([routine]);await ready;
 state.delivery=false;const disable=reminders.syncScheduleReminders([]);
 await new Promise(resolve=>setImmediate(resolve));release();await Promise.all([previous,disable]);
 assert.deepEqual(state.scheduled,[]);
});
