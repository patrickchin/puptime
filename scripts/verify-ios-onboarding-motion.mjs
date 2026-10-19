// Actual iOS accessibility preference and installed-app interaction, no flag mock.
// Inspect the actual Settings preference; require and restore initial Off.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const udid=process.argv[2],app='com.patrickchin.puptime';
const selected=process.argv[3];if(selected)assert.ok(['on','off'].includes(selected));
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage ae0c first-launch '));
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-motion-'));
const flow=(file,phase,values={})=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...Object.entries(values).flatMap(([key,value])=>['-e',`${key}=${value}`]),resolve('.maestro/native',file),'--test-output-dir',join(output,phase,file)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
const directory=()=>join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
try{simctl('terminate',udid,app);}catch(error){if(!String(error.stderr??'').includes('found nothing to terminate'))throw error;}
const previous=new DatabaseSync(join(directory(),'puptime-v2.db'),{readOnly:true});
try{assert.equal(previous.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0,'Preserve account-owned history.');}finally{previous.close();}
cpSync(directory(),join(output,'previous-synthetic-sqlite'),{recursive:true});
const oldSize=simctl('ui',udid,'content_size');
simctl('ui',udid,'content_size','large');
let inspected=false,switchPoint;
try{
  flow('ios-reduce-motion-settings.yaml','inspect');
  const hierarchy=JSON.parse(execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'hierarchy','--no-ansi'],{encoding:'utf8',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}}));
  let screen,row;
  function inspect(node){
    const attributes=node.attributes,bounds=attributes?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
    if(bounds&&bounds[0]===0&&bounds[1]===0&&bounds[2]>0&&bounds[3]>0&&!screen)screen=bounds;
    if(attributes?.['resource-id']==='REDUCE_MOTION'&&['0','1'].includes(attributes.value))row=bounds;
    for(const child of node.children??[])inspect(child);
  }
  inspect(hierarchy);assert.ok(screen&&row&&row[2]-row[0]>70);
  // The ID includes the label and switch. Its centre hits the label; the
  // inspected trailing switch is30pt from the value row's right edge.
  switchPoint=`${Math.round((row[2]-30)/screen[2]*100)}%,${Math.round((row[1]+row[3])/2/screen[3]*100)}%`;
  inspected=true;
  for(const [phase,value,other] of [['off','0','1'],['on','1','0']].filter(([phase])=>!selected||phase===selected)){
    console.log('> Flow actual native Reduce Motion:',phase);
    flow('ios-onboarding-motion-prepare.yaml',phase,{MOTION_VALUE:value,OTHER_MOTION_VALUE:other,MOTION_SWITCH_POINT:switchPoint});
    const database=new DatabaseSync(join(directory(),'puptime-v2.db'),{readOnly:true});
    const tables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'];
    const snapshot=()=>Object.fromEntries(tables.map(table=>[table,database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
    try{
      const before=snapshot();
      flow('ios-onboarding-motion-practice.yaml',phase);
      assert.deepEqual(snapshot(),before,'All practice feedback must stay outside durable puppy/account data.');
      console.log('PASS actual OS Reduce Motion',phase,': all three practice choices show feedback and leave all local tables unchanged. Review the recorded puppy response separately.');
    }finally{database.close();}
  }
  console.log('Native motion evidence and synthetic recovery backup:',output);
}finally{try{if(inspected)flow('ios-reduce-motion-restore.yaml','restore',{MOTION_SWITCH_POINT:switchPoint});}finally{simctl('ui',udid,'content_size',oldSize);}}
