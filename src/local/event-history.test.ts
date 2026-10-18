import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test,{type TestContext} from 'node:test';
import {createLocalDatabase,initializeLocalDatabase,type LocalDatabase,type SqlValue} from './database.ts';
import {sqliteTestConnection} from './sqlite-test-adapter.ts';
import {createLocalRuntime} from './runtime-factory.ts';
import {createLocalRepository} from './repository.ts';

const original={id:'one',type:'pee' as const,at:100,source:'app' as const,note:'First'};
async function setup(t:TestContext){
 const raw=sqliteTestConnection(':memory:'),reads:Array<{sql:string;values:SqlValue[];rows:number}>=[];
 let decoded=0;
 const database=await createLocalDatabase({...raw,
  async getAllAsync<T>(sql:string,...values:SqlValue[]){
   const rows=await raw.getAllAsync<T>(sql,...values);reads.push({sql,values,rows:rows.length});
   return rows.map(row=>row&&typeof row==='object'&&'after_data' in row?new Proxy(row,{get(target,key,receiver){if(key==='after_data')decoded++;return Reflect.get(target,key,receiver);}}):row);
  },
  async getFirstAsync<T>(sql:string,...values:SqlValue[]){const row=await raw.getFirstAsync<T>(sql,...values);reads.push({sql,values,rows:row===null?0:1});return row;},
 });
 t.after(()=>database.close());await initializeLocalDatabase(database,()=> 'pet-1');
 const local=await createLocalRuntime(database,'pet-1');
 assert.equal(typeof local.history?.eventPage,'function','The runtime needs real, pet-scoped history queries.');
 return {database,local,reads,reset(){reads.length=0;decoded=0;},decoded:()=>decoded};
}
async function snapshot(database:LocalDatabase){
 return database.read(async sql=>{
  const tables=await sql.getAllAsync<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  return Object.fromEntries(await Promise.all(tables.map(async({name})=>[name,await sql.getAllAsync(`SELECT * FROM "${name}" ORDER BY rowid`)])));
 });
}

