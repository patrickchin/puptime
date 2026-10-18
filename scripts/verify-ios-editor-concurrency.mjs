// Native editing qualification on a disposable simulator. Independent SQLite
// writes stand in for committed remote projection; this is not an HTTP test.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const udid=process.argv[2],app='com.patrickchin.puptime';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8'}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.ok(devices.find(device=>device.udid===udid)?.name.startsWith('Puptime Native Storage '),'Use a dedicated synthetic storage simulator.');
const output=mkdtempSync(join(tmpdir(),'puptime-editor-concurrency-'));
const flow=(file)=>execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',resolve('.maestro/native',file),'--test-output-dir',join(output,file)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
flow('ios-editor-concurrency-before.yaml');
const database=new DatabaseSync(join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite/puptime-v2.db'));
database.exec('PRAGMA busy_timeout=5000');
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail('Native SQLite save did not reach the expected state.');}
try {
 await waitFor(()=>database.prepare('SELECT note FROM events').get()?.note==='local first');
 const row=database.prepare('SELECT pet_id,id,at FROM events').get();
 assert.equal(database.prepare('SELECT count(*) AS n FROM events').get().n,1,'The flow must prepare its own disposable single event.');
 const remoteAt=row.at-60000;
 database.prepare('UPDATE events SET at=? WHERE pet_id=? AND id=?').run(remoteAt,row.pet_id,row.id);
 flow('ios-editor-concurrency-after.yaml');
 await waitFor(()=>database.prepare('SELECT note FROM events WHERE pet_id=? AND id=?').get(row.pet_id,row.id).note==='local second');
 assert.equal(database.prepare('SELECT at FROM events WHERE pet_id=? AND id=?').get(row.pet_id,row.id).at,remoteAt,'Editing the note must preserve the independent committed timestamp.');
 console.log('PASS installed iOS editor preserves an independent timestamp during note autosave.');
 database.prepare('DELETE FROM events WHERE pet_id=? AND id=?').run(row.pet_id,row.id);
 flow('ios-editor-deletion.yaml');
 assert.equal(database.prepare('SELECT count(*) AS n FROM events').get().n,0,'A deleted event must not be recreated by an open draft.');
 console.log('PASS installed iOS editor reports deletion, keeps the draft and allows explicit discard; no false save or resurrection.');
 console.log('Native evidence:',output);
} finally {database.close();}
