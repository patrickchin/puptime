// Actual small/standard native layouts; preserve prior synthetic data first.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
const udid=process.argv[2],app='com.patrickchin.puptime';assert.equal(process.argv[3],'--replace-synthetic');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8'}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(device=>device.udid===udid);
assert.ok(device?.name.startsWith('Puptime Native Storage '));
const output=mkdtempSync(join(tmpdir(),'puptime-timeline-accessibility-')),directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
try{simctl('terminate',udid,app);}catch{}
if(existsSync(join(directory,'puptime-v2.db'))){
 const database=new DatabaseSync(join(directory,'puptime-v2.db'),{readOnly:true});
 try{assert.equal(database.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Do not reset an owned account fixture.');}finally{database.close();}
 cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
}
const oldSize=simctl('ui',udid,'content_size'),oldAppearance=simctl('ui',udid,'appearance');
const prepare=join(output,'prepare.yaml');writeFileSync(prepare,'appId: '+app+'\n---\n- setOrientation: PORTRAIT\n- launchApp:\n    clearState: true\n');
function run(file,name){execFileSync('maestro',['--device',udid,'test',file,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});}
try{
 simctl('ui',udid,'content_size','accessibility-extra-extra-extra-large');
 for(const appearance of ['light','dark']){
  simctl('ui',udid,'appearance',appearance);run(prepare,appearance+'-prepare');
  run(resolve('.maestro/native/ios-timeline-accessibility.yaml'),appearance);
 }
 console.log('PASS actual maximum-text portrait/landscape chart marks and zoom in light/dark on '+device.name+'. Native screenshots:',output);
}finally{
 simctl('ui',udid,'content_size',oldSize);simctl('ui',udid,'appearance',oldAppearance);
 const restore=join(output,'restore.yaml');writeFileSync(restore,'appId: '+app+'\n---\n- setOrientation: PORTRAIT\n');run(restore,'restore');
}
