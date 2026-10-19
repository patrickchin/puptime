// Actual iOS Reduce Motion, an existing completed synthetic journal, and both drawers.
// No clearState, preference injection, app-data writes, or account-owned fixtures.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const udid=process.argv[2],app='com.patrickchin.puptime',maestro=process.env.MAESTRO_BIN??'maestro';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
const device=devices.find(candidate=>candidate.udid===udid);
assert.ok(device?.name.startsWith('Puptime Native Storage ae0c side-navigation'),'Use the dedicated side-navigation task simulator.');
assert.equal(device.state,'Booted','Boot the dedicated task simulator before qualification.');
const output=mkdtempSync(join(tmpdir(),'puptime-navigation-motion-'));
const env={...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'};
const flow=(file,phase,values={})=>execFileSync(maestro,['--device',udid,'test',...Object.entries(values).flatMap(([key,value])=>['-e',`${key}=${value}`]),file,'--test-output-dir',join(output,phase)],{stdio:'inherit',env});
try{simctl('terminate',udid,app);}catch(error){if(!String(error.stderr??'').includes('found nothing to terminate'))throw error;}
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
const sql=new DatabaseSync(join(directory,'puptime-v2.db'),{readOnly:true});
const snapshot=()=>{
 sql.exec('BEGIN');
 try{return Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,sql.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all().map(row=>({...row}))]));}
 finally{sql.exec('COMMIT');}
};
let initial,original,switchPoint;
try{
 initial=snapshot();
 assert.equal(initial.local_sync_owner.length,0,'Preserve account-owned history; use the unowned completed synthetic journal.');
 assert.ok(initial.puppies.length>=1,'Use an existing completed puppy profile.');
 cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
 const inspect=join(output,'inspect-motion.yaml');
 writeFileSync(inspect,`appId: com.apple.Preferences\nname: Inspect the actual iOS Reduce Motion preference\n---\n- launchApp\n- runFlow:\n    when:\n      notVisible:\n        id: REDUCE_MOTION\n    commands:\n      - scrollUntilVisible:\n          element:\n            text: ^Accessibility$\n          direction: DOWN\n          visibilityPercentage: 100\n          centerElement: false\n      - tapOn: ^Accessibility$\n      - scrollUntilVisible:\n          element:\n            text: ^Motion$\n          direction: DOWN\n          visibilityPercentage: 100\n          centerElement: false\n      - tapOn: ^Motion$\n- assertVisible:\n    id: REDUCE_MOTION\n- takeScreenshot: native-navigation-motion-original\n`);
 flow(inspect,'inspect');
 const hierarchy=JSON.parse(execFileSync(maestro,['--device',udid,'hierarchy','--no-ansi'],{encoding:'utf8',env}));
 let screen,row;
 function visit(node){
  const attributes=node.attributes,bounds=attributes?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
  if(bounds&&bounds[0]===0&&bounds[1]===0&&bounds[2]>0&&bounds[3]>0&&!screen)screen=bounds;
  if(attributes?.['resource-id']==='REDUCE_MOTION'&&['0','1'].includes(attributes.value)){assert.equal(row,undefined,'One actual Reduce Motion row is required.');row=bounds;original=attributes.value;}
  for(const child of node.children??[])visit(child);
 }
 visit(hierarchy);assert.ok(screen&&row&&row[2]-row[0]>70&&original!==undefined,'Read the native switch value and bounds before changing it.');
 // The resource ID spans the label and switch; use the inspected trailing switch.
 switchPoint=`${Math.round((row[2]-30)/screen[2]*100)}%,${Math.round((row[1]+row[3])/2/screen[3]*100)}%`;
 for(const [phase,value] of [['off','0'],['on','1']]){
  console.log('> Flow actual native drawer Reduce Motion:',phase);
  setMotion(value,`set-${phase}`);
  flow(resolve('.maestro/native/ios-navigation-motion.yaml'),`drawer-${phase}`,{MOTION_VALUE:value});
  assert.deepEqual(snapshot(),initial,'Drawer close, backdrop, and navigation must preserve every SQL table.');
  console.log('PASS actual OS Reduce Motion',phase,': drawer implementation marker, close/backdrop/selection, and every unchanged SQL table.');
 }
 console.log('Native navigation motion evidence and recovery backup:',output);
}finally{
 try{
  if(original!==undefined&&switchPoint){setMotion(original,'restore');console.log('PASS original native Reduce Motion restored:',original==='1'?'On':'Off');simctl('launch',udid,app);}
  if(initial)assert.deepEqual(snapshot(),initial,'OS setting restoration must preserve every app SQL table.');
 }finally{sql.close();}
}

function setMotion(value,phase){
 assert.ok(['0','1'].includes(value)&&switchPoint);
 const file=join(output,`${phase}.yaml`);
 writeFileSync(file,`appId: com.apple.Preferences\nname: Set and read back the actual iOS Reduce Motion preference\n---\n- launchApp:\n    stopApp: false\n- assertVisible:\n    id: REDUCE_MOTION\n- runFlow:\n    when:\n      visible:\n        id: REDUCE_MOTION\n        text: ^${value==='1'?'0':'1'}$\n    commands:\n      - tapOn:\n          point: ${switchPoint}\n- assertVisible:\n    id: REDUCE_MOTION\n    text: ^${value}$\n- takeScreenshot: native-navigation-motion-${phase}\n`);
 flow(file,phase);
}
