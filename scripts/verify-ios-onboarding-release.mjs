// Preserve a completed populated installation, then test a separate first-run
// fixture with the same standalone Release. Cloud is intentionally gated in
// this build; this does not qualify provider sign-in in a distributed app.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const udid=process.argv[2],app='com.patrickchin.puptime';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '));
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-release-'));
const flow=file=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',resolve('.maestro/native',file),'--test-output-dir',join(output,file)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
try{simctl('terminate',udid,app);}catch{}
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
function snapshot(){
  const path=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db');
  const database=new DatabaseSync(path,{readOnly:true});
  try{
    const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return Object.fromEntries(tables.map(({name})=>[name,database.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));
  }finally{database.close();}
}
const before=snapshot();
assert.equal(before.metadata.find(row=>row.key==='show_onboarding').value,'false');assert.ok(before.events.length>=1000);
simctl('install',udid,'/tmp/puptime-native-storage-release-derived/Build/Products/Release-iphonesimulator/Puptime.app');
flow('ios-onboarding-completed-upgrade.yaml');
assert.deepEqual(snapshot(),before,'Installing the Release update must preserve all local tables and completion state.');
console.log('PASS standalone Release upgrade preserves the completed populated installation, identity, preferences, revisions and sync metadata exactly; no forced onboarding.');
execFileSync(process.execPath,['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',resolve('scripts/verify-ios-onboarding.mjs'),udid],{stdio:'inherit'});
console.log('PASS standalone Release first-run practice, explicit puppy name and cold restart; exact SQL checks reject sample history writes.');
flow('ios-puppy-name.yaml');
const after=snapshot();
assert.equal(after.events.length,0);assert.equal(after.puppies[0].name,'Mochi');
console.log('PASS standalone Release Settings rename survives restart and Cancel preserves the committed name.');
console.log('Release evidence and synthetic recovery backup:',output);
