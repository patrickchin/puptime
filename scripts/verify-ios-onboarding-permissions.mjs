// Actual OS notification prompt choices; no APNS/physical delivery claim.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const udid=process.argv[2],app='com.patrickchin.puptime';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '),'Use the dedicated synthetic simulator.');
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-permissions-'));
try{simctl('terminate',udid,app);}catch{}
cpSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite'),join(output,'previous-synthetic-sqlite'),{recursive:true});
for(const [file,choice] of [['ios/00-onboarding.yaml','Not now'],['ios/00-onboarding-notifications.yaml','Allow'],['native/ios-onboarding-notifications-denied.yaml','Deny']]) {
  execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',resolve('.maestro',file),'--test-output-dir',join(output,choice)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
  const database=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'),{readOnly:true});
  try{
    assert.equal(database.prepare("SELECT value FROM metadata WHERE key='show_onboarding'").get().value,'false');
    assert.equal(database.prepare('SELECT name FROM puppies').get().name,'My puppy');
    assert.equal(database.prepare('SELECT count(*) n FROM events').get().n,0);
    assert.equal(database.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0);
    assert.equal(database.prepare('SELECT count(*) n FROM local_sync_outbox').get().n,0);
  }finally{database.close();}
  console.log(`PASS actual iOS notification ${choice}: first logging remains accessible, optional name defaults safely, no practice events/account enrollment/outbox; Settings checks the OS-derived permission state.`);
}
console.log('Native permission evidence and synthetic recovery backup:',output);
