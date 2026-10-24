import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

const device=process.argv[2],output=resolve(process.argv[3]??'output/multi-pet-audit/row-check');
assert.ok(device,'Pass a dedicated emulator serial with the render-probe bundle installed.');
const adb=(...args)=>execFileSync('adb',['-s',device,...args],{encoding:'utf8'}).trim();
assert.match(adb('emu','avd','name'),/^Puptime_(Multi_Pet_622c|Navigation_d859|History_Spacing_d859|UI_Hierarchy_a9f2)\b/,'Only use this worktree’s synthetic emulator.');
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
function reveal(id,direction='down'){
  for(let attempt=0;attempt<10;attempt++){
    const xml=hierarchy(),match=[...xml.matchAll(/<node\b[^>]*>/g)].find(match=>match[0].includes(`resource-id="${id}"`))?.[0];
    const bounds=match?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);
    if(bounds&&bounds[2]>bounds[0]&&bounds[3]>bounds[1])return;
    const [width,height]=adb('shell','wm','size').match(/(\d+)x(\d+)/g).at(-1).split('x').map(Number);
    adb('shell','input','swipe',String(width/2),String(height*(direction==='down'?0.8:0.25)),String(width/2),String(height*(direction==='down'?0.35:0.8)),'350');
  }
  assert.fail('Could not scroll to '+id);
}
function observation(){return JSON.parse(adb('shell','su','0','cat','/data/user/0/com.patrickchin.puptime/files/multi-pet-row-renders.json'));}
function counts(){return observation().updates;}
function unchanged(before,after,message){for(const key of Object.keys(before))assert.equal(after[key],before[key],`${message}: ${key}`);}
adb('shell','am','force-stop','com.patrickchin.puptime');adb('shell','am','start','-n','com.patrickchin.puptime/.MainActivity');
node('preview.quick.pet_preview_0.pee');
reveal('preview.event.pet_preview_0.evt_preview_0_recent');
const before=counts();assert.ok(Object.keys(before).length>=10,'Use populated history, not an empty screen.');
tap('preview.edit.pet_preview_0.evt_preview_0_recent');node('editor.type.pee');
unchanged(before,counts(),'Opening the detail must not redraw unchanged history rows');
writeFileSync(join(output,'full-editor.png'),execFileSync('adb',['-s',device,'exec-out','screencap','-p']));
reveal('editor.note.input');tap('editor.note.input');adb('shell','input','keycombination','113','29');adb('shell','input','keyevent','67');
const cleared=node('editor.note.input'),clearedText=cleared.match(/ text="([^"]*)"/)?.[1],placeholder=cleared.match(/ hint="([^"]*)"/)?.[1];
assert.ok(clearedText===''||clearedText===placeholder,'Clear the existing note before typing; Android may expose its placeholder as text.');
const note='At the garden door with a friend. Waited quietly outside and came back in for breakfast.';
// Pace native key injection so a busy emulator can deliver every edit to React.
for(const character of note){adb('shell','input','text',character===' '?'%s':character);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60);}
assert.ok(node('editor.note.input').includes(`text="${note}"`),'All entered note text must reach the editor.');
writeFileSync(join(output,'populated-history-editor.png'),execFileSync('adb',['-s',device,'exec-out','screencap','-p']));
adb('shell','input','keyevent','4');
reveal('editor.close','up');tap('editor.close');reveal('preview.event.pet_preview_0.evt_preview_0_recent');
const savedHierarchy=hierarchy();assert.match(savedHierarchy,/At the garden door with a friend/);
if(Number(adb('shell','settings','get','system','font_scale'))>=1.4)assert.match(savedHierarchy,/came back in for breakfast/);
writeFileSync(join(output,'populated-history-saved.png'),execFileSync('adb',['-s',device,'exec-out','screencap','-p']));
const after=counts(),edited='pet_preview_0:evt_preview_0_recent';
assert.ok(after[edited]>before[edited],'The edited row should update after autosaving.');
for(const key of Object.keys(before).filter(key=>key!==edited))assert.equal(after[key],before[key],key+' unnecessarily redrew');
tap('preview.delete.pet_preview_0.evt_preview_0_recent');node('confirm.dialog');
unchanged(after,counts(),'Opening delete confirmation must not redraw history');
writeFileSync(join(output,'delete-confirmation.png'),execFileSync('adb',['-s',device,'exec-out','screencap','-p']));
tap('confirm.cancel');node('preview.event.pet_preview_0.evt_preview_0_recent');
unchanged(after,counts(),'Cancelling deletion keeps history unchanged');
tap('preview.delete.pet_preview_0.evt_preview_0_recent');tap('confirm.delete');
const remaining=hierarchy();
assert.ok(!remaining.includes('resource-id="preview.event.pet_preview_0.evt_preview_0_recent"'),'Confirmed deletion removes the chosen log.');
assert.match(remaining,/resource-id="preview.edit.pet_preview_1\./,'The other pet’s history stays visible.');
const afterDelete=counts();
for(const key of Object.keys(after))assert.equal(afterDelete[key],after[key],key+' unnecessarily redrew after deletion');
writeFileSync(join(output,'result.json'),JSON.stringify({observedRows:Object.keys(before).length,before,after,afterDelete,observation:observation(),deleteConfirmationPassed:true,passed:true},null,2));
console.log('PASS: opening redraws zero rows; autosaving redraws only the edited row; delete confirmation/cancel preserve rows and confirmed deletion removes only the chosen log.');
