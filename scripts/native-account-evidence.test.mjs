import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeTables,nativeSnapshot,assertNativeTransition,assertNativeDetached,assertNativeAcknowledged,assertNativeDrained,assertEmptyIosRestoreSources} from './native-account-evidence.mjs';

const empty=()=>Object.fromEntries(nativeTables.map(table=>[table,[]]));
test('snapshots include every real table and exact payload; new tables fail closed',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    for(const table of nativeTables.filter(table=>table!=='sqlite_sequence'))db.exec(`CREATE TABLE ${table}(sequence INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT)`);
    db.prepare('INSERT INTO local_sync_outbox(body) VALUES (?)').run('original mutation');
    const before=nativeSnapshot(db);
    assert.deepEqual(before.local_sync_outbox,[{sequence:1,body:'original mutation'}]);
    assertNativeTransition(before,nativeSnapshot(db));
    db.prepare('UPDATE local_sync_outbox SET body=?').run('different mutation, same pending count');
    assert.throws(()=>assertNativeTransition(before,nativeSnapshot(db)),/Only explicitly expected/);
    db.exec('CREATE TABLE unseen_native_data(id TEXT)');
    assert.throws(()=>nativeSnapshot(db),/Inspect every native table/);
  }finally{db.close();}
});

test('logout clears the exact association rows and intent while preserving history/settings/counters',()=>{
  const before=empty();
  before.events=[{id:'evt_kept',note:'preserve me'}];before.local_revisions=[{sequence:8,after_data:'original'}];
  before.settings=[{key:'theme',value:'dark'}];before.sqlite_sequence=[{name:'local_sync_outbox',seq:12}];
  before.metadata=[{key:'active_pet_id',value:'pet_kept'},{key:'pending_restore_operation',value:'op_restore'}];
  for(const table of ['local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'])before[table]=[{body:table}];
  const after={...before,...empty(),events:before.events,local_revisions:before.local_revisions,settings:before.settings,
    sqlite_sequence:before.sqlite_sequence,metadata:[before.metadata[0]]};
  assertNativeDetached(before,after);
  for(const table of ['events','local_revisions','settings','sqlite_sequence']){
    const broken=structuredClone(after);broken[table]=[];
    assert.throws(()=>assertNativeDetached(before,broken),/Only explicitly expected/);
  }
  assert.throws(()=>assertNativeDetached(before,{...after,local_sync_owner:before.local_sync_owner}),/Only explicitly expected/);
});

test('acknowledgement must preserve newer pending payloads and match exact operation/result rows',()=>{
  const mutation={operationId:'op_sent',recordId:'evt_cloud',kind:'event',petId:'pet_cloud'};
  const row={sequence:9,operation_id:'op_sent',generation:'gen_current',mutation_json:JSON.stringify(mutation)};
  const newer={...row,sequence:10,operation_id:'op_newer',mutation_json:'newer payload'};
  const result={operationId:'op_sent',record:{id:'evt_cloud',kind:'event',petId:'pet_cloud',data:{note:'original'}}};
  const before={...empty(),local_sync_outbox:[row,newer]};
  const ack={generation:'gen_current',operation_id:'op_sent',local_sequence:9,mutation_json:row.mutation_json,result_json:JSON.stringify(result),outcome:'accepted'};
  const after={...before,local_sync_outbox:[newer],local_sync_acks:[ack]};
  assertNativeAcknowledged(before,after,[result]);
  assert.throws(()=>assertNativeAcknowledged(before,{...after,local_sync_outbox:[]},[result]),/newer or unrelated/);
  assert.throws(()=>assertNativeAcknowledged(before,{...after,local_sync_acks:[{...ack,mutation_json:'replaced'}]},[result]),/exact accepted result/);
  assert.throws(()=>assertNativeAcknowledged(before,after,[{...result,operationId:'op_unknown'}]),/captured pending/);
  assert.throws(()=>assertNativeAcknowledged(before,after,[]),/real accepted operation/);
});

test('empty restore reads actual shared journal/cache and backups; missing or stale evidence fails',()=>{
  const root=mkdtempSync(join(tmpdir(),'puptime-empty-restore-proof-'));
  try{
    const shared=join(root,'group'),documents=join(root,'Documents');mkdirSync(shared);mkdirSync(documents);
    const input={tables:empty(),sharedDirectory:shared,documentsDirectory:documents,defaults:{}};
    assertEmptyIosRestoreSources(input);
    assert.throws(()=>assertEmptyIosRestoreSources({...input,defaults:undefined}),/real shared defaults/);
    assert.throws(()=>assertEmptyIosRestoreSources({...input,sharedDirectory:join(root,'uninspected')}),/actual native/);
    for(const props of [{pending:[{id:'evt_stale'}]},{openNap:{id:'evt_nap'}},{lastEventAt:{pee:123}}])
      assert.throws(()=>assertEmptyIosRestoreSources({...input,defaults:{__expo_widgets_PuptimeWidget_timeline:[{props}]}}),/cached/);
    const pending=join(shared,'ExpoWidgets/PuptimePending');mkdirSync(pending,{recursive:true});writeFileSync(join(pending,'wop_old.json'),'unreadable');
    assert.throws(()=>assertEmptyIosRestoreSources(input),/immutable widget/);rmSync(pending,{recursive:true});
    const backups=join(documents,'activity-backups');mkdirSync(backups);const file=join(backups,'bkp_artificial.json');
    writeFileSync(file,JSON.stringify({events:[{id:'evt_stale'}]}));assert.throws(()=>assertEmptyIosRestoreSources(input),/local backup/);
    writeFileSync(file,'invalid');assert.throws(()=>assertEmptyIosRestoreSources(input));
    writeFileSync(file,JSON.stringify({events:[]}));assertEmptyIosRestoreSources(input);
    assert.throws(()=>assertEmptyIosRestoreSources({...input,tables:{...input.tables,local_revisions:[{sequence:1}]}}),/local_revisions/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('a drain permits exact wire receipts, mirrors and cursor while preserving all other tables',()=>{
  const mutation={operationId:'op_sent',recordId:'evt_cloud',kind:'event',petId:'pet_cloud'};
  const pending={sequence:9,operation_id:'op_sent',generation:'gen_current',mutation_json:JSON.stringify(mutation)};
  const record={id:'evt_cloud',kind:'event',petId:'pet_cloud',sequence:7,revision:1,data:{note:'original'}};
  const accepted={operationId:'op_sent',record},page={changes:[record],cursor:7,hasMore:false};
  const before={...empty(),events:[{id:'evt_local',note:'original'}],settings:[{key:'theme',value:'dark'}],local_sync_owner:[{generation:'gen_current',cursor:6}],local_sync_outbox:[pending]};
  const after={...before,local_sync_owner:[{generation:'gen_current',cursor:7}],local_sync_outbox:[],local_sync_records:[{generation:'gen_current',record_id:record.id,body:JSON.stringify(record)}],local_sync_acks:[{generation:'gen_current',operation_id:'op_sent',local_sequence:9,mutation_json:pending.mutation_json,result_json:JSON.stringify(accepted),outcome:'accepted'}]};
  assertNativeDrained(before,after,[accepted],[page]);
  for(const field of ['events','settings','local_sync_records','local_sync_owner']){
    const corrupt={...after,[field]:[]};assert.throws(()=>assertNativeDrained(before,corrupt,[accepted],[page]),/Only explicitly expected/);
  }
  assert.throws(()=>assertNativeDrained(before,after,[accepted],[{...page,cursor:99}]),/Only explicitly expected/);
  assert.throws(()=>assertNativeDrained(before,after,[accepted],[]),/completed native pull/);
});
