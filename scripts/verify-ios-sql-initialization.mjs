// Exercise the production initializer through the real native Expo SQLite SDK.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {STARTER_SCHEDULE} from '../src/domain.ts';
const udid=process.argv[2],app='com.patrickchin.puptime';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8'}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(device=>device.udid===udid);
assert.ok(device?.name.startsWith('Puptime Native Storage '));
const root=simctl('get_app_container',udid,app,'data'),documents=join(root,'Documents'),path=join(documents,'SQLite/puptime-v2.db');
assert.ok(!existsSync(path),'Use a fresh dedicated installation; never erase an existing database.');
const output=mkdtempSync(join(tmpdir(),'puptime-native-sql-init-')),fault=join(documents,'native-init-fault');
function flow(name,body){const file=join(output,name+'.yaml');writeFileSync(file,'appId: '+app+'\n---\n'+body);execFileSync('maestro',['--device',udid,'test',file,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});}
mkdirSync(documents,{recursive:true});writeFileSync(fault,'synthetic initialization fault');
try{
 flow('atomic-init-failure',`
- launchApp
- extendedWaitUntil:
    visible:
      id: setup.loadError
    timeout: 60000
- assertNotVisible:
    id: screen.today
- takeScreenshot: first-open-initialization-error
`);
 const failed=new DatabaseSync(path,{readOnly:true});
 try{assert.deepEqual(failed.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all(),[]);}finally{failed.close();}
 console.log('PASS actual native starter insert failure rolls back every application table and first puppy.');
 rmSync(fault);
 flow('atomic-init-retry',`
- tapOn:
    id: setup.retry
- extendedWaitUntil:
    visible:
      id: setup.step.welcome
    timeout: 60000
- runFlow: ${resolve('.maestro/helpers/skip-onboarding.yaml')}
- extendedWaitUntil:
    visible:
      id: screen.today
    timeout: 30000
`);
 const database=new DatabaseSync(path,{readOnly:true});
 try{
  const before=database.prepare('SELECT * FROM puppies').all();
  assert.equal(before.length,1);assert.equal(before[0].name,'My puppy');
  assert.equal(database.prepare('SELECT COUNT(*) n FROM routines').get().n,STARTER_SCHEDULE.length);
  assert.equal(database.prepare("SELECT value FROM metadata WHERE key='schema_version'").get().value,'4');
  assert.equal(database.prepare("SELECT value FROM metadata WHERE key='first_launch_step'").get().value,'done');
  assert.equal(database.prepare("SELECT value FROM metadata WHERE key='show_onboarding'").get().value,'false');
  assert.equal(database.prepare("SELECT value FROM metadata WHERE key='notify_on_device'").get().value,'false');
  flow('reopen-current-baseline','- stopApp\n- launchApp\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 60000\n- assertNotVisible:\n    id: onboarding.step.0\n');
  assert.deepEqual(database.prepare('SELECT * FROM puppies').all(),before);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM routines').get().n,STARTER_SCHEDULE.length);
  for(const table of ['events','local_sync_owner','local_sync_outbox'])assert.equal(database.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 }finally{database.close();}
 simctl('io',udid,'screenshot',join(output,'native-init-retry.png'));
 console.log('PASS actual native inline Retry initializes schema4 once without restarting; full first-open completion and cold reopen preserve one puppy/routines/device opt-out and zero events/owner/outbox. Evidence:',output);
}finally{rmSync(fault,{force:true});}
