// Old-source serialization/current-reader SQLite control only; no native or numeric-upgrade qualification.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const command=(binary,args)=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
const inside=(root,path)=>{const name=relative(root,path);return name===''||name!=='..'&&!name.startsWith('..'+sep)&&!isAbsolute(name);};
const regularFiles=root=>readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>relative(root,join(entry.parentPath??entry.path,entry.name))).sort();

function assertArchivedSource(root,expected){
 assert.ok(!readdirSync(root,{recursive:true,withFileTypes:true}).some(entry=>entry.isSymbolicLink()),'Historical sources cannot contain unverified symlinks.');
 assert.deepEqual(regularFiles(root),Object.keys(expected).sort(),'Inspect every historical source file, including unexpected additions.');
 for(const [name,value] of Object.entries(expected)){
  assert.ok(inside(root,resolve(root,name)),'Historical paths must stay in their owned source root.');
  const path=join(root,name),bytes=readFileSync(path);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),value.blobSHA1,'Extract the exact Git blob, never a substituted source file.');
  assert.equal(lstatSync(path).mode&0o111? '100755':'100644',value.mode,'Preserve historical executable modes.');
 }
}

const nativeTables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline','sqlite_sequence'];

function nativeSnapshot(db){
  const actual=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
  assert.deepEqual(actual,[...nativeTables].sort(),'Inspect every native table; update the evidence contract when the schema changes.');
  return Object.fromEntries(nativeTables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
}

// Source/SQLite compatibility control only; this does not admit another native pair.
async function selfCheckOldPreferences(){
 const oldSource='d3b291103f23a0e1e2ad14ce28810dc7572d0f02';
 const root=mkdtempSync(join(tmpdir(),'puptime-old-preferences-')),sourceRoot=join(root,'source');
 mkdirSync(sourceRoot,{mode:0o700});
 try{
  // Positive public paths retain old package imports and exclude environment files before body access.
  const rows=command('git',['ls-tree','-rz',oldSource,'--','src','package.json']).split('\0').filter(Boolean);
  const files=Object.fromEntries(rows.map(row=>{
   const match=row.match(/^(100644|100755) blob ([a-f0-9]{40})\t(src\/.+|package\.json)$/s);assert.ok(match);
   assert.ok(!match[3].split('/').some(part=>part==='..'||part==='.env'||part==='.env.example'));
   return [match[3],{mode:match[1],blobSHA1:match[2]}];
  }));
  assert.ok(Object.hasOwn(files,'src/local/runtime-factory.ts'));
  const archive=execFileSync('git',['archive','--format=tar',oldSource,'--','src','package.json'],{timeout:120000,maxBuffer:8*1024*1024});
  execFileSync('tar',['-xf','-','-C',sourceRoot],{input:archive,timeout:120000});
  assertArchivedSource(sourceRoot,files);
  // Read-only public test dependencies, never a native/dependency-graph admission.
  symlinkSync(realpathSync('node_modules'),join(sourceRoot,'node_modules'),'dir');
  const load=path=>import(pathToFileURL(join(sourceRoot,path)).href);
  const [oldDatabase,oldRuntime,oldAdapter,oldDomain,oldTheme,oldNotifications]=await Promise.all([
   load('src/local/database.ts'),load('src/local/runtime-factory.ts'),load('src/local/sqlite-test-adapter.ts'),
   load('src/domain.ts'),load('src/theme.ts'),load('src/notification-config.ts'),
  ]);
  const {createLocalDatabase,initializeLocalDatabase}=await import('../src/local/database.ts');
  const {createLocalRuntime}=await import('../src/local/runtime-factory.ts');
  const {sqliteTestConnection}=await import('../src/local/sqlite-test-adapter.ts');
  const {readLocalRecords}=await import('../src/local/sync-projection.ts');
  const {readBackupData}=await import('../src/local/backup-guard.ts');
  const {recordDataSchema}=await import('../src/cloud/protocol.ts');
  const snapshot=path=>{const db=new DatabaseSync(path,{readOnly:true});try{return nativeSnapshot(db);}finally{db.close();}};
  let cases=0;
  for(const theme of ['puppy-journal','soft-play','day-trails'])for(const association of ['guest','associated','detached']){
   assert.equal(oldTheme.isThemePreference(theme),true,'The exact old source must support the value as a normal preference.');
   const path=join(root,`case-${cases}.db`);let database;
   try{
    database=await oldDatabase.createLocalDatabase(oldAdapter.sqliteTestConnection(path));
    const {petId}=await oldDatabase.initializeLocalDatabase(database),old=await oldRuntime.createLocalRuntime(database,petId),store=old.storage;
    await store.completeOnboarding();
    const events=Array.from({length:12},(_,i)=>oldDomain.createEvent('pee','app',1700000000000+i));
    await store.appendEvents(events);
    await store.saveThemePreference(theme);await store.saveLanguagePreference('es');
    await store.saveCustomActivity('Upgrade agility');
    await store.saveActivityCustomization('custom:upgrade agility',{name:'Old agility',emoji:'🎾',color:5});
    await store.saveWidgetActions(['custom:upgrade agility','walk','meal']);
    await store.saveNotificationPreferences({...oldNotifications.DEFAULT_NOTIFICATION_PREFERENCES,reminderLeadMinutes:30,widgetConfirmations:true});
    assert.equal(await store.loadThemePreference(),theme);
    const expected={language:await store.loadLanguagePreference(),custom:await store.loadCustomActivities(),customizations:await store.loadActivityCustomizations(),widgets:await store.loadWidgetActions(),notifications:await store.loadNotificationPreferences()};
    let fence;
    if(association!=='guest'){
     const accountId='usr_'+petId.slice(4),enrollment={operationId:'op_'+old.deviceId.slice(4),deviceId:old.deviceId,localPetId:petId,name:await store.loadPuppyName()};
     const {generation}=await old.sync.prepareAssociation({accountId,localPetId:petId,deviceId:old.deviceId,enrollment});fence={generation,accountId};
     await old.sync.stageBaseline({...fence,page:{changes:[],cursor:0,hasMore:false}});
     await old.sync.completeAssociation({...fence,cloudPetId:petId});
    }
    await store.appendEvents([oldDomain.createEvent('meal','app',1700000000100)]);
    if(association==='detached')await old.sync.detach(fence);
    const oldEvents=await store.loadEvents(),oldName=await store.loadPuppyName();
    const before=snapshot(path),batch=association==='associated'?await old.sync.nextBatch(fence):[];
    assert.equal(before.events.length,13);assert.equal(before.settings.find(row=>row.key==='puptime.theme.v1')?.value,theme);
    assert.equal(before.local_sync_owner.length,association==='associated'?1:0);
    if(association==='associated')assert.ok(batch.length>0&&before.local_sync_outbox.length>0);else assert.deepEqual(before.local_sync_outbox,[]);
    await database.close();database=undefined;
    for(let reopen=0;reopen<2;reopen++){
     database=await createLocalDatabase(sqliteTestConnection(path));
     assert.equal((await initializeLocalDatabase(database)).petId,petId);
     const current=await createLocalRuntime(database,petId),reader=current.storage;
     assert.equal(await reader.loadThemePreference(),'system');assert.equal(await reader.loadLanguagePreference(),expected.language);
     assert.deepEqual(await reader.loadCustomActivities(),expected.custom);assert.deepEqual(await reader.loadActivityCustomizations(),expected.customizations);
     assert.deepEqual(await reader.loadWidgetActions(),expected.widgets);assert.deepEqual(await reader.loadNotificationPreferences(),expected.notifications);
     assert.deepEqual(await reader.loadEvents(),oldEvents);
     const records=await database.read(sql=>readLocalRecords(sql,petId));
     for(const record of records)assert.deepEqual(recordDataSchema(record.kind).parse(record.data),record.data);
     const preferences=records.filter(record=>record.kind==='accountPreferences'),n=expected.notifications;
     assert.equal(preferences.length,1);assert.equal(preferences[0].localId,'preferences');
     assert.deepEqual(preferences[0].data,{
      theme:'system',language:expected.language,widgetActions:expected.widgets,
      ...(n.mealReminderOffsetMinutes!==undefined?{mealReminderOffsetMinutes:n.mealReminderOffsetMinutes}:{}),
      ...(n.poopReminderOffsetMinutes!==undefined?{poopReminderOffsetMinutes:n.poopReminderOffsetMinutes}:{}),
      reminderLeadMinutes:n.reminderLeadMinutes,widgetConfirmations:n.widgetConfirmations,
      pottyAfterPeeEnabled:n.pottyAfterPee.enabled,pottyAfterPeeDelayMinutes:n.pottyAfterPee.delayMinutes,
      pottyAfterMealEnabled:n.pottyAfterMeal.enabled,pottyAfterMealDelayMinutes:n.pottyAfterMeal.delayMinutes,
     });
     assert.deepEqual(records.filter(record=>record.kind==='event').map(({localId,...record})=>({id:localId,...record.data})),oldEvents);
     assert.deepEqual(await database.read(sql=>readBackupData(sql,petId)),{puppyName:oldName,events:oldEvents});
     if(fence&&association==='associated')assert.deepEqual(await current.sync.nextBatch(fence),batch);
     assert.deepEqual(snapshot(path),before,'Every old table, history body, raw preference, association, pending mutation and sequence must survive current-source reads/reopen.');
     await database.close();database=undefined;
    }
    cases++;
   }finally{await database?.close();}
  }
  rmSync(join(sourceRoot,'node_modules'));assertArchivedSource(sourceRoot,files);
  assert.equal(cases,9);
  console.log('PASS old-source preference serialization/current storage/sync/backup readers: 3 shipped appearances x guest/associated/detached, all14 tables and two SQLite reopens; no native/SDK/numeric-upgrade qualification.');
 }finally{rmSync(root,{recursive:true,force:true});}
}
await selfCheckOldPreferences();
