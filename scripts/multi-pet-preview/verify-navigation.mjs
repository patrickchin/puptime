// Native integration check for the standalone preview; production data must stay untouched.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {csvToEvents} from '../../src/export.ts';

const device=process.argv[2],app='com.patrickchin.puptime',output=resolve(process.argv[3]??'output/navigation-151/preview');
assert.ok(device,'Pass a dedicated emulator with the preview installed.');
const adb=(...args)=>execFileSync('adb',['-s',device,...args],{stdio:['ignore','pipe','pipe']});
assert.match(adb('emu','avd','name').toString(),/^Puptime_(Multi_Pet_622c|Navigation_d859|History_Spacing_d859)\b/);
mkdirSync(output,{recursive:true});
function snapshot(){return Object.fromEntries(['','-wal'].flatMap(suffix=>{
  try{return [[suffix,createHash('sha256').update(adb('exec-out','run-as',app,'cat',`files/SQLite/puptime-v2.db${suffix}`)).digest('hex')]];}
  catch{return [];}
}));}
function flow(name,commands){
  const file=join(output,name+'.yaml');writeFileSync(file,`appId: ${app}\n---\n${commands}\n`);
  execFileSync('maestro',['--device',device,'test',file,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
}
function exported(pet){
  const name=adb('shell','run-as',app,'ls','cache').toString().split(/\s+/).find(name=>/^puptime-activity-.*\.csv$/.test(name));assert.ok(name);
  const events=csvToEvents(adb('exec-out','run-as',app,'cat',`cache/${name}`).toString());
  assert.ok(events.length>100);assert.ok(events.every(event=>event.id.startsWith(`evt_preview_${pet}_`)),'Export must contain only the chosen sample pet, never the production journal.');
  return events.length;
}
const before=snapshot();
flow('maple',`- launchApp
- assertVisible: {id: nav.title, text: Log}
- assertNotVisible: Puptime
- assertNotVisible: {id: settings.open}
- takeScreenshot: preview-log
- tapOn: {id: nav.switch}
- assertVisible: {id: nav.title, text: Timeline}
- tapOn: {id: preview.scope}
- tapOn: {id: preview.select.pet_preview_1}
- assertVisible: {id: preview.scope, text: .*Maple.*}
- assertNotVisible: {id: timeline.range}
- assertNotVisible: {id: timeline.zoom.value}
- takeScreenshot: preview-timeline-maple
- tapOn: {id: nav.switch}
- assertVisible: {id: preview.quick.pet_preview_0.pee}
- assertVisible: {id: preview.quick.pet_preview_1.pee}
- tapOn: {id: nav.switch}
- assertVisible: {id: preview.scope, text: .*Maple.*}
- tapOn: {id: nav.open}
- tapOn: {id: nav.insights}
- assertVisible: {id: nav.title, text: Insights}
- assertNotVisible: {id: insights.export}
- takeScreenshot: preview-insights
- tapOn: {id: nav.open}
- tapOn: {id: nav.settings}
- scrollUntilVisible:
    element: {id: preview.data.pet}
    direction: DOWN
    centerElement: true
- assertVisible: {id: preview.data.pet, text: .*Maple.*}
- scrollUntilVisible:
    element: {id: settings.export}
    direction: DOWN
    centerElement: true
- takeScreenshot: preview-settings-maple
- tapOn: {id: settings.export}
- extendedWaitUntil:
    visible: .*CSV.*
    timeout: 30000`);
const maple=exported(1);
flow('mochi',`- pressKey: Back
- scrollUntilVisible:
    element: {id: preview.data.pet}
    direction: UP
- tapOn: {id: preview.data.pet}
- tapOn: {id: preview.select.pet_preview_0}
- assertVisible: {id: preview.data.pet, text: .*Mochi.*}
- tapOn: {id: settings.export}
- extendedWaitUntil:
    visible: .*CSV.*
    timeout: 30000`);
const mochi=exported(0);assert.ok(mochi>maple);
flow('back',`- pressKey: Back
- tapOn: {id: settings.import}
- assertVisible: Import for Mochi
- tapOn: OK
- tapOn: {id: settings.back}
- assertVisible: {id: nav.title, text: Insights}
- tapOn: {id: nav.open}
- tapOn: {id: nav.timeline}
- tapOn: {id: timeline.filter.poop-meal}
- tapOn: {id: timeline.windows.edit}
- assertVisible: {id: nav.title, text: Schedule}
- takeScreenshot: preview-schedule
- pressKey: Back
- assertVisible: {id: nav.title, text: Timeline}
- tapOn: {id: nav.open}
- tapOn: {id: nav.settings}
- scrollUntilVisible:
    element: {id: preview.notifications}
    direction: DOWN
- tapOn: {id: preview.notifications}
- assertVisible: {id: nav.title, text: Notifications}
- takeScreenshot: preview-notifications
- tapOn: {id: nav.back}
- assertVisible: {id: nav.title, text: Settings}
- tapOn: {id: settings.back}
- assertVisible: {id: nav.title, text: Timeline}
- tapOn: {id: nav.open}
- tapOn: {id: nav.log}
- tapOn: {id: nav.open}
- tapOn: {id: nav.settings}
- scrollUntilVisible:
    element: {id: preview.data.pet}
    direction: DOWN
- tapOn: {id: preview.data.pet}
- tapOn: {id: preview.select.pet_preview_1}
- assertVisible: {id: preview.data.pet, text: .*Maple.*}
- tapOn: {id: settings.back}
- assertVisible: {id: preview.filter, text: .*All pets.*}
- tapOn: {id: nav.switch}
- assertVisible: {id: preview.scope, text: .*Maple.*}
- tapOn: {id: nav.open}
- tapOn: {id: nav.learn}
- assertVisible: {id: nav.title, text: Puppy care}
- takeScreenshot: preview-care`);
assert.deepEqual(snapshot(),before,'The sample preview must not change the saved production journal.');
writeFileSync(join(output,'result.json'),JSON.stringify({maple,mochi,productionSqliteFiles:Object.keys(before),productionSqliteUnchanged:true},null,2));
console.log(`PASS preview navigation, scoped exports (${maple} Maple/${mochi} Mochi), sample import, contextual Back, and unchanged production SQLite.`);
