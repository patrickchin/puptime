import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {DEFAULT_NOTIFICATION_PREFERENCES} from './notification-config.ts';

// Exercise the real scheduler with the OS boundary replaced; native prompt
// and scheduled-request inspection are qualified separately on the simulator.
type MockRequest = { identifier: string; content?: { title?: string; data?: Record<string, unknown> }; trigger?: { type?: string; date?: number; repeats?: boolean; seconds?: number }; [key: string]: unknown };
const platform={OS:'ios'};
(globalThis as typeof globalThis&{__puptimeNotificationPlatform:typeof platform}).__puptimeNotificationPlatform=platform;
const state={handler:null as null|{handleNotification:(value:{request:{content:{data:{kind:string}}}})=>Promise<{shouldShowBanner:boolean;shouldShowList:boolean;shouldPlaySound:boolean;shouldSetBadge:boolean}>},delivery:false,granted:true,exactAllowed:true,canAskAgain:true,answer:true,requests:0,writes:[] as boolean[],scheduled:[] as MockRequest[],cancelled:[] as string[],hold:null as null|(()=>Promise<void>),scheduleHold:null as null|(()=>Promise<void>),failure:null as null|'list'|'create'|'cancel',nextId:0};
(globalThis as typeof globalThis&{__puptimeNotificationTest:typeof state}).__puptimeNotificationTest=state;
registerHooks({
 resolve(specifier,context,next){
  if(context.parentURL===new URL('./reminders.ts',import.meta.url).href){
   if(specifier==='expo-notifications')return {url:'puptime-test:notifications',shortCircuit:true};
   if(specifier==='react-native')return {url:'puptime-test:platform',shortCircuit:true};
   if(specifier==='./cloud/notification-delivery')return {url:'puptime-test:delivery',shortCircuit:true};
   if(specifier==='./exact-reminders')return {url:'puptime-test:exact',shortCircuit:true};
   if(specifier.startsWith('.'))return next(new URL(specifier+'.ts',context.parentURL).href,context);
  }
  return next(specifier,context);
 },
 load(url,context,next){
  if(url==='puptime-test:platform')return {format:'module',source:'export const Platform=globalThis.__puptimeNotificationPlatform;',shortCircuit:true};
  if(url==='puptime-test:exact')return {format:'module',source:'export async function refreshExactReminderScheduling(){return globalThis.__puptimeNotificationTest.exactAllowed;}',shortCircuit:true};
  if(url==='puptime-test:delivery')return {format:'module',source:'const s=globalThis.__puptimeNotificationTest;export async function getNotificationDelivery(){return s.delivery;} export async function setNotificationDelivery(value){s.delivery=value;s.writes.push(value);}',shortCircuit:true};
  if(url==='puptime-test:notifications')return {format:'module',shortCircuit:true,source:`
   const s=globalThis.__puptimeNotificationTest;
   export const IosAuthorizationStatus={PROVISIONAL:3,EPHEMERAL:4};
   export const SchedulableTriggerInputTypes={DATE:'date',DAILY:'daily'};
   export async function getPermissionsAsync(){return {granted:s.granted,canAskAgain:s.canAskAgain};}
   export async function requestPermissionsAsync(){if(s.writes.at(-1)!==true)throw new Error('Persist device intent before prompting.');s.requests++;s.granted=s.answer;return {granted:s.granted,canAskAgain:false};}
   export async function getAllScheduledNotificationsAsync(){if(s.hold)await s.hold();if(s.failure==='list')throw new Error('native list failed');return structuredClone(s.scheduled).map(item=>item.trigger?.type==='date'?{...item,trigger:{type:'timeInterval',repeats:false,seconds:(item.trigger.date-Date.now())/1000}}:item);}
   export async function cancelScheduledNotificationAsync(id){if(s.failure==='cancel')throw new Error('native cancel failed');s.cancelled.push(id);s.scheduled=s.scheduled.filter(item=>item.identifier!==id);}
   export async function scheduleNotificationAsync(value){if(s.scheduleHold)await s.scheduleHold();if(s.failure==='create')throw new Error('native create failed');const identifier=value.identifier??'native-'+(++s.nextId);s.scheduled.push({...value,identifier});return identifier;}
   export function setNotificationHandler(handler){s.handler=handler;}
   export async function setNotificationCategoryAsync(){}
   export const AndroidImportance={DEFAULT:3};
   export async function setNotificationChannelAsync(){}
  `};
  return next(url,context);
 }
});
const reminders=await import('./reminders.ts');
const routine={id:'break',type:'pee' as const,minutes:420,reminder:true};
function reset(){Object.assign(state,{delivery:false,granted:true,exactAllowed:true,canAskAgain:true,answer:true,requests:0,writes:[],scheduled:[],cancelled:[],hold:null,scheduleHold:null,failure:null,nextId:0});}

