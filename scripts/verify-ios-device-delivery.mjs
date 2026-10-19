// Dedicated unowned synthetic fixture only. The opt-in Metro observer reads
// the actual iOS notification center; it never intercepts scheduling.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';
const udid=process.argv[2],app='com.patrickchin.puptime';
assert.equal(process.argv[3],'--replace-synthetic');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '));
try{simctl('terminate',udid,app);}catch{}
const output=mkdtempSync(join(tmpdir(),'puptime-device-delivery-'));
const documents=join(simctl('get_app_container',udid,app,'data'),'Documents'),directory=join(documents,'SQLite'),path=join(directory,'puptime-v2.db');
const check=new DatabaseSync(path,{readOnly:true});
try{assert.equal(check.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Preserve owned history.');}finally{check.close();}
cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
const database=await createLocalDatabase(sqliteTestConnection(path));
try{
 await database.write(async sql=>{
  await sql.runAsync("UPDATE metadata SET value='false' WHERE key='show_onboarding'");
  await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('first_launch_step','done') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 });
 const pet=await database.read(sql=>sql.getFirstAsync('SELECT id FROM puppies'));
 const {storage}=await createLocalRuntime(database,pet.id);
 await storage.saveLanguagePreference('en');await storage.saveThemePreference('system');await storage.saveNotificationDelivery(false);
 const original=(await storage.loadSchedule()).find(entry=>entry.id==='device-delivery-review');
 await storage.saveScheduleEntry({id:'device-delivery-review',type:'pee',minutes:600,reminder:true},original);
 const existing=(await storage.loadEvents()).find(event=>event.id==='device-delivery-review');
 if(existing)await storage.removeEvent(existing.id);
 await storage.appendEvents([{id:'device-delivery-review',type:'pee',at:Date.now(),source:'app'}]);
}finally{await database.close();}
const inspection=new DatabaseSync(path,{readOnly:true});inspection.exec('PRAGMA busy_timeout=5000');
const snapshot=()=>Object.fromEntries(['puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_outbox'].map(table=>[table,inspection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
const before=snapshot();
function flow(name,body){const file=join(output,name+'.yaml');writeFileSync(file,'appId: '+app+'\n---\n'+body);execFileSync('maestro',['--device',udid,'test',file,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});}
const owned=id=>id.startsWith('puptime-routine-')||id.startsWith('puptime-activity-');
async function observed(predicate){
 for(let attempt=0;attempt<40;attempt++){
  try{const value=JSON.parse(readFileSync(join(documents,'notification-delivery-probe.json'),'utf8'));if(Date.now()-value.at<4000&&predicate(value))return value;}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw new Error('Actual native notification-center observation did not match. Use the opt-in notification Metro config.');
}
try{
 execFileSync('maestro',['--device',udid,'test',resolve('.maestro/native/ios-device-delivery.yaml'),'--test-output-dir',join(output,'off')],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
 await observed(value=>!value.identifiers.some(owned));
 assert.equal(inspection.prepare("SELECT value FROM metadata WHERE key='notify_on_device'").get().value,'false');
 console.log('PASS opted-out iPhone leaves actual native reminder requests empty without requesting OS access.');
 flow('enable-device','- tapOn:\n    id: settings.notifications.deviceDelivery\n- tapOn:\n    text: \"^Allow$\"\n    optional: true\n');
 await observed(value=>value.permission.granted&&value.identifiers.includes('puptime-routine-device-delivery-review')&&value.identifiers.includes('puptime-activity-afterPee'));
 assert.equal(inspection.prepare("SELECT value FROM metadata WHERE key='notify_on_device'").get().value,'true');
 console.log('PASS explicit device opt-in schedules actual native routine and future potty requests.');
 flow('disable-device','- tapOn:\n    id: settings.notifications.deviceDelivery\n- takeScreenshot: device-delivery-disabled\n');
 await observed(value=>!value.identifiers.some(owned));
 assert.equal(inspection.prepare("SELECT value FROM metadata WHERE key='notify_on_device'").get().value,'false');
 assert.deepEqual(snapshot(),before,'A device-only delivery choice must not change synced data, revisions or ownership.');
 console.log('PASS turning device delivery off clears actual native reminder requests, preserves rules/history/revisions and leaves no account/outbox.');
 console.log('Native evidence and synthetic recovery backup:',output);
}finally{inspection.close();}
