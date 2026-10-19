import assert from 'node:assert/strict';
import test from 'node:test';
import type {AccountSnapshot} from './account-controller.ts';
import * as subscription from './change-subscription.ts';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){
 let state:AccountSnapshot={active:true,online:true,busy:false,problem:null,account:{user:{id:'one',email:'one@example.invalid',name:'One'},cloud:{canSync:true,canExport:true,source:'trial',expiresAt:null},pets:[]},sync:{accountId:'one',generation:'first',state:'active',pending:0,blocked:0,cursor:0},config:null,linkedProviders:null,linkingProvider:null,local:null,run:null,codeSentTo:null,running:false,lastSyncedAt:null};
 const listeners=new Set<()=>void>();let invalidations=0;
 const timers:Array<{fn:()=>void;delay:number;cancelled:boolean}>=[],calls:Array<{signal:AbortSignal;onCursor:(cursor:number)=>void;onClose:()=>void;closed:number;resolve?:(value:{close:()=>void})=>void}>=[];
 const controller={read:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},invalidate:()=>{invalidations++;}};
 const open:subscription.OpenChanges=async options=>{const call={...options,closed:0};calls.push(call);return {close:()=>{call.closed++;}};};
 const defer=(fn:()=>void,delay:number)=>{const timer={fn,delay,cancelled:false};timers.push(timer);return()=>{timer.cancelled=true;};};
 const update=(patch:Partial<AccountSnapshot>)=>{state={...state,...patch};listeners.forEach(fn=>fn());};
 return {controller,open,defer,update,calls,timers,get invalidations(){return invalidations;}};
}
test('only active online entitled matching owners subscribe; old generation callbacks are ignored',async()=>{
 const f=fixture(),stop=subscription.watchAccountChanges({controller:f.controller,open:f.open,defer:f.defer});await tick();assert.equal(f.calls.length,1);
 f.calls[0].onCursor(1);f.calls[0].onCursor(1);f.calls[0].onCursor(0);assert.equal(f.invalidations,1);
 f.update({active:false});assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.calls[0].closed,1);f.calls[0].onCursor(2);assert.equal(f.invalidations,1);
 f.update({active:true});await tick();assert.equal(f.calls.length,2);
 f.update({sync:{...f.controller.read().sync!,accountId:'other'}});assert.equal(f.calls[1].signal.aborted,true);
 f.update({sync:{...f.controller.read().sync!,accountId:'one',generation:'second'}});await tick();assert.equal(f.calls.length,3);
 f.update({busy:true});assert.equal(f.calls[2].signal.aborted,true);f.update({busy:false,online:false});await tick();assert.equal(f.calls.length,3);stop();
});
test('a delayed credential read cannot install a socket after account change or disposal',async()=>{
 const f=fixture();let release:(value:{close:()=>void})=>void=()=>{};let closed=0;
 const stop=subscription.watchAccountChanges({controller:f.controller,open:()=>new Promise(resolve=>{release=resolve;}),defer:f.defer});
 f.update({account:null});release({close:()=>{closed++;}});await tick();assert.equal(closed,1);stop();assert.equal(f.timers.length,0);
});
test('closed sockets back off up to60s and lifecycle changes cancel the retry',async()=>{
 const f=fixture(),stop=subscription.watchAccountChanges({controller:f.controller,open:f.open,defer:f.defer});await tick();
 for(let i=0;i<10;i++){f.calls.at(-1)!.onClose();const timer=f.timers.at(-1)!;assert.equal(timer.delay,Math.min(1000*2**i,60000));timer.fn();await tick();}
 f.calls.at(-1)!.onClose();f.update({online:false});assert.equal(f.timers.at(-1)!.cancelled,true);stop();
});
test('native opener uses only fixed same-origin headers and rejects malformed messages',async()=>{
 const sockets:subscription.ChangeSocket[]=[];
 let target='',headers:Record<string,string>={};const cursors:number[]=[];let closed=0;
 const open=subscription.createChangeOpener({origin:'https://puptime.test',getCookie:async()=> 'official-sdk-cookie',createSocket:(url,options)=>{target=url;headers=options.headers;const socket={onmessage:null,onerror:null,onclose:null,close:()=>{closed++;}};sockets.push(socket);return socket;}});
 const abort=new AbortController();const socket=await open({signal:abort.signal,onCursor:value=>cursors.push(value),onClose:()=>{closed++;}});
 assert.equal(target,'wss://puptime.test/api/sync/changes');assert.deepEqual(headers,{Cookie:'official-sdk-cookie',Origin:'https://puptime.test'});assert.ok(socket);
 const active=sockets[0];active.onmessage!.call(active as WebSocket,new MessageEvent('message',{data:'{"protocolVersion":1,"cursor":2}'}));assert.deepEqual(cursors,[2]);
 active.onmessage!.call(active as WebSocket,new MessageEvent('message',{data:'{"protocolVersion":1,"cursor":3,"note":"private"}'}));assert.deepEqual(cursors,[2]);assert.ok(closed>0);
});
test('pending official cookie lookup is fenced by cancellation before socket construction',async()=>{
 let release:(cookie:string)=>void=()=>{};let constructions=0;
 const open=subscription.createChangeOpener({origin:'https://puptime.test',getCookie:()=>new Promise(resolve=>{release=resolve;}),createSocket:()=>{constructions++;throw new Error('must not construct');}});
 const abort=new AbortController();const pending=open({signal:abort.signal,onCursor:()=>{},onClose:()=>{}});abort.abort();release('old-owner-cookie');assert.equal(await pending,null);assert.equal(constructions,0);
});