test('Android one-off reminders require exact access without blocking immediate widget confirmations',async()=>{
 reset();platform.OS='android';state.delivery=true;state.exactAllowed=false;
 try{
  await assert.rejects(reminders.createCustomTimedReminder({petId:'pet_test',label:'A precise reminder',at:Date.now()+60000}),reminders.ExactReminderAccessError);
  assert.equal(state.scheduled.length,0);
  assert.equal(await reminders.showWidgetLogConfirmation({eventId:'evt_test',type:'pee',at:Date.now()}),true);
  assert.equal(state.scheduled.length,1);
 }finally{platform.OS='ios';}
});

test('quiet status reaches the foreground list without a banner, sound or badge while reminder alerts still work',async()=>{
 reminders.configureReminderHandling();
 assert.ok(state.handler);
 const behavior=(kind:string)=>state.handler!.handleNotification({request:{content:{data:{kind}}}});
 assert.deepEqual(await behavior('quietStatus'),{shouldShowBanner:false,shouldShowList:true,shouldPlaySound:false,shouldSetBadge:false});
 assert.deepEqual(await behavior('pottyReminder'),{shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false});
});

test('Android widget confirmations deliver immediately on their channel with editable event references',async()=>{
 reset();platform.OS='android';
 try {
  const reference={eventId:'evt_widget',type:'pee' as const,at:123456};
  assert.equal(await reminders.showWidgetLogConfirmation(reference),true);
  assert.deepEqual(state.scheduled[0].trigger,{channelId:'puptime-widget-log'});
  assert.deepEqual(state.scheduled[0].content?.data,{kind:'widgetLog',...reference});
  state.granted=false;
  assert.equal(await reminders.showWidgetLogConfirmation(reference),false);
  assert.equal(state.scheduled.length,1);
 } finally {platform.OS='ios';}
});

test('the OS scheduler applies independent signed meal and poop offsets',async()=>{
 reset();state.delivery=true;
 const preferences={...DEFAULT_NOTIFICATION_PREFERENCES,mealReminderOffsetMinutes:-15 as const,poopReminderOffsetMinutes:30 as const};
 await reminders.syncScheduleReminders([{id:'rtn_meal',type:'meal',minutes:5,reminder:true},{id:'rtn_poop',type:'poop',minutes:1430,reminder:true}],preferences);
 assert.deepEqual(state.scheduled.map(request=>request.trigger),[
  {type:'daily',hour:23,minute:50,channelId:'puptime-routine'},
  {type:'daily',hour:0,minute:20,channelId:'puptime-routine'},
 ]);
});

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
 assert.equal(state.scheduled.length,0);
});


const timedInput={petId:'puppy / 🐾',label:'Give flea treatment',at:Date.now()+3600000};