test('log versions retain exact before/after/deletion values and isolate other logs, kinds and puppies',async t=>{
 const {database,local}=await setup(t);
 await local.storage.appendEvents([original]);await local.storage.updateEvent('one',{note:'Second'});await local.storage.removeEvent('one');
 await local.storage.savePuppyName('Biscuit');
 await local.storage.appendEvents([{id:'💩:other',type:'poop',at:100,source:'app'}]);
 await database.write(sql=>sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet-2','Other')"));
 const other=await createLocalRuntime(database,'pet-2');await other.storage.appendEvents([{...original,note:'Other puppy'}]);
 const page=await local.history.eventPage('one',{limit:2});
 assert.deepEqual(page.entries.map(entry=>({sequence:entry.sequence,source:entry.source,before:entry.before,after:entry.after})),[
  {sequence:3,source:'local',before:{...original,note:'Second'},after:null},
  {sequence:2,source:'local',before:original,after:{...original,note:'Second'}},
 ]);
 assert.deepEqual(page.head,{sequence:3,owner:null,event:null,cloudRecord:null});assert.equal(page.next,2);
 const older=await local.history.eventPage('one',{before:page.next!,limit:2});
 assert.deepEqual(older.entries.map(entry=>({sequence:entry.sequence,before:entry.before,after:entry.after})),[{sequence:1,before:null,after:original}]);assert.equal(older.next,null);
 assert.deepEqual((await local.history.eventPage('💩:other')).entries.map(entry=>entry.eventId),['💩:other']);
 assert.deepEqual((await other.history.eventPage('one')).entries.map(entry=>entry.after?.note),['Other puppy']);
 assert.deepEqual((await local.history.recentPage()).entries.map(entry=>entry.sequence),[5,3,2,1]);
 assert.deepEqual((await local.history.recentPage({limit:2})).next,3);
});

test('history pages use exclusive sequence cursors despite tied times, new edits and a removed cursor',async t=>{
 const {database,local}=await setup(t);await local.storage.appendEvents([original]);
 for(const note of ['Two','Three','Four','Five'])await local.storage.updateEvent('one',{note});
 await database.write(sql=>sql.runAsync('UPDATE local_revisions SET created_at=123'));
 const first=await local.history.eventPage('one',{limit:2});assert.deepEqual(first.entries.map(entry=>entry.sequence),[5,4]);assert.equal(first.next,4);
 await local.storage.updateEvent('one',{note:'Six'});
 await database.write(sql=>sql.runAsync('DELETE FROM local_revisions WHERE sequence=4'));
 const next=await local.history.eventPage('one',{before:first.next!,limit:2});
 assert.deepEqual(next.entries.map(entry=>entry.sequence),[3,2]);assert.equal(next.next,2);assert.equal(next.head.sequence,6);
 const last=await local.history.eventPage('one',{before:next.next!,limit:2});assert.deepEqual(last.entries.map(entry=>entry.sequence),[1]);assert.equal(last.next,null);
 assert.deepEqual((await local.history.recentPage({before:4,limit:2})).entries.map(entry=>entry.sequence),[3,2]);
});

test('history distinguishes missing records, current records without earlier revisions and the exact owned cloud record',async t=>{
 const {database,local}=await setup(t);
 assert.deepEqual(await local.history.eventPage('missing'),{entries:[],next:null,head:{sequence:null,owner:null,event:null,cloudRecord:null}});
 await createLocalRepository(database,'pet-1').appendEvents([original]);
 assert.deepEqual(await local.history.eventPage('one'),{entries:[],next:null,head:{sequence:null,owner:null,event:original,cloudRecord:null}});
 await database.write(sql=>sql.runAsync('DELETE FROM events'));
 const owner={...await local.sync.prepareAssociation({accountId:'account-1',localPetId:'pet-1',deviceId:local.deviceId,enrollment:{operationId:'enroll',deviceId:local.deviceId,localPetId:'pet-1',name:'My puppy',confirmedPetId:'cloud-1'}}),accountId:'account-1'};
 const remote={id:'["event","cloud-1","one"]',petId:'cloud-1',kind:'event' as const,revision:1,sequence:2,deleted:false,updatedAt:1000,data:{type:'pee' as const,at:100,source:'app' as const,note:'Remote'}};
 await local.sync.stageBaseline({...owner,page:{changes:[{id:'cloud-1',petId:'cloud-1',kind:'puppy',revision:1,sequence:1,deleted:false,updatedAt:1000,data:{name:'Basil'}},remote],cursor:2,hasMore:false}});
 await local.sync.completeAssociation({...owner,cloudPetId:'cloud-1'});
 const head=(await local.history.eventPage('one')).head;
 assert.deepEqual(head.owner,owner);assert.deepEqual(head.cloudRecord,remote);assert.deepEqual(head.event,{...original,note:'Remote'});assert.ok(head.sequence!==null);
 await database.write(sql=>sql.runAsync('UPDATE local_sync_records SET body=? WHERE record_id=?',JSON.stringify({...remote,petId:'wrong-pet'}),remote.id));
 const before=await snapshot(database);await assert.rejects(local.history.eventPage('one'));assert.deepEqual(await snapshot(database),before);
});

test('invalid history arguments reject before SQL rather than falling back to unbounded reads',async t=>{
 const {local,reads,reset}=await setup(t);reset();
 for(const limit of [0,-1,1.5,51,NaN,Infinity]){await assert.rejects(local.history.eventPage('one',{limit}));await assert.rejects(local.history.recentPage({limit}));}
 for(const before of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){await assert.rejects(local.history.eventPage('one',{before}));await assert.rejects(local.history.recentPage({before}));}
 for(const id of ['', 'bad\nidentifier'])await assert.rejects(local.history.eventPage(id));
 await assert.rejects(local.history.eventPage('one',{unknown:true} as never));assert.equal(reads.length,0);
});

test('unreadable saved revision payloads or metadata fail without erasing history and recover after repair',async t=>{
 const {database,local}=await setup(t);await local.storage.appendEvents([original]);
 const row=await database.read(sql=>sql.getFirstAsync<{after_data:string}>('SELECT after_data FROM local_revisions WHERE sequence=1'));
 await database.write(sql=>sql.runAsync('UPDATE local_revisions SET after_data=? WHERE sequence=1','{"type":"pee","at":"broken","source":"app"}'));
 const malformed=await snapshot(database);await assert.rejects(local.history.eventPage('one'));await assert.rejects(local.history.recentPage());assert.deepEqual(await snapshot(database),malformed);
 await database.write(sql=>sql.runAsync('UPDATE local_revisions SET after_data=?,created_at=1.5 WHERE sequence=1',row!.after_data));
 const badTime=await snapshot(database);await assert.rejects(local.history.eventPage('one'));assert.deepEqual(await snapshot(database),badTime);
 await database.write(sql=>sql.runAsync('UPDATE local_revisions SET created_at=200 WHERE sequence=1'));
 assert.deepEqual((await local.history.eventPage('one')).entries.map(entry=>entry.after),[original]);
});

test('reopening a populated current database restores only the additive recent-change index',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'puptime-history-sql-')),path=join(directory,'local.db');
 let database=await createLocalDatabase(sqliteTestConnection(path));
 t.after(async()=>{await database.close();await rm(directory,{recursive:true,force:true});});
 await initializeLocalDatabase(database,()=> 'pet-1');const local=await createLocalRuntime(database,'pet-1');
 await local.storage.appendEvents([original]);await local.storage.updateEvent('one',{note:'Retained'});
 await database.write(sql=>sql.execAsync('DROP INDEX IF EXISTS local_revision_changes'));
 const before=await snapshot(database);await database.close();database=await createLocalDatabase(sqliteTestConnection(path));
 await initializeLocalDatabase(database,()=>assert.fail('Reopen must not create another puppy.'));
 const indexes=await database.read(sql=>sql.getAllAsync<{name:string}>("SELECT name FROM sqlite_master WHERE type='index'"));
 assert.ok(indexes.some(index=>index.name==='local_revision_changes'),'Current databases also need indexed recent-change reads.');
 assert.deepEqual(await snapshot(database),before);
 const reopened=await createLocalRuntime(database,'pet-1');assert.equal(typeof reopened.history?.eventPage,'function');
 assert.deepEqual((await reopened.history.eventPage('one')).entries.map(entry=>entry.after?.note),['Retained','First']);
});

