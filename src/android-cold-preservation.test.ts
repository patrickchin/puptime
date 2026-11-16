import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Execute the actual producer/native helpers. Every database below is generated.
const source=readFileSync(new URL('../scripts/verify-android-signing-upgrade.mjs',import.meta.url),'utf8');
const nativeSource=readFileSync(new URL('../scripts/native-account-evidence.mjs',import.meta.url),'utf8');
function between(text:string,start:string,end:string){const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);}
type Row=Record<string,unknown>;
type State={tables:Record<string,Row[]>;uid:string;widgets:{id:string;host:string;provider:string};files:Record<string,{sha256:string;bytes:Uint8Array}>;sqlite?:{schema:Row[];metadata:Record<string,unknown>}};
const native=Function('assert',between(nativeSource,'export const nativeTables=','const associationTables=').replace('export ','')+between(nativeSource,'export function nativeSnapshot(','export function assertNativeDetached(').replaceAll('export ','')+'return {nativeTables,nativeSnapshot,assertNativeTransition};')(assert) as {nativeTables:string[];nativeSnapshot:(db:DatabaseSync)=>State['tables'];assertNativeTransition:(before:State['tables'],after:State['tables'])=>void};
const code=between(source,'const sqliteFile=','// Exact user-0 package row;')+between(source,'function coldPreservationEquality(','function permissionControl(')+between(source,'function preservationEquality(','function preservationLaunched(');
const helpers=Function('assert','preservationFailures','preservationProjection',code+'return {sqliteState,coldPreservationEquality,preservationEquality};')(assert,new WeakMap(),()=>({})) as {sqliteState:(db:DatabaseSync)=>NonNullable<State['sqlite']>;coldPreservationEquality:typeof factory;preservationEquality:typeof factory};
declare function factory(transition:typeof native.assertNativeTransition,eventData:(row:Row)=>Row):(before:State,after:State)=>void;
const eventData=({id:_id,pet_id:_pet,...row}:Row)=>row;
const equalCold=helpers.coldPreservationEquality(native.assertNativeTransition,eventData),equalStrict=helpers.preservationEquality(native.assertNativeTransition,eventData);
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const databaseName='files/SQLite/puptime-v2.db',version='1.12.7/1012007';
const pragmas=['user_version','application_id','page_size','encoding','auto_vacuum','journal_mode'];

