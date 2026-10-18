// Check the actual unscrolled feedback bounds against the fixed primary action.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const udid=process.argv[2],maestro=process.env.MAESTRO_BIN??'maestro';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8'}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.equal(devices.find(device=>device.udid===udid)?.name,'Puptime Native Storage ae0c Onboarding Small');
const output=mkdtempSync(join(tmpdir(),'puptime-onboarding-compact-'));
simctl('ui',udid,'content_size','large');
execFileSync(maestro,['--device',udid,'test',resolve('.maestro/native/ios-onboarding-compact-inspect.yaml'),'--test-output-dir',output],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
const raw=execFileSync(maestro,['--device',udid,'hierarchy','--no-ansi'],{encoding:'utf8',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
writeFileSync(join(output,'hierarchy.json'),raw);
const nodes=[];
function collect(node,ancestors=[]){if(node.attributes)nodes.push({...node.attributes,ancestors});for(const child of node.children??[])collect(child,[...ancestors,node.attributes]);}
collect(JSON.parse(raw));
const rectangle=node=>{
  const values=node.bounds.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return {left:values[0],top:values[1],right:values[2],bottom:values[3]};
};
const node=nodes.find(node=>node['resource-id']==='onboarding.demo.row');assert.ok(node);
const feedback=rectangle(node);
const parents=node.ancestors.filter(node=>node?.bounds).map(rectangle).filter(rect=>rect.right>rect.left&&rect.bottom>rect.top);
const viewport={left:Math.max(...parents.map(rect=>rect.left)),top:Math.max(...parents.map(rect=>rect.top)),right:Math.min(...parents.map(rect=>rect.right)),bottom:Math.min(...parents.map(rect=>rect.bottom))};
assert.ok(feedback.left>=viewport.left&&feedback.top>=viewport.top&&feedback.right<=viewport.right&&feedback.bottom<=viewport.bottom,'Practice feedback must fit completely within its actual scroll viewport without extra scrolling.');
console.log('PASS actual unscrolled small-iPhone practice feedback fits its viewport:',{feedback,viewport});
console.log('Compact native evidence:',output);
