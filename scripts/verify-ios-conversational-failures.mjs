// Actual SQLite failures in the installed conversational app, without app test hooks.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const [device,consent,destination='build/onboarding-failure-results']=process.argv.slice(2);
assert.equal(consent,'--replace-synthetic','Pass --replace-synthetic for the dedicated test installation.');
const app='com.patrickchin.puptime',output=resolve(destination);
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.match(devices.find(item=>item.udid===device)?.name??'',/^Puptime .*Onboarding/,'Use a dedicated Puptime onboarding simulator.');
mkdirSync(output,{recursive:true});
try{simctl('terminate',device,app);}catch{}
const directory=join(simctl('get_app_container',device,app,'data'),'Documents/SQLite');
const path=join(directory,'puptime-v2.db');
if(existsSync(path)){
  const previous=new DatabaseSync(path,{readOnly:true});
  try{assert.equal(previous.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Do not replace cloud-owned history.');}finally{previous.close();}
  cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
}
function flow(name){
  const wrapper=join(output,name+'-active.yaml');
  writeFileSync(wrapper,'appId: '+app+'\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- runFlow: '+JSON.stringify(resolve('.maestro/helpers/conversational/failures',name+'.yaml'))+'\n');
  // Driver startup alone may take three minutes on the hosted simulator.
  execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',device,'test',wrapper,'--test-output-dir',join(output,name)],{stdio:'inherit',timeout:600000,env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
}
flow('prepare');
// clearState recreated the container; resolve the path again after preparation.
const database=new DatabaseSync(join(simctl('get_app_container',device,app,'data'),'Documents/SQLite/puptime-v2.db'));
database.exec('PRAGMA busy_timeout=5000');
const flag=key=>database.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
const checks=[];
function incomplete(){assert.equal(flag('show_onboarding'),'true');assert.notEqual(flag('first_launch_step'),'done');}
function failWrite(table,condition){
  database.exec(`CREATE TRIGGER qa_onboarding_insert BEFORE INSERT ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'synthetic onboarding write failure'); END;`);
}
function recover(){database.exec('DROP TRIGGER IF EXISTS qa_onboarding_insert;DROP TRIGGER IF EXISTS qa_onboarding_complete;');}
try{
  incomplete();
  failWrite('metadata',"NEW.key='notify_on_device'");
  try{flow('allow-failure');incomplete();checks.push('permission intent failure retains reminder draft');}finally{recover();}
  flow('allow-retry');assert.equal(flag('notify_on_device'),'true');
  failWrite('metadata',"NEW.key='notify_on_device'");
  try{flow('defer-failure');incomplete();assert.equal(flag('notify_on_device'),'true');checks.push('defer failure does not claim delivery was disabled');}finally{recover();}
  flow('defer-retry');assert.equal(flag('notify_on_device'),'false');

  for(const stage of ['schedule','preferences','completion']){
    if(stage==='schedule')failWrite('routines','1');
    if(stage==='preferences')failWrite('settings',"NEW.key='puptime.notificationPreferences.v1'");
    if(stage==='completion')database.exec("CREATE TRIGGER qa_onboarding_complete BEFORE UPDATE OF value ON metadata WHEN OLD.key='show_onboarding' BEGIN SELECT RAISE(ABORT,'synthetic completion failure'); END;");
    try{flow('finish-failure');incomplete();checks.push(stage+' write failure leaves completion marker unset');}finally{recover();}
    if(stage==='preferences')flow('review-retained');
  }
  const before=database.prepare('SELECT id,type,minutes,tolerance_minutes FROM routines ORDER BY id').all();
  assert.equal(before.length,4);
  assert.deepEqual(before.map(({type,minutes,tolerance_minutes})=>[type,minutes,tolerance_minutes]).sort((a,b)=>a[1]-b[1]),[
    ['meal',480,null],['poop',525,15],['meal',1080,null],['poop',1125,15],
  ]);
  flow('finish-retry');
  assert.equal(flag('show_onboarding'),'false');assert.equal(flag('first_launch_step'),'done');
  assert.equal(database.prepare('SELECT name FROM puppies').get().name,'Biscuit');
  assert.deepEqual(database.prepare('SELECT id,type,minutes,tolerance_minutes FROM routines ORDER BY id').all(),before,'Retry must not duplicate or replace the chosen routine IDs.');
  assert.equal(database.prepare('SELECT COUNT(*) n FROM events').get().n,0,'Dismissing the recovered guide creates no fake log.');
  assert.equal(database.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0);
  const preferences=JSON.parse(database.prepare("SELECT value FROM settings WHERE key='puptime.notificationPreferences.v1'").get().value);
  assert.deepEqual(preferences.pottyAfterMeal,{enabled:true,delayMinutes:45});
  assert.equal(flag('notify_on_device'),'false');
  checks.push('recovered completion retains name, exact routine IDs, timing, opt-out and real navigation after restart');
  writeFileSync(join(output,'verification.json'),JSON.stringify({status:'passed',checks},null,2)+'\n');
  console.log('PASS real conversational permission/defer/schedule/preferences/completion failures and retries. Evidence: '+output);
}finally{recover();database.close();}
