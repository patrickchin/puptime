import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

const device=process.argv[2],output=resolve(process.argv[3]??'output/multi-pet-audit/row-check');
assert.ok(device,'Pass a dedicated emulator serial with the render-probe bundle installed.');
const adb=(...args)=>execFileSync('adb',['-s',device,...args],{encoding:'utf8'}).trim();
assert.match(adb('emu','avd','name'),/^Puptime_Multi_Pet_622c\b/,'Only use this worktree’s synthetic emulator.');
mkdirSync(output,{recursive:true});
function hierarchy(){adb('shell','uiautomator','dump','/sdcard/puptime-622c.xml');return adb('shell','cat','/sdcard/puptime-622c.xml');}
function node(id){
  for(let attempt=0;attempt<10;attempt++){
    const xml=hierarchy(),node=[...xml.matchAll(/<node\b[^>]*>/g)].find(match=>match[0].includes(`resource-id="${id}"`))?.[0];
    if(node)return node;
  }
  assert.fail('Missing visible control: '+id);
}
function tap(id){const bounds=node(id).match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);adb('shell','input','tap',String((bounds[0]+bounds[2])/2),String((bounds[1]+bounds[3])/2));}
function reveal(id){
  for(let attempt=0;attempt<10;attempt++){
    const xml=hierarchy(),match=[...xml.matchAll(/<node\b[^>]*>/g)].find(match=>match[0].includes(`resource-id="${id}"`))?.[0];
    const bounds=match?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);
    if(bounds&&bounds[2]>bounds[0]&&bounds[3]>bounds[1])return;
    const [width,height]=adb('shell','wm','size').match(/(\d+)x(\d+)/g).at(-1).split('x').map(Number);
    adb('shell','input','swipe',String(width/2),String(height*0.8),String(width/2),String(height*0.35),'350');
  }
  assert.fail('Could not scroll to '+id);
}
function counts(){return JSON.parse(adb('shell','su','0','cat','/data/user/0/com.patrickchin.puptime/files/multi-pet-row-renders.json'));}
adb('shell','am','force-stop','com.patrickchin.puptime');adb('shell','am','start','-n','com.patrickchin.puptime/.MainActivity');
reveal('preview.event.pet_preview_0.evt_preview_0_recent');
const before=counts();assert.ok(Object.keys(before).length>=10,'Use populated history, not an empty screen.');
tap('preview.event.pet_preview_0.evt_preview_0_recent');node('preview.editor.note');
assert.deepEqual(counts(),before,'Opening the detail must not redraw unchanged history rows.');
tap('preview.editor.note');adb('shell','input','keycombination','113','29');adb('shell','input','keyevent','67');
assert.match(node('preview.editor.note'),/text=""/,'Clear the existing note before typing.');
const note='At the garden door with a friend. Waited quietly outside and came back in for breakfast.';
// Pace native key injection so a busy emulator can deliver every edit to React.
for(const character of note){adb('shell','input','text',character===' '?'%s':character);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60);}
assert.ok(node('preview.editor.note').includes(`text="${note}"`),'All entered note text must reach the editor.');
node('preview.editor.save');
writeFileSync(join(output,'populated-history-editor.png'),execFileSync('adb',['-s',device,'exec-out','screencap','-p']));
assert.deepEqual(counts(),before,'Typing in the editor must not redraw history rows.');
tap('preview.editor.save');reveal('preview.event.pet_preview_0.evt_preview_0_recent');
const savedHierarchy=hierarchy();assert.match(savedHierarchy,/At the garden door with a friend/);assert.match(savedHierarchy,/came back in for breakfast/);
writeFileSync(join(output,'populated-history-saved.png'),execFileSync('adb',['-s',device,'exec-out','screencap','-p']));
const after=counts(),edited='pet_preview_0:evt_preview_0_recent';
assert.equal(after[edited],before[edited]+1,'Only the edited row should redraw after saving.');
for(const key of Object.keys(before).filter(key=>key!==edited))assert.equal(after[key],before[key],key+' unnecessarily redrew');
writeFileSync(join(output,'result.json'),JSON.stringify({observedRows:Object.keys(before).length,before,after,passed:true},null,2));
console.log('PASS: open and type redraw zero rows; save redraws exactly the edited row.');