test('custom one-off uses native durable requests without implicit permission or device opt-in',async()=>{
 reset();
 assert.deepEqual(await reminders.listCustomTimedReminders(timedInput.petId),[]);
 assert.deepEqual(state.writes,[]);assert.equal(state.requests,0);
 assert.equal(await reminders.createCustomTimedReminder(timedInput),null);
 state.delivery=true;state.granted=false;
 assert.equal(await reminders.createCustomTimedReminder(timedInput),null);
 assert.equal(state.scheduled.length,0);assert.deepEqual(state.writes,[]);assert.equal(state.requests,0);
 state.granted=true;
 const created=await reminders.createCustomTimedReminder({...timedInput,label:'  Give flea treatment  '});
 assert.match(created!.id,/^rem_[a-f0-9]{32}$/);
 assert.deepEqual(created,{id:created!.id,...timedInput});
 const scheduled=state.scheduled[0];
 assert.equal(scheduled.content?.title,timedInput.label);assert.equal(scheduled.trigger?.type,'date');assert.equal(scheduled.trigger?.date,timedInput.at);
 assert.deepEqual(scheduled.content?.data,{app:'com.patrickchin.puptime',version:1,kind:'customTimedReminder',...timedInput});
 // A fresh caller obtains the same request entirely from the OS boundary.
 assert.deepEqual(await reminders.listCustomTimedReminders(timedInput.petId),[created]);
 assert.equal(state.requests,0);
});

test('custom one-off validates dates, bounded labels and puppy scope before native scheduling',async()=>{
 reset();state.delivery=true;
 for(const patch of [{at:Date.now()-1},{at:NaN},{at:Infinity},{at:8640000000000001},{at:1.5},{label:''},{label:'   '},{label:'x'.repeat(81)},{label:'private\nbody'},{petId:''},{petId:'bad\0pet'},{extra:true}]){
  await assert.rejects(reminders.createCustomTimedReminder({...timedInput,...patch}));
 }
 assert.equal(state.scheduled.length,0);assert.deepEqual(state.writes,[]);assert.equal(state.requests,0);
 await assert.rejects(reminders.listCustomTimedReminders(''));
});

test('custom one-off list and cancel isolate puppy, application, marker version and unrelated requests',async()=>{
 reset();state.delivery=true;
 const later=await reminders.createCustomTimedReminder({...timedInput,at:timedInput.at+60000});
 const first=await reminders.createCustomTimedReminder(timedInput);
 const other=await reminders.createCustomTimedReminder({...timedInput,petId:'other-puppy'});
 const data=state.scheduled[0].content?.data;assert.ok(data);
 state.scheduled.push(
  {identifier:'puptime-routine-keep'}, {identifier:'puptime-activity-afterPee'}, {identifier:'puptime-widget-keep'},
  {identifier:'foreign',content:{data:{...data,app:'another.app'}}},
  {identifier:'future-version',content:{data:{...data,version:2}}},
  {identifier:'unexpected-field',content:{data:{...data,secret:'ignore'}}},
  {identifier:'wrong-kind',content:{data:{...data,kind:'widgetLog'}}},
  {identifier:'expired',content:{data:{...data,at:Date.now()-1}},trigger:{type:'timeInterval',repeats:false,seconds:1}},
  {identifier:'repeating',content:{data},trigger:{type:'timeInterval',repeats:true,seconds:3600}},
 );
 assert.deepEqual(await reminders.listCustomTimedReminders(timedInput.petId),[first,later]);
 assert.equal(await reminders.countCustomTimedReminders(),4);
 const before=structuredClone(state.scheduled);
 await assert.rejects(reminders.cancelCustomTimedReminder(timedInput.petId,other!.id));
 await assert.rejects(reminders.cancelCustomTimedReminder(timedInput.petId,'puptime-routine-keep'));
 await assert.rejects(reminders.cancelCustomTimedReminder(timedInput.petId,'repeating'));
 assert.deepEqual(state.scheduled,before);
 assert.equal(await reminders.cancelCustomTimedReminder(timedInput.petId,first!.id),true);
 assert.equal(await reminders.cancelCustomTimedReminder(timedInput.petId,first!.id),false);
 assert.deepEqual(state.cancelled,[first!.id]);
 assert.deepEqual(await reminders.listCustomTimedReminders(timedInput.petId),[later]);
});

