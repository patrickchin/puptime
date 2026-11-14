import assert from 'node:assert/strict';
import test from 'node:test';
import {gzipSync,deflateSync,brotliCompressSync} from 'node:zlib';
import {STARTER_SCHEDULE,DEFAULT_WIDGET_ACTIONS} from '../src/domain.ts';
import {DEFAULT_NOTIFICATION_PREFERENCES} from '../src/notification-config.ts';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeTables,nativeSnapshot,assertNativeTransition,assertNativeDetached,assertNativeAcknowledged,assertNativeDrained,assertEmptyIosRestoreSources,assertFreshSetupRevisions,capturedJson,nativeAuthUiFlags} from './native-account-evidence.mjs';

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

// Mirrors the production skip-onboarding write contract; never an exemption for event history.
test('fresh setup exception is exact and never accepts activity or arbitrary preference history',()=>{
 const tables=empty(),n=DEFAULT_NOTIFICATION_PREFERENCES;tables.puppies=[{id:'pet_fresh'}];
 const p={theme:'system',language:'system',widgetActions:[...DEFAULT_WIDGET_ACTIONS],reminderLeadMinutes:n.reminderLeadMinutes,widgetConfirmations:n.widgetConfirmations,pottyAfterPeeEnabled:true,pottyAfterPeeDelayMinutes:120,pottyAfterMealEnabled:true,pottyAfterMealDelayMinutes:30};
 const changes=[...STARTER_SCHEDULE.map(({id,...data})=>({kind:'routine',local_id:id,before_data:data,after_data:null})),{kind:'accountPreferences',local_id:'preferences',before_data:p,after_data:{...p,pottyAfterPeeEnabled:false,pottyAfterMealEnabled:false}}];
 tables.local_revisions=changes.map((row,i)=>({sequence:i+1,pet_id:'pet_fresh',...row,before_data:JSON.stringify(row.before_data),after_data:row.after_data===null?null:JSON.stringify(row.after_data),created_at:100+i,source:'local'}));
 const window={startedAt:100,finishedAt:120};assertFreshSetupRevisions(tables,window);
 for(const patch of [{kind:'event'},{local_id:'not-starter'},{before_data:'{}'},{after_data:'{}'},{sequence:99},{source:'sync'},{created_at:50},{pet_id:'pet_other'},{unknown:'value'}]){const bad=structuredClone(tables);Object.assign(bad.local_revisions[0],patch);assert.throws(()=>assertFreshSetupRevisions(bad,window));}
 const bad=structuredClone(tables);bad.local_revisions[12].after_data=JSON.stringify({...p,theme:'dark'});assert.throws(()=>assertFreshSetupRevisions(bad,window));
});

test('wire observer decodes real negotiated JSON compression without accepting broken bytes',()=>{
 const value={accepted:[],rejected:[]},body=Buffer.from(JSON.stringify(value));
 for(const [encoding,bytes] of [[undefined,body],['identity',body],['gzip',gzipSync(body)],['deflate',deflateSync(body)],['br',brotliCompressSync(body)],['gzip, br',brotliCompressSync(gzipSync(body))]])assert.deepEqual(capturedJson(bytes,encoding),value);
 assert.throws(()=>capturedJson(gzipSync(body),undefined));assert.throws(()=>capturedJson(Buffer.from('broken'),'gzip'));assert.throws(()=>capturedJson(body,'unknown'));
});

test('auth failure diagnostics retain readiness categories only, never secrets or labels',()=>{
 const email='synthetic-private@example.invalid',code='829471';
 const hierarchy={children:[{attributes:{'resource-id':'account.email.input',value:email,text:email,enabled:'true',focused:'false'}},{attributes:{'resource-id':'account.code.input',value:code,enabled:'false',focused:'true'}},{attributes:{'resource-id':'account.error',accessibilityText:'private service detail '+code}},{attributes:{'resource-id':'unknown-'+email,value:code}}]};
 const result=nativeAuthUiFlags(hierarchy,{email,code});
 assert.deepEqual(result['account.email.input'],{present:true,enabled:true,focused:false,valueCategory:'nonempty',exactExpectedMatch:true});
 assert.deepEqual(result['account.code.input'],{present:true,enabled:false,focused:true,valueCategory:'six-digits',exactExpectedMatch:true});
 assert.deepEqual(result['account.sendCode'],{present:false});
 for(const secret of [email,code,'private service detail','unknown-'])assert.ok(!JSON.stringify(result).includes(secret));
 for(const [value,category] of [['','empty'],['12','partial-digits'],['wrong','other'],[undefined,'unavailable']]){
  const flags=nativeAuthUiFlags({attributes:{'resource-id':'account.code.input',value}},{code})['account.code.input'];
  assert.equal(flags.valueCategory,category);assert.equal(flags.exactExpectedMatch,false);
 }
});
