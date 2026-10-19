// Actual rendered heading legibility on the dedicated iPhone17 fixture.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const udid=process.argv[2],size=process.argv[3]??'large',app='com.patrickchin.puptime';
assert.ok(['large','accessibility-extra-extra-extra-large'].includes(size));
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8'}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(device=>device.udid===udid);
assert.ok(device?.name.startsWith('Puptime Native Storage '));
assert.equal(device.deviceTypeIdentifier,'com.apple.CoreSimulator.SimDeviceType.iPhone-17');
const output=mkdtempSync(join(tmpdir(),'puptime-timeline-heading-')),flow=join(output,'heading.yaml');
writeFileSync(flow,'appId: '+app+'\n---\n- launchApp\n- extendedWaitUntil:\n    visible:\n      id: event.pee.edit\n    timeout: 30000\n- tapOn:\n    id: nav.open\n- tapOn:\n    id: nav.timeline\n    retryTapIfNoChange: true\n- extendedWaitUntil:\n    visible:\n      id: timeline.range\n    timeout: 30000\n- extendedWaitUntil:\n    notVisible:\n      id: activity.loading\n    timeout: 30000\n');
simctl('ui',udid,'appearance','light');simctl('ui',udid,'content_size',size);
execFileSync('maestro',['--device',udid,'test',flow,'--test-output-dir',join(output,'ui')],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
const screenshot=join(output,'timeline-heading.png');simctl('io',udid,'screenshot',screenshot);
execFileSync(process.env.PUPTIME_REVIEW_PYTHON??'python3',['-c',[
 'from PIL import Image',
 'import sys',
 'image=Image.open(sys.argv[1]).convert("RGB")',
 'assert image.width==1206, "Use the named iPhone17 fixture"',
 'crop=image.crop((48,192,666,372))',
 'mask=Image.new("L",crop.size)',
 'mask.putdata([255 if r<90 and g<110 and b<100 else 0 for r,g,b in crop.getdata()])',
 'bounds=mask.getbbox()',
 'height=0 if bounds is None else bounds[3]-bounds[1]',
 'print("Actual native heading ink height:",height,"pixels")',
 'assert height>=42, "Timeline heading must remain legible, rather than shrink to a few pixels"',
 'print("PASS actual rendered Timeline heading remains legible at the requested text size.")',
].join('\n'),screenshot],{stdio:'inherit'});
if(size!=='large'){
 const checks=join(output,'accessibility-layout.yaml');
 writeFileSync(checks,'appId: '+app+'\n---\n- assertVisible:\n    id: timeline.mark.point.*\n- setOrientation: LANDSCAPE_LEFT\n- waitForAnimationToEnd:\n    timeout: 5000\n- repeat:\n    times: 6\n    commands:\n      - swipe:\n          start: 70%,72%\n          end: 70%,55%\n          duration: 400\n- assertVisible:\n    id: timeline.mark.point.*\n- tapOn:\n    id: timeline.zoom.in\n    retryTapIfNoChange: true\n- assertVisible:\n    id: timeline.zoom.value\n    text: .*1.5×\n- takeScreenshot: timeline-largest-landscape\n- setOrientation: PORTRAIT\n');
 try{execFileSync('maestro',['--device',udid,'test',checks,'--test-output-dir',join(output,'accessibility-layout')],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});}
 finally{
  const restore=join(output,'restore.yaml');writeFileSync(restore,'appId: '+app+'\n---\n- setOrientation: PORTRAIT\n');
  execFileSync('maestro',['--device',udid,'test',restore,'--test-output-dir',join(output,'restore')],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
  simctl('ui',udid,'content_size','large');
 }
}
console.log('Native screenshot and visual evidence:',output);
