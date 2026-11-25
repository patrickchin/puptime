// Input/oracle controls, not runtime or third-party authentication acceptance.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {archiveHistoricalSource,assertArchivedSource,assertRuntimeZip} from './native-runtime-inputs.mjs';
import {nativeTables} from './native-account-evidence.mjs';
import {eventSqlColumns,eventSqlValues} from '../src/record-sql.ts';
import {assertNumericUpgrade,digestBytes} from './native-upgrade-evidence.mjs';

test('actual Git archive excludes nested dotenv/owner files before extracting exact executable blobs',()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-enrolled-source-')),prior=process.cwd(),repo=join(root,'repo');mkdirSync(repo);mkdirSync(join(repo,'nested'));
 try{
  for(const name of ['.env','.env.example','owner.env','nested/.env.local','*',':(glob)*','index.ts','package.json','package-lock.json'])writeFileSync(join(repo,name),name+'\n');
  chmodSync(join(repo,'index.ts'),0o755);
  const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']);git(['add','.']);git(['-c','user.name=Synthetic QA','-c','user.email=qa@example.invalid','commit','-qm','Artificial archive control']);
  const source=git(['rev-parse','HEAD']);process.chdir(repo);
  const target=join(root,'source'),files=archiveHistoricalSource(source,target,join(root,'source.tar'));
  assert.deepEqual(Object.keys(files).sort(),['*',':(glob)*','index.ts','package-lock.json','package.json']);
  for(const excluded of ['.env','.env.example','owner.env','nested/.env.local'])assert.equal(existsSync(join(target,excluded)),false);
  assert.equal(files['index.ts'].mode,'100755');assert.ok(!existsSync(join(root,'source.tar')));
  assertArchivedSource(target,files);writeFileSync(join(target,'index.ts'),'substituted');assert.throws(()=>assertArchivedSource(target,files));
 }finally{process.chdir(prior);rmSync(root,{recursive:true,force:true});}
});

test('numeric enrolled oracle preserves15 events and every pending payload, with one exact safety backup',()=>{
 const timestamp=Date.UTC(2026,10,25,12),clock={date:'2026-11-25',timeZone:'Etc/UTC',offsetSeconds:0,timestamp};
 const events=Array.from({length:15},(_,index)=>({id:'evt_enrolled_'+index,type:'pee',at:timestamp-15000+index,source:'app'}));
 const tables=Object.fromEntries(nativeTables.map(name=>[name,[]]));
 tables.puppies=[{id:'pet_enrolled',name:'Synthetic Maple'}];tables.events=events.map(({id,...data})=>({id,pet_id:'pet_enrolled',...Object.fromEntries(eventSqlColumns.map((key,index)=>[key,eventSqlValues(data)[index]]))}));
 tables.metadata=[{key:'active_pet_id',value:'pet_enrolled'},{key:'backup_app_version',value:'1.12.5/1'}];
 tables.local_sync_owner=[{account_id:'usr_artificial',generation:'gen_artificial'}];tables.local_sync_outbox=[{operation_id:'op_artificial',mutation_json:'{"artificial":"pending"}',sequence:42}];
 const dailyName='activity-backups/bkp_'+'a'.repeat(32)+'.json',newName='activity-backups/bkp_'+'b'.repeat(32)+'.json';
 const backup={format:'puptime-activity',version:1,createdAt:timestamp-1000,petId:'pet_enrolled',puppyName:'Synthetic Maple',reason:'daily',appVersion:'1.12.5/1',events:[events[0]]};
 const daily=JSON.stringify(backup),before={tables,files:{[dailyName]:digestBytes(daily)},backups:{[dailyName]:daily},pendingWidgetFiles:{},widgetTimelines:{}};
 const after=structuredClone(before),updated=JSON.stringify({...backup,createdAt:timestamp+500,reason:'before-update',appVersion:'1.13.0/3',events:[...events].reverse()});
 after.files[newName]=digestBytes(updated);after.backups[newName]=updated;after.tables.metadata[1].value='1.13.0/3';
 const options={started:clock,finished:{...clock,timestamp:timestamp+1000},oldVersion:'1.12.5/1',newVersion:'1.13.0/3',expectedEvents:15};
 assert.equal(assertNumericUpgrade(before,after,options),newName);
 for(const mutate of [state=>state.tables.local_sync_outbox[0].mutation_json='changed',state=>state.tables.local_sync_owner[0].generation='changed',state=>state.tables.events.pop(),state=>state.backups[dailyName]='changed',state=>state.files.extra='unexpected']){const bad=structuredClone(after);mutate(bad);assert.throws(()=>assertNumericUpgrade(before,bad,options));}
});