function fixture(t:TestContext,options:Record<string,string|number>={}){
 const folder=mkdtempSync(join(tmpdir(),'puptime-cold-source-')),path=join(folder,'generated.sqlite'),db=new DatabaseSync(path);
 t.after(()=>{try{db.close();}finally{rmSync(folder,{recursive:true,force:true});}});
 const config={page_size:4096,encoding:'UTF-8',auto_vacuum:0,user_version:0,application_id:0,journal_mode:'WAL',...options};
 for(const [name,value] of Object.entries(config))db.exec('PRAGMA '+name+' = '+(typeof value==='string'?"'"+value+"'":value));
 db.exec('PRAGMA wal_autocheckpoint=0');
 db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE puppies(id TEXT PRIMARY KEY,name TEXT); CREATE TABLE events(id TEXT PRIMARY KEY,pet_id TEXT,type TEXT,at INTEGER,note TEXT); CREATE TABLE local_revisions(sequence INTEGER PRIMARY KEY AUTOINCREMENT,pet_id TEXT,kind TEXT,local_id TEXT);');
 for(const name of native.nativeTables)if(!['metadata','puppies','events','local_revisions','sqlite_sequence'].includes(name))db.exec('CREATE TABLE '+name+'(id TEXT PRIMARY KEY,value TEXT)');
 db.exec("INSERT INTO metadata VALUES('schema_version','4'); INSERT INTO puppies VALUES('pet_generated','Generated'); INSERT INTO events VALUES('evt_generated','pet_generated','pee',1,'generated'); INSERT INTO local_revisions(pet_id,kind,local_id) VALUES('pet_generated','event','evt_generated');");
 db.prepare('INSERT INTO metadata VALUES(?,?)').run('backup_app_version',version);
 function capture():State{
  const files:State['files']={};
  for(const suffix of ['', '-wal','-shm','-journal'])if(existsSync(path+suffix)){const bytes=readFileSync(path+suffix);files[databaseName+suffix]={sha256:hash(bytes),bytes};}
  for(const name of ['shared_prefs/generated.xml','files/puppy-photos/generated.jpg','files/dog-photos/generated.jpg','files/activity-backups/bkp_'+ 'a'.repeat(32)+'.json','files/SQLite/unrelated.data']){const bytes=Buffer.from('generated protected bytes');files[name]={sha256:hash(bytes),bytes};}
  const observer=new DatabaseSync(path,{readOnly:true});observer.exec('BEGIN');
  try{
   assert.equal(observer.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(observer.prepare('PRAGMA foreign_key_check').all(),[]);
   return {tables:native.nativeSnapshot(observer),sqlite:helpers.sqliteState(observer),uid:'10123',widgets:{id:'7',host:'generated-host',provider:'generated-provider'},files};
  }finally{observer.exec('ROLLBACK');observer.close();}
 }
 return {db,capture};
}

test('cold oracle accepts a generated physical checkpoint; original strict-byte oracle rejects it',t=>{
 const f=fixture(t),before=f.capture();assert.equal(Object.keys(before.tables).length,14);
 assert.deepEqual(Object.keys(before.sqlite!.metadata),pragmas);for(const row of before.sqlite!.schema)assert.deepEqual(Object.keys(row),['type','name','tbl_name','sql']);
 assert.equal(f.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()!.busy,0);const after=f.capture();
 assert.deepEqual(after.tables,before.tables);assert.deepEqual(after.sqlite,before.sqlite);assert.notDeepEqual(after.files,before.files);
 assert.doesNotThrow(()=>equalCold(before,after));assert.throws(()=>equalStrict(before,after),{code:'ERR_ASSERTION'});
});

test('all fourteen table snapshots, IDs, application versions and sequence counters remain exact',t=>{
 const f=fixture(t),before=f.capture();
 for(const table of native.nativeTables){const after=structuredClone(before);after.tables[table].push({generated:'changed'});assert.throws(()=>equalCold(before,after),{code:'ERR_ASSERTION'});}
 for(const sql of ["UPDATE events SET note='changed'", "UPDATE events SET id='evt_changed'", "UPDATE metadata SET value='1.12.6/1012006' WHERE key='backup_app_version'", "UPDATE metadata SET value='999' WHERE key='schema_version'", "UPDATE sqlite_sequence SET seq=seq+1 WHERE name='local_revisions'"]){
  const real=fixture(t),original=real.capture();real.db.exec(sql);assert.throws(()=>equalCold(original,real.capture()),{code:'ERR_ASSERTION'});
 }
});

test('index, trigger, view and empty-table column changes fail even with identical all-table rows',t=>{
 for(const sql of ['CREATE INDEX generated_note ON events(note)','CREATE TRIGGER generated_trigger AFTER UPDATE ON events BEGIN SELECT 1; END','CREATE VIEW generated_view AS SELECT id FROM events','ALTER TABLE routines ADD COLUMN generated_column TEXT']){
  const f=fixture(t),before=f.capture();f.db.exec(sql);const after=f.capture();assert.deepEqual(after.tables,before.tables);assert.notDeepEqual(after.sqlite!.schema,before.sqlite!.schema);assert.throws(()=>equalCold(before,after),{code:'ERR_ASSERTION'});
 }
});

test('all six durable application/format PRAGMAs are observed and compared',t=>{
 for(const [name,value] of Object.entries({user_version:7,application_id:77,page_size:8192,encoding:'UTF-16le',auto_vacuum:1,journal_mode:'DELETE'})){
  const original=fixture(t),other=fixture(t,{[name]:value}),before=original.capture(),after=other.capture();
  assert.deepEqual(after.tables,before.tables);assert.deepEqual(after.sqlite!.schema,before.sqlite!.schema);assert.notEqual(after.sqlite!.metadata[name],before.sqlite!.metadata[name]);assert.throws(()=>equalCold(before,after),{code:'ERR_ASSERTION'});
 }
});

test('volatile SQLite schema counters and root-page placement are outside the semantic projection',t=>{
 const f=fixture(t),before=f.capture(),cookie=f.db.prepare('PRAGMA schema_version').get()!.schema_version;
 f.db.exec('CREATE INDEX generated_temporary ON events(note); DROP INDEX generated_temporary');assert.notEqual(f.db.prepare('PRAGMA schema_version').get()!.schema_version,cookie);
 const after=f.capture();assert.deepEqual(after.tables,before.tables);assert.deepEqual(after.sqlite,before.sqlite);assert.doesNotThrow(()=>equalCold(before,after));assert.throws(()=>equalStrict(before,after),{code:'ERR_ASSERTION'});
 for(const key of ['schema_version','data_version','page_count','freelist_count','rootpage'])assert.ok(!(key in before.sqlite!.metadata));
});

test('UID, widget identity and missing private SQLite observations fail closed',t=>{
 const before=fixture(t).capture();
 for(const change of [(after:State)=>{after.uid='10124';},(after:State)=>{after.widgets.id='8';},(after:State)=>{after.widgets.host='other';},(after:State)=>{after.widgets.provider='other';},(after:State)=>{delete after.sqlite;},(after:State)=>{delete after.sqlite!.metadata.user_version;}]){const after=structuredClone(before);change(after);assert.throws(()=>equalCold(before,after),{code:'ERR_ASSERTION'});}
});

test('every non-SQLite add/remove/change stays forbidden, including a valid extra update backup',t=>{
 const before=fixture(t).capture();
 for(const name of Object.keys(before.files).filter(name=>!/^files\/SQLite\/puptime-v2\.db(?:-wal|-shm|-journal)?$/.test(name))){
  for(const kind of ['add','remove','change']){const after=structuredClone(before);if(kind==='add')after.files[name+'.new']={sha256:hash(Buffer.from('new')),bytes:Buffer.from('new')};else if(kind==='remove')delete after.files[name];else after.files[name].sha256=hash(Buffer.from('changed'));assert.throws(()=>equalCold(before,after),{code:'ERR_ASSERTION'});}
 }
 const after=structuredClone(before),bytes=Buffer.from(JSON.stringify({format:'puptime-activity',version:1,createdAt:2,petId:'pet_generated',puppyName:'Generated',reason:'before-update',appVersion:version,events:before.tables.events.map(row=>({id:row.id,...eventData(row)}))}));
 after.files['files/activity-backups/bkp_'+ 'b'.repeat(32)+'.json']={sha256:hash(bytes),bytes};assert.throws(()=>equalCold(before,after),{code:'ERR_ASSERTION'});
});

test('only the existing exact four-file SQLite family may vary physically',t=>{
 const before=fixture(t).capture(),after=structuredClone(before);
 for(const suffix of ['', '-wal','-shm','-journal']){const bytes=Buffer.from('generated physical-only difference');after.files[databaseName+suffix]={sha256:hash(bytes),bytes};}
 assert.doesNotThrow(()=>equalCold(before,after));assert.throws(()=>equalStrict(before,after),{code:'ERR_ASSERTION'});
 const extra=structuredClone(before),bytes=Buffer.from('unknown file');extra.files[databaseName+'-unexpected']={sha256:hash(bytes),bytes};assert.throws(()=>equalCold(before,extra),{code:'ERR_ASSERTION'});
});
