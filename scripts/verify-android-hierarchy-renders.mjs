// Use the existing native-activity-probe Metro config with a disposable journal.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const device=process.argv[2],app='com.patrickchin.puptime',output=resolve(process.argv[3]??'output/ui-hierarchy-renders');
assert.ok(device,'Pass this task’s dedicated Android emulator.');
const adb=(...args)=>execFileSync('adb',['-s',device,...args],{encoding:'utf8'}).trim();
assert.match(adb('emu','avd','name'),/^Puptime_UI_Hierarchy_a9f2\b/);
mkdirSync(output,{recursive:true});
function hierarchy(){adb('shell','uiautomator','dump','/sdcard/hierarchy-renders.xml');return adb('shell','cat','/sdcard/hierarchy-renders.xml');}
function node(id){for(let i=0;i<8;i++){const found=[...hierarchy().matchAll(/<node\b[^>]*>/g)].map(match=>match[0]).find(text=>text.includes(`resource-id="${id}"`));if(found)return found;}assert.fail('Missing '+id);}
function tap(id){const bounds=node(id).match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);adb('shell','input','tap',String((bounds[0]+bounds[2])/2),String((bounds[1]+bounds[3])/2));}
const counts=()=>JSON.parse(adb('exec-out','run-as',app,'cat','files/row-render-probe.json')).renders;
const tracks=()=>JSON.parse(adb('exec-out','run-as',app,'cat','files/timeline-render-probe.json'));
const unchanged=(before,after)=>{for(const key of Object.keys(before))assert.equal(after[key],before[key],key+' unnecessarily redrew');};
adb('shell','am','force-stop',app);adb('shell','am','start','-n',app+'/.MainActivity');node('event.pee.edit');
const before=counts();assert.ok(Object.keys(before).length>20,'Use populated production history.');
tap('event.pee.edit');node('editor.note.input');unchanged(before,counts());
tap('editor.note.input');adb('shell','input','text','Hierarchy%snative%sedit');node('editor.note.input');
adb('shell','input','keyevent','4');tap('editor.close');node('event.pee.edit');
const after=counts(),changed=Object.keys(before).filter(id=>before[id]!==after[id]);assert.equal(changed.length,1,'Only the edited event may redraw.');
writeFileSync(join(output,'production-editor.png'),execFileSync('adb',['-s',device,'exec-out','screencap','-p']));
tap('nav.switch');node('timeline.filter.pee');
const xml=hierarchy(),mark=[...xml.matchAll(/resource-id="(timeline.mark.point.[^"]+)"/g)][0]?.[1];assert.ok(mark,'A populated chart must expose recorded marks.');
const chartBefore=tracks();tap(mark);node('timeline.details');const chartAfter=tracks();unchanged(chartBefore.date,chartAfter.date);
const chartChanges=Object.keys(chartBefore.track).filter(key=>chartBefore.track[key]!==chartAfter.track[key]);assert.ok(chartChanges.length<=1,'Detail state must not redraw unchanged day tracks.');
tap('timeline.details.close');node('timeline.filter.pee');unchanged(chartBefore.date,tracks().date);
writeFileSync(join(output,'result.json'),JSON.stringify({passed:true,observedRows:Object.keys(before).length,changed,chartChanges,before,after},null,2));
console.log('PASS: production editor updates one row; chart details preserve unchanged day tracks and date rows.');