test('custom one-off preserves native state on list, creation and cancellation failures and enforces capacity',async()=>{
 reset();state.delivery=true;
 const created=await reminders.createCustomTimedReminder(timedInput),before=structuredClone(state.scheduled);
 state.failure='list';await assert.rejects(reminders.listCustomTimedReminders(timedInput.petId));
 state.failure='create';await assert.rejects(reminders.createCustomTimedReminder(timedInput));assert.deepEqual(state.scheduled,before);
 state.failure='cancel';await assert.rejects(reminders.cancelCustomTimedReminder(timedInput.petId,created!.id));assert.deepEqual(state.scheduled,before);
 state.failure=null;
 state.scheduled=Array.from({length:60},(_,index)=>({identifier:'unrelated-'+index}));
 await assert.rejects(reminders.createCustomTimedReminder(timedInput),reminders.CustomTimedReminderLimitError);
 assert.equal(state.scheduled.length,60);assert.deepEqual(state.cancelled,[]);
});

test('device-off queued behind in-flight custom creation cancels only validated Puptime one-offs across puppies',async()=>{
 reset();state.delivery=true;
 await reminders.createCustomTimedReminder({...timedInput,petId:'other-puppy'});
 const data=state.scheduled[0].content?.data;assert.ok(data);
 state.scheduled.push({identifier:'routine-keep'},{identifier:'potty-keep'},{identifier:'widget-keep'},
  {identifier:'foreign',content:{data:{...data,app:'another.app'}}},
  {identifier:'future-version',content:{data:{...data,version:2}}},
  {identifier:'repeating',content:{data},trigger:{type:'timeInterval',repeats:true,seconds:3600}});
 await reminders.cancelCustomTimedRemindersIfDeliveryOff();assert.deepEqual(state.cancelled,[]);
 let release!:()=>void,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 state.scheduleHold=()=>{entered();return gate;};
 const creating=reminders.createCustomTimedReminder(timedInput);await ready;
 state.delivery=false;
 const disabling=reminders.cancelCustomTimedRemindersIfDeliveryOff();
 await new Promise(resolve=>setImmediate(resolve));release();await Promise.all([creating,disabling]);
 assert.deepEqual(state.scheduled.map(item=>item.identifier),['routine-keep','potty-keep','widget-keep','foreign','future-version','repeating']);
 assert.equal(await reminders.createCustomTimedReminder(timedInput),null);
 assert.deepEqual(await reminders.listCustomTimedReminders(timedInput.petId),[]);
 assert.equal(state.requests,0);
});

async function sixtyTimedReminders(){
 for(let index=0;index<60;index++)await reminders.createCustomTimedReminder({...timedInput,petId:index%2?'other-puppy':timedInput.petId,label:`One-off ${index}`});
 assert.equal(state.scheduled.length,60);
}
const fiveRoutines=Array.from({length:5},(_,index)=>({...routine,id:`routine-${index}`,minutes:420+index}));
function freshPottyEvents(now:number){return [{id:'pee',type:'pee' as const,at:now-1,source:'app' as const},{id:'meal',type:'meal' as const,at:now,source:'app' as const}];}

test('routine replacement rejects total iOS overflow before cancelling or scheduling any retained request',async()=>{
 reset();state.delivery=true;await sixtyTimedReminders();
 // Replacing this older routine must not free room by discarding it first.
 state.scheduled.push({identifier:'puptime-routine-old'});
 const before=structuredClone(state.scheduled);
 await assert.rejects(reminders.syncScheduleReminders(fiveRoutines),reminders.CustomTimedReminderLimitError);
 assert.deepEqual(state.scheduled,before);assert.deepEqual(state.cancelled,[]);
 assert.equal((await reminders.listCustomTimedReminders(timedInput.petId)).length,30);
 assert.equal((await reminders.listCustomTimedReminders('other-puppy')).length,30);
});

test('potty replacement counts retained one-offs and routines before changing any native requests',async()=>{
 reset();state.delivery=true;await sixtyTimedReminders();
 state.scheduled.push(...fiveRoutines.slice(0,3).map(entry=>({identifier:'puptime-routine-'+entry.id})),{identifier:'puptime-activity-old'});
 const before=structuredClone(state.scheduled),now=Date.now();assert.equal(before.length,64);
 await assert.rejects(reminders.syncPottyReminders(freshPottyEvents(now),DEFAULT_NOTIFICATION_PREFERENCES,'en',now),reminders.CustomTimedReminderLimitError);
 assert.deepEqual(state.scheduled,before);assert.deepEqual(state.cancelled,[]);
});

