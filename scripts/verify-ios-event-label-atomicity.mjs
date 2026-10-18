// Actual mounted App save path. A second SQLite writer represents deletion;
// this is not HTTP delivery. Only the dedicated unowned synthetic fixture resets.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const udid=process.argv[2],app='com.patrickchin.puptime';
assert.equal(process.argv[3],'--replace-synthetic');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '));
try{simctl('terminate',udid,app);}catch{}
const output=mkdtempSync(join(tmpdir(),'puptime-event-label-atomicity-'));
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
const old=new DatabaseSync(join(directory,'puptime-v2.db'),{readOnly:true});
try{assert.equal(old.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Preserve owned history.');}finally{old.close();}
cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
function flow(name,body){
 const path=join(output,name+'.yaml');writeFileSync(path,'appId: '+app+'\n---\n'+body);
 execFileSync('maestro',['--device',udid,'test',path,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
}
flow('prepare-custom-draft',`
- launchApp:
    clearState: true
- tapOn:
    id: onboarding.skip
- tapOn:
    id: quick.pee
- extendedWaitUntil:
    notVisible:
      id: toast
    timeout: 10000
- tapOn:
    id: event.pee.edit
- scrollUntilVisible:
    element:
      id: editor.type.custom
    direction: UP
- tapOn:
    id: editor.type.custom
- tapOn:
    id: editor.custom.input
- assertVisible:
    id: editor.custom.input
`);
const database=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'));
database.exec('PRAGMA busy_timeout=5000');
try{
 assert.equal(database.prepare('SELECT COUNT(*) n FROM events').get().n,1);
 database.prepare('DELETE FROM events').run();
 const snapshot=()=>Object.fromEntries(['pet_settings','local_revisions','local_sync_outbox'].map(table=>[table,database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
 const before=snapshot();
 flow('save-deleted-custom-draft',`
- setClipboard: Training
- pasteText
- extendedWaitUntil:
    visible:
      id: editor.shareDeletedDraft
    timeout: 10000
- takeScreenshot: deleted-custom-draft
`);
 assert.equal(database.prepare('SELECT COUNT(*) n FROM events').get().n,0);
 assert.deepEqual(snapshot(),before,'A rejected mounted event save must not commit its label, revisions or upload work.');
 console.log('PASS actual mounted App rejects deleted custom draft without committing labels/revisions/outbox. Native evidence:',output);
}finally{database.close();}
