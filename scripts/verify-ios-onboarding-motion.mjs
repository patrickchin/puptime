// Actual iOS accessibility preference and installed-app interaction, no flag mock.
// Precondition: Settings is on Accessibility > Motion, as inspected by its flow.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const udid=process.argv[2],app='com.patrickchin.puptime';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.equal(devices.find(device=>device.udid===udid)?.name,'Puptime Native Storage ae0c');
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-motion-'));
const flow=(file,phase,values={})=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',...Object.entries(values).flatMap(([key,value])=>['-e',`${key}=${value}`]),resolve('.maestro/native',file),'--test-output-dir',join(output,phase,file)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
const directory=()=>join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
try{simctl('terminate',udid,app);}catch{}
cpSync(directory(),join(output,'previous-synthetic-sqlite'),{recursive:true});
const oldSize=simctl('ui',udid,'content_size');
simctl('ui',udid,'content_size','large');
try{
  for(const [phase,value,other] of [['off','0','1'],['on','1','0']]){
    console.log('> Flow actual native Reduce Motion:',phase);
    flow('ios-onboarding-motion-prepare.yaml',phase,{MOTION_VALUE:value,OTHER_MOTION_VALUE:other});
    const database=new DatabaseSync(join(directory(),'puptime-v2.db'),{readOnly:true});
    const tables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline','legacy_snapshots'];
    const snapshot=()=>Object.fromEntries(tables.map(table=>[table,database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
    try{
      const before=snapshot();
      flow('ios-onboarding-motion-practice.yaml',phase);
      assert.deepEqual(snapshot(),before,'All practice feedback must stay outside durable puppy/account data.');
      console.log('PASS actual OS Reduce Motion',phase,': all three practice choices show feedback and leave all local tables unchanged. Review the recorded puppy response separately.');
    }finally{database.close();}
  }
  console.log('Native motion evidence and synthetic recovery backup:',output);
}finally{try{flow('ios-reduce-motion-restore.yaml','restore');}finally{simctl('ui',udid,'content_size',oldSize);}}