test('normal routine and potty replacement can fill exactly64 slots while preserving one-offs and unrelated native markers',async()=>{
 for(const kind of ['routine','potty']){
  reset();state.delivery=true;await sixtyTimedReminders();
  const other=kind==='routine'?'puptime-activity-afterPee':'puptime-routine-keep';
  state.scheduled.push({identifier:other},{identifier:'foreign-version',content:{data:{app:'com.patrickchin.puptime',kind:'customTimedReminder',version:2}}});
  const retained=structuredClone(state.scheduled),old=kind==='routine'?'puptime-routine-old':'puptime-activity-old';
  state.scheduled.push({identifier:old});
  const now=Date.now();
  const result=kind==='routine'
   ?await reminders.syncScheduleReminders(fiveRoutines.slice(0,2))
   :await reminders.syncPottyReminders(freshPottyEvents(now),DEFAULT_NOTIFICATION_PREFERENCES,'en',now);
  assert.equal(result,true);assert.equal(state.scheduled.length,64);
  assert.deepEqual(state.scheduled.slice(0,62),retained);assert.deepEqual(state.cancelled,[old]);
  const replacementIds=kind==='routine'?['puptime-routine-routine-0','puptime-routine-routine-1']:['puptime-activity-afterPee','puptime-activity-afterMeal'];
  assert.deepEqual(state.scheduled.slice(62).map(item=>item.identifier),replacementIds);
 }
});

test('full native queues still cancel owned replacements when device delivery or OS access is off or plans are empty',async()=>{
 for(const unavailable of ['device-off','permission-off','no-plans']){
  reset();state.delivery=true;await sixtyTimedReminders();
  state.scheduled.push({identifier:'puptime-routine-old'},{identifier:'puptime-activity-old'},{identifier:'foreign-keep'},{identifier:'puptime-widget-keep'});
  const retained=structuredClone(state.scheduled.filter(item=>!['puptime-routine-old','puptime-activity-old'].includes(item.identifier)));
  if(unavailable==='device-off')state.delivery=false;
  if(unavailable==='permission-off')state.granted=false;
  const now=Date.now(),expected=unavailable==='no-plans';
  assert.equal(await reminders.syncScheduleReminders(expected?[]:fiveRoutines),expected);
  assert.equal(await reminders.syncPottyReminders(expected?[]:freshPottyEvents(now),DEFAULT_NOTIFICATION_PREFERENCES,'en',now),expected);
  assert.deepEqual(state.scheduled,retained);assert.deepEqual(state.cancelled,['puptime-routine-old','puptime-activity-old']);
 }
});

test('queued routine and potty writes reserve against the latest native total rather than the same earlier snapshot',async()=>{
 reset();state.delivery=true;await sixtyTimedReminders();
 let release!:()=>void,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 state.scheduleHold=()=>{entered();return gate;};
 const routines=reminders.syncScheduleReminders(fiveRoutines.slice(0,3));await ready;
 const now=Date.now(),potty=reminders.syncPottyReminders(freshPottyEvents(now),DEFAULT_NOTIFICATION_PREFERENCES,'en',now);
 const outcomes=Promise.allSettled([routines,potty]);
 await new Promise(resolve=>setImmediate(resolve));release();
 const results=await outcomes;
 assert.deepEqual(results[0],{status:'fulfilled',value:true});assert.equal(results[1].status,'rejected');
 if(results[1].status==='rejected')assert.ok(results[1].reason instanceof reminders.CustomTimedReminderLimitError);
 assert.equal(state.scheduled.length,63);assert.deepEqual(state.cancelled,[]);
 assert.equal(state.scheduled.filter(item=>item.identifier.startsWith('puptime-activity-')).length,0);
 assert.equal((await reminders.countCustomTimedReminders()),60);
});
