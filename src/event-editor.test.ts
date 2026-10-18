import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import { createLocalDatabase,initializeLocalDatabase } from './local/database.ts';
import { sqliteTestConnection } from './local/sqlite-test-adapter.ts';
import { createNativeStorage } from './local/native-storage.ts';
import { applyLocalRecords } from './local/sync-projection.ts';
import type { PuppyEvent } from './domain.ts';
import * as editing from './event-editor.ts';
const original:PuppyEvent={id:'one',type:'pee',at:100,source:'app',note:'original',estimated:true};
async function fixture(t:TestContext,event=original) {
 const database=await createLocalDatabase(sqliteTestConnection(':memory:'));t.after(()=>database.close());
 await initializeLocalDatabase(database,()=> 'pet-1');await database.write(sql=>sql.runAsync('DELETE FROM routines'));
 const storage=createNativeStorage(database,'pet-1');await storage.appendEvents([event]);
 assert.equal(typeof editing.createEventEditor,'function');
 const editor=editing.createEventEditor(event,async changes=>{await storage.updateEvent(event.id,changes);});
 const remote=(data:Omit<PuppyEvent,'id'>)=>database.write(sql=>applyLocalRecords(sql,'pet-1',[{kind:'event',localId:event.id,data}],[]));
 return {database,storage,editor,remote,values:editing.eventEditValues(event)};
}

test('a note edit preserves a time and type pulled after the editor opened',async t=>{
 const {storage,editor,remote,values}=await fixture(t);
 await remote({type:'meal',at:200,source:'app',note:'original',estimated:true});
 await editor.save({...values,note:'local note'});
 assert.deepEqual((await storage.loadEvents())[0],{...original,type:'meal',at:200,note:'local note'});
});
test('later autosaves never resend a previously saved field that changed remotely',async t=>{
 const {storage,editor,remote,values}=await fixture(t);await editor.save({...values,note:'first local'});
 await remote({type:'pee',at:200,source:'app',note:'remote note',estimated:true});
 await editor.save({...values,note:'first local',type:'walk'});
 assert.deepEqual(JSON.parse(JSON.stringify((await storage.loadEvents())[0])),{...original,type:'walk',at:200,note:'remote note'});
});
test('a failed save keeps its intended fields for the next save and never advances the baseline',async t=>{
 const {database,storage,editor,values}=await fixture(t);
 await database.write(sql=>sql.execAsync("CREATE TRIGGER fail_edit BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'save quota'); END;"));
 await assert.rejects(editor.save({...values,note:'keep my edit'}),/quota/);
 await database.write(sql=>sql.execAsync('DROP TRIGGER fail_edit'));
 await editor.save({...values,note:'keep my edit',at:150});
 assert.deepEqual((await storage.loadEvents())[0],{...original,note:'keep my edit',at:150});
});
test('overlapping autosaves are serialized around local commit and keep independent remote fields',async t=>{
 const {database,storage,values}=await fixture(t);let release:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 const editor=editing.createEventEditor(original,async changes=>{calls++;if(calls===1)await waiting;await storage.updateEvent(original.id,changes);if(calls===1)await database.write(sql=>applyLocalRecords(sql,'pet-1',[{kind:'event',localId:original.id,data:{type:'pee',at:200,source:'app',note:'first',estimated:true}}],[]));});
 const first=editor.save({...values,note:'first'}),second=editor.save({...values,note:'second'});release();await Promise.all([first,second]);
 assert.deepEqual((await storage.loadEvents())[0],{...original,at:200,note:'second'});
});
test('editing time preserves an untouched imported note at the cloud limit and explicit removal clears it',async t=>{
 const long={...original,note:'x'.repeat(16384)};const {storage,editor,values}=await fixture(t,long);
 await editor.save({...values,at:150});assert.equal((await storage.loadEvents())[0].note!.length,16384);
 await editor.save({...values,at:150,note:''});assert.equal((await storage.loadEvents())[0].note,undefined);
});
test('an untouched future timestamp is not clamped by a note-only autosave',async t=>{
 const event={...original,at:Date.now()+86400000};const {storage,editor,values}=await fixture(t,event);
 await editor.save({...values,note:'only note'});assert.equal((await storage.loadEvents())[0].at,event.at);
});

test('a deleted event rejects an open draft instead of acknowledging a save or recreating it',async t=>{
 const {database,storage,editor,values}=await fixture(t);
 await database.write(sql=>applyLocalRecords(sql,'pet-1',[],[{kind:'event',localId:original.id}]));
 await assert.rejects(editor.save({...values,note:'unsaved draft'}),{name:'EventDeletedError'});
 assert.deepEqual(await storage.loadEvents(),[]);
});
