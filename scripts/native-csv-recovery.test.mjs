// Source-oracle controls only. Platform sharing, Safari and Files require native execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,lstatSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {eventsToCsv,csvToEvents,CsvImportError} from '../src/export.ts';
import {eventDataFromSql,eventSqlColumns,eventSqlValues} from '../src/record-sql.ts';
import {nativeTables} from './native-account-evidence.mjs';

const source=readFileSync(new URL('./verify-native-guest-account.mjs',import.meta.url),'utf8');
const start=source.indexOf('\nasync function verifyNativeCsvRecovery(){'),end=source.indexOf('\nasync function remote(',start);
assert.ok(start>=0&&end>start);
const recipe=source.slice(start,end);
const events=Array.from({length:12},(_,index)=>({id:'evt_csv_'+String(index).padStart(2,'0'),type:['pee','poop','meal'][index%3],at:Date.UTC(2026,10,25,12)+index,source:'app',...(index===11?{note:'Original, quoted "note"\nsecond line'}:{})}));
const rows=events.map(({id,...data})=>({id,...Object.fromEntries(eventSqlColumns.map((key,index)=>[key,eventSqlValues(data)[index]]))}));

async function execute(failure){
 const root=mkdtempSync(join(tmpdir(),'puptime-csv-oracle-'));mkdirSync(join(root,'Library/Caches'),{recursive:true});
 let state,imports=0,downloadKind,deviceCount=0;const hits={valid:0,invalid:0},seen=[];
 const reset=()=>{state={events:[],owner:[],pending:0,tables:Object.fromEntries(nativeTables.map(name=>[name,[]]))};const id='pet_csv_'+(++deviceCount);state.tables.puppies=[{id,name:'Recipient puppy'}];state.tables.metadata=[{key:'active_pet_id',value:id}];};reset();
 const syncRows=()=>{state.tables.events=state.events.map(row=>({...row,pet_id:state.tables.puppies[0].id}));};
 const toEvents=()=>state.events.map(({id,...row})=>({id,...eventDataFromSql(row)}));
 const flow=async(name,env)=>{
  seen.push(name);
  if(name==='add-logs'){state.events=structuredClone(rows);syncRows();}
  if(name==='csv-export')writeFileSync(join(root,'Library/Caches/puptime-activity-2026-11-25.csv'),eventsToCsv(failure==='export'?toEvents().slice(1):toEvents()));
  if(name==='csv-download')hits[downloadKind]++;
  if(name==='csv-import'){
   assert.equal(env.CSV_NAME,'puptime-qa-recovery');imports++;
   assert.deepEqual([env.ADDED,env.SKIPPED],imports===1?['12','0']:['0','12']);
   if(imports===1||failure==='repeat')state.events=csvToEvents(readFileSync(join(root,'Library/Caches/puptime-activity-2026-11-25.csv'),'utf8')).map(({id,...data})=>({id,...Object.fromEntries(eventSqlColumns.map((key,index)=>[key,eventSqlValues(data)[index]]))}));
   if(failure==='restore')state.events[0].at++;
   syncRows();
   if(failure==='recipient')state.tables.events[0].pet_id='pet_foreign';
   if(failure==='profile')state.tables.puppies[0].name='Unexpected replacement';
  }
  if(name==='csv-edit'&&!(failure==='edit'&&imports>0)&&failure!=='seed-note'){state.events.find(row=>row.id==='evt_csv_11').note=env.CSV_NOTE;syncRows();}
  if(name==='csv-invalid'&&failure==='invalid')state.tables.metadata.push({key:'unexpected',value:'changed'});
  if(name==='reopen-guest'){
   assert.deepEqual(env,{EXPECTED_COUNT:'12',OFFLINE:'false'});
   if(failure==='restart')state.events.pop();
  }
 };
 const parameters={assert,csvRecovering:true,android:false,writeFileSync,join,output:root,csvToEvents,CsvImportError,invalidCsv:Buffer.from('"Date,Time,Activity\nunterminated'),flow,snapshot:()=>structuredClone(state),simctl:(command,...args)=>{
  if(command==='get_app_container')return root;
  assert.equal(command,'openurl');downloadKind=args.at(-1).endsWith('invalid.csv')?'invalid':'valid';
 },device:'synthetic-device',app:'synthetic-app',readdirSync,lstatSync,statSync,readFileSync,eventDataFromSql,Buffer,freshIosRestoreDevice:async()=>reset(),emptyRestorePreflight:()=>assert.equal(state.events.length,0),front:'https://127.0.0.1:8797',until:async(predicate,message)=>assert.ok(predicate(),message),csvDownloadHits:hits,createHash};
 const run=new Function(...Object.keys(parameters),'let csvDownload;'+recipe+';return verifyNativeCsvRecovery();');
 try{
  await run(...Object.values(parameters));
  const proof=JSON.parse(readFileSync(join(root,'csv-recovery.json')));
  assert.equal(proof.restoredEvents,12);assert.equal(proof.exportedSHA256,createHash('sha256').update(eventsToCsv(events.map(row=>row.id==='evt_csv_11'?{...row,note:'Morning meal, \"all done\" — 小狗 🐾'}:row))).digest('hex'));
  assert.ok(seen.indexOf('csv-edit')<seen.lastIndexOf('csv-import'));
  assert.equal(seen.at(-1),'reopen-guest');
 }finally{rmSync(root,{recursive:true,force:true});}
}

test('CSV recovery recipe accepts byte-exact export, native edit, repeat import, invalid rejection and cold preservation',async()=>execute());
test('CSV recovery oracles reject missing export data, changed restore/edit/reimport, invalid-table changes and restart loss',async()=>{
 for(const failure of ['seed-note','export','restore','edit','repeat','invalid','restart','recipient','profile'])await assert.rejects(()=>execute(failure));
});