test('one record and recent-change pages stay indexed and bounded over100000 retained revisions',async t=>{
 const {database,local,reads,reset,decoded}=await setup(t);
 await database.write(async sql=>{
  await sql.runAsync("INSERT INTO puppies(id,name) VALUES ('pet-2','Other')");
  await sql.execAsync(`WITH RECURSIVE n(value) AS (VALUES(1) UNION ALL SELECT value+1 FROM n WHERE value<100000)
   INSERT INTO local_revisions(pet_id,kind,local_id,before_data,after_data,created_at,source)
   SELECT CASE WHEN value%10=0 THEN 'pet-2' ELSE 'pet-1' END,'event',CASE WHEN value%3=0 THEN 'target' ELSE 'other' END,
   NULL,json_object('type','pee','at',value,'source','app'),123,'local' FROM n;`);
 });
 reset();const page=await local.history.eventPage('target');
 assert.equal(page.entries.length,50);assert.equal(page.entries[0].sequence,99999);assert.equal(page.head.sequence,99999);
 assert.ok(decoded()<=51,'Only the requested revision payloads may be decoded.');assert.ok(reads.reduce((sum,read)=>sum+read.rows,0)<=60,'Head and lookahead reads stay bounded.');
 const recordRead=reads.find(read=>read.rows===51)!;
 const recordPlan=await database.read(sql=>sql.getAllAsync<{detail:string}>('EXPLAIN QUERY PLAN '+recordRead.sql,...recordRead.values));
 assert.ok(recordPlan.some(row=>row.detail.includes('local_revision_history')));assert.ok(recordPlan.every(row=>!row.detail.includes('TEMP B-TREE')));
 reset();const recent=await local.history.recentPage();assert.equal(recent.entries.length,50);assert.equal(recent.entries[0].sequence,99999);assert.ok(decoded()<=51);assert.ok(reads.reduce((sum,read)=>sum+read.rows,0)<=51);
 const recentRead=reads.find(read=>read.rows===51)!;
 const recentPlan=await database.read(sql=>sql.getAllAsync<{detail:string}>('EXPLAIN QUERY PLAN '+recentRead.sql,...recentRead.values));
 assert.ok(recentPlan.some(row=>row.detail.includes('local_revision_changes')));assert.ok(recentPlan.every(row=>!row.detail.includes('TEMP B-TREE')));
 t.diagnostic('100000 revisions: indexed50-entry pages plus lookahead; no full-history payload decoding.');
});
