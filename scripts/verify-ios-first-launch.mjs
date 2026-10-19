// Full local first-open journey through the installed app. Failure injection
// uses the real SQLite write boundary; no fake completion or account service.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const udid=process.argv[2],app='com.patrickchin.puptime';
assert.equal(process.argv[3],'--replace-synthetic');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage ae0c '),'Use this worktree’s dedicated device.');
try{simctl('terminate',udid,app);}catch{}
const output=mkdtempSync(join(tmpdir(),'puptime-first-launch-native-'));
const directory=()=>join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
if(existsSync(directory())){
 const previous=new DatabaseSync(join(directory(),'puptime-v2.db'),{readOnly:true});
 try{assert.equal(previous.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Preserve owned history.');}finally{previous.close();}
 cpSync(directory(),join(output,'previous-synthetic-sqlite'),{recursive:true});
}
function run(name,file){
 // A fresh XCTest session can background the app. Activate after its startup,
 // without restarting the app or losing an uncommitted profile/ready state.
 const wrapper=join(output,name+'-active.yaml');
 writeFileSync(wrapper,'appId: '+app+'\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- waitForAnimationToEnd\n- runFlow: '+JSON.stringify(resolve(file))+'\n');
 execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',wrapper,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
}
function flow(name,body){const file=join(output,name+'.yaml');writeFileSync(file,'appId: '+app+'\n---\n'+body);run(name,file);}
run('profile-prepare',resolve('.maestro/native/ios-first-launch-profile-prepare.yaml'));
const sql=new DatabaseSync(join(directory(),'puptime-v2.db'));sql.exec('PRAGMA busy_timeout=5000');
const tables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'];
const snapshot=()=>Object.fromEntries(tables.map(table=>[table,sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
const flag=key=>sql.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
try{
 const initial=snapshot(),petId=initial.puppies[0].id;
 assert.equal(initial.puppies.length,1);assert.equal(initial.events.length,0);assert.equal(flag('first_launch_step'),'profile');
 sql.exec("CREATE TRIGGER fail_first_profile BEFORE UPDATE OF value ON metadata WHEN OLD.key='first_launch_step' BEGIN SELECT RAISE(ABORT,'injected profile checkpoint failure'); END;");
 flow('profile-failure',`- scrollUntilVisible:\n    element:\n      id: setup.profile.next\n    direction: DOWN\n- tapOn:\n    id: setup.profile.next\n- assertVisible:\n    id: setup.error\n- assertVisible:\n    id: setup.profile.input\n    text: Biscuit\n- takeScreenshot: first-open-profile-retry\n`);
 assert.deepEqual(snapshot(),initial,'Profile/checkpoint/revision changes roll back together.');
 sql.exec('DROP TRIGGER fail_first_profile');
 flow('profile-save',`- tapOn:\n    id: setup.profile.next\n- extendedWaitUntil:\n    visible:\n      id: setup.step.account\n    timeout: 15000\n- takeScreenshot: first-open-account-choice\n`);
 assert.equal(sql.prepare('SELECT name FROM puppies WHERE id=?').get(petId).name,'Biscuit');
 assert.equal(flag('first_launch_step'),'account');assert.equal(sql.prepare('SELECT COUNT(*) n FROM puppies').get().n,1);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM local_revisions').get().n,1);
 flow('committed-restart',`- stopApp\n- launchApp\n- extendedWaitUntil:\n    visible:\n      id: setup.step.account\n    timeout: 90000\n`);
 assert.equal(sql.prepare('SELECT id FROM puppies').get().id,petId);
 console.log('PASS full welcome/profile UI: injected write failure retains Biscuit draft and exact SQL; successful profile/checkpoint survives restart with one puppy and one revision.');
 const beforePractice=snapshot();
 run('local-practice',resolve('.maestro/native/ios-first-launch-local-walkthrough.yaml'));
 const afterPractice=snapshot();
 for(const table of tables.filter(table=>table!=='metadata'))assert.deepEqual(afterPractice[table],beforePractice[table],table+': practice and local/permission choices must not change real data.');
 assert.equal(flag('first_launch_step'),'reminders');assert.equal(flag('notify_on_device'),'false');assert.equal(flag('show_onboarding'),'true');
 console.log('PASS optional account route and three embedded practice steps reach contextual reminders/ready; no real event, rule, revision, account owner or pending upload is created.');
 const beforeCompletion=snapshot();
 sql.exec("CREATE TRIGGER fail_first_completion BEFORE UPDATE OF value ON metadata WHEN OLD.key='show_onboarding' BEGIN SELECT RAISE(ABORT,'injected completion failure'); END;");
 flow('completion-failure',`- scrollUntilVisible:\n    element:\n      id: setup.finish\n    direction: DOWN\n- tapOn:\n    id: setup.finish\n- tapOn: OK\n- assertVisible:\n    id: setup.step.ready\n`);
 assert.deepEqual(snapshot(),beforeCompletion,'Failed final completion preserves every saved table.');
 sql.exec('DROP TRIGGER fail_first_completion');
 flow('completion-retry',`- assertVisible:\n    id: setup.step.ready\n- scrollUntilVisible:\n    element:\n      id: setup.finish\n    direction: DOWN\n    visibilityPercentage: 100\n- waitForAnimationToEnd\n- tapOn:\n    id: setup.finish\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 15000\n`);
 assert.equal(flag('first_launch_step'),'done');assert.equal(flag('show_onboarding'),'false');assert.equal(flag('notify_on_device'),'false');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM events').get().n,0);
 flow('first-real-log',`- tapOn:\n    id: quick.pee\n- assertVisible:\n    id: event.pee.edit\n`);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM events').get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM puppies').get().n,1);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM local_sync_outbox').get().n,0);
 console.log('PASS final completion failure/retry is atomic, then the first actual quick log creates exactly one real event, with no account or cloud work.');
 const beforeReplay=snapshot();
 flow('separate-replay',`- tapOn:\n    id: settings.open\n- scrollUntilVisible:\n    element:\n      id: settings.guide.open\n    direction: UP\n- tapOn:\n    id: settings.guide.open\n- assertVisible:\n    id: onboarding.step.0\n- tapOn:\n    id: onboarding.skip\n- assertVisible:\n    id: screen.settings\n`);
 assert.deepEqual(snapshot(),beforeReplay,'Standalone walkthrough replay never repeats setup writes.');
 simctl('terminate',udid,app);sql.prepare("UPDATE metadata SET value='corrupt' WHERE key='first_launch_step'").run();
 const corrupt=snapshot();
 flow('startup-read-failure',`- launchApp\n- extendedWaitUntil:\n    visible:\n      id: setup.loadError\n    timeout: 90000\n- assertNotVisible:\n    id: screen.today\n- takeScreenshot: first-open-load-retry\n`);
 assert.deepEqual(snapshot(),corrupt,'Startup failure must preserve the unreadable data.');
 sql.prepare("UPDATE metadata SET value='done' WHERE key='first_launch_step'").run();
 flow('startup-retry',`- tapOn:\n    id: setup.retry\n- extendedWaitUntil:\n    visible:\n      id: screen.today\n    timeout: 15000\n- assertVisible:\n    id: event.pee.edit\n`);
 assert.deepEqual(snapshot(),beforeReplay);
 console.log('PASS standalone replay preserves every table; contradictory setup state shows inline retry and preserves history, and repair/retry reopens the same populated journal.');
 console.log('Full local first-launch evidence and synthetic recovery backup:',output);
}finally{
 sql.exec('DROP TRIGGER IF EXISTS fail_first_profile;DROP TRIGGER IF EXISTS fail_first_completion');sql.close();
}