test('archive admission rejects traversal, duplicate members and escaping app symlinks before extraction',()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-upgrade-zip-'));
 try{
  execFileSync('python3',['-c',String.raw`import pathlib,stat,sys,warnings,zipfile
root=pathlib.Path(sys.argv[1]);warnings.filterwarnings('ignore',category=UserWarning)
cases={'baseline':[('Puptime-iOS-Simulator.zip',b'inner'),('upgrade-baseline.json',b'{}')],'host':[('Puptime-iOS-Simulator.zip',b'inner')],'traversal':[('../outside',b'bad')],'duplicate':[('Puptime-iOS-Simulator.zip',b'a'),('Puptime-iOS-Simulator.zip',b'b')],'inner':[('Puptime.app/Info.plist',b'fixture')]}
for name,items in cases.items():
 with zipfile.ZipFile(root/(name+'.zip'),'w',compression=zipfile.ZIP_DEFLATED) as z:
  for path,data in items:z.writestr(path,data)
with zipfile.ZipFile(root/'symlink.zip','w') as z:
 i=zipfile.ZipInfo('Puptime.app/escape');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'../../outside')
with zipfile.ZipFile(root/'chain.zip','w') as z:
 for name,target in [('a','.'),('b','a/../outside')]:
  i=zipfile.ZipInfo('Puptime.app/'+name);i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,target)
`,root]);
  for(const kind of ['baseline','host','inner'])assertRuntimeZip(join(root,kind+'.zip'),kind);
  for(const [name,kind] of [['traversal','host'],['duplicate','host'],['symlink','inner'],['chain','inner']])assert.throws(()=>assertRuntimeZip(join(root,name+'.zip'),kind));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('actual beta and CSV child cleanup removes private inputs after process/DB closure while preserving receipts and legacy schemas',async()=>{
 const source=readFileSync(new URL('./verify-native-guest-account.mjs',import.meta.url),'utf8'),start=source.indexOf('const task=installTaskCleanup(async()=>{'),end=source.indexOf('\ntry{',start);assert.ok(start>=0&&end>start);
 const body=source.slice(start,end)+';await task.run();',AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 for(const scenario of ['beta','csv','legacy'])for(const completed of [true,false])for(const denied of scenario==='legacy'?[false]:[false,true]){
  const root=mkdtempSync(join(tmpdir(),'puptime-beta-child-cleanup-')),privateDir=join(root,'private'),output=join(root,'receipts'),order=[],status={};mkdirSync(privateDir);mkdirSync(output);
  writeFileSync(join(privateDir,'auth.db'),'synthetic');writeFileSync(join(privateDir,'fixture.key'),'synthetic');mkdirSync(join(privateDir,'old-node_modules'));
  const finiteFailure='{"phase":"csv-import","status":"UNKNOWN"}\n';writeFileSync(join(output,'csv-failed-command.json'),finiteFailure);
  const parameters={installTaskCleanup:run=>({run}),changeSockets:[],proxy:undefined,activeStops:[async()=>{order.push('processes');return true;}],stopWorker:undefined,auth:{close(){order.push('database');}},android:false,restoreNative:[],temporaryDevices:[],deleteOwnedSimulator:()=>{throw Error('No simulator belongs to this control.');},privateDir,completed,existsSync,betaEnrolled:scenario==='beta',csvRecovering:scenario==='csv',rmSync:(path,options)=>{assert.equal(path,privateDir);assert.deepEqual(order,['processes','database']);if(denied)throw Error('Injected removal failure');rmSync(path,options);},writeFileSync,join,output,process:status};
  try{
   await new AsyncFunction(...Object.keys(parameters),body)(...Object.values(parameters));
   const result=JSON.parse(readFileSync(join(output,'sdk-task-cleanup.json')));
   if(scenario==='legacy')assert.deepEqual(result,{status:'passed',processesStopped:true,nativeRestored:true,simulators:[]});
   else{assert.equal(result.databaseClosed,true);assert.equal(result.privateDirectoryRemoved,!denied);assert.equal(result.status,denied?'failed':'passed');}
   assert.equal(existsSync(privateDir),scenario==='legacy'||denied);assert.equal(status.exitCode,denied?1:undefined);assert.equal(readFileSync(join(output,'csv-failed-command.json'),'utf8'),finiteFailure);
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});

test('unbound beta target rejects enrolled preparation before filesystem, network or simulator execution',()=>{
 const root=mkdtempSync(join(tmpdir(),'puptime-beta-unbound-')),target=join(root,'inputs');
 try{const result=spawnSync(process.execPath,[resolve('scripts/verify-ios-runtime-upgrade.mjs'),'--prepare-beta-enrolled',target],{stdio:'ignore'});assert.equal(result.status,1);assert.equal(existsSync(target),false);}
 finally{rmSync(root,{recursive:true,force:true});}
});
