// Keep the normal-text primary action anchored so a repeated Next tap cannot hit Back.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const udid=process.argv[2],maestro=process.env.MAESTRO_BIN??'maestro';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8'}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.equal(devices.find(device=>device.udid===udid)?.name,'Puptime Native Storage ae0c Onboarding Small');
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-navigation-'));
const flow=(file,step)=>execFileSync(maestro,['--device',udid,'test','-e',`NEXT_STEP=${step}`,resolve('.maestro/native',file),'--test-output-dir',join(output,String(step))],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
const oldSize=simctl('ui',udid,'content_size');
try{
  simctl('ui',udid,'content_size','large');
  flow('ios-onboarding-practice-prepare.yaml',0);
  const frames=[];
  for(let step=0;step<4;step++){
    if(step)flow('ios-onboarding-next-step.yaml',step);
    const raw=execFileSync(maestro,['--device',udid,'hierarchy','--no-ansi'],{encoding:'utf8',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
    writeFileSync(join(output,`step-${step}.json`),raw);
    let frame;
    function collect(node){if(node.attributes?.['resource-id']==='onboarding.primary')frame=node.attributes.bounds;for(const child of node.children??[])collect(child);}
    collect(JSON.parse(raw));assert.ok(frame);frames.push(frame);
  }
  console.log('Actual primary action frames:',frames);
  assert.ok(frames.every(frame=>frame===frames[0]),'The primary action must stay in the same position across all four normal-text steps.');
  console.log('PASS primary action stays anchored through all four steps, before any keyboard request.');
  console.log('Native navigation evidence:',output);
}finally{simctl('ui',udid,'content_size',oldSize);}
