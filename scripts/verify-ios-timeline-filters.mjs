// Run with native-activity-probe/metro.config.cjs on a dedicated simulator.
// node scripts/verify-ios-timeline-filters.mjs <udid> populated --seed
// --seed prepares only an empty, unowned fixture; omit it on subsequent runs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRepository} from '../src/local/repository.ts';
const udid=process.argv[2],app='com.patrickchin.puptime',maestro=process.env.MAESTRO_BIN??'maestro';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8'}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.match(devices.find(device=>device.udid===udid)?.name??'',/^Puptime .*Stable Timeline/);
const documents=join(simctl('get_app_container',udid,app,'data'),'Documents');
if(process.argv.includes('--seed')){
 try{simctl('terminate',udid,app);}catch{}
 mkdirSync(join(documents,'SQLite'),{recursive:true});
 const fixture=await createLocalDatabase(sqliteTestConnection(join(documents,'SQLite/puptime-v2.db')));
 try{
  const {petId}=await initializeLocalDatabase(fixture);
  assert.equal((await fixture.read(sql=>sql.getFirstAsync('SELECT count(*) n FROM local_sync_owner'))).n,0);
  assert.equal((await fixture.read(sql=>sql.getFirstAsync('SELECT count(*) n FROM events'))).n,0,'Never replace populated history.');
  const repository=createLocalRepository(fixture,petId),today=new Date();today.setHours(0,0,0,0);
  await repository.appendEvents(Array.from({length:1100},(_,index)=>{
   const date=new Date(today),day=Math.floor(index/30);date.setDate(date.getDate()-day-(day>=3?5:0));date.setMinutes(420+index%30*25);
   return {id:'evt_timeline_'+index,type:['pee','poop','meal'][index%3],at:date.getTime(),source:'app',...(index===8?{estimated:true}:{})};
  }));
  await repository.saveSchedule([{id:'rtn_timeline_meal',type:'meal',minutes:480,toleranceMinutes:30,reminder:false},{id:'rtn_timeline_poop',type:'poop',minutes:540,toleranceMinutes:30,reminder:false}]);
  await fixture.write(async sql=>{
   await sql.runAsync("UPDATE metadata SET value='false' WHERE key='show_onboarding'");
   await sql.runAsync("UPDATE metadata SET value='done' WHERE key='first_launch_step'");
   await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('qualification_fixture','timeline-filters-v1')");
  });
 }finally{await fixture.close();}
 simctl('launch',udid,app);
}
const db=new DatabaseSync(join(documents,'SQLite/puptime-v2.db'),{readOnly:true});
assert.equal(db.prepare('SELECT count(*) n FROM local_sync_owner').get().n,0);
assert.equal(db.prepare("SELECT value FROM metadata WHERE key='qualification_fixture'").get()?.value,'timeline-filters-v1');
assert.ok(db.prepare('SELECT count(*) n FROM events').get().n>=1000);
db.close();
const output=join(homedir(),'Pictures/Screenshots/Codex/puptime-stable-timeline',process.argv[3]??'populated');mkdirSync(output,{recursive:true});
const env={...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'};
function flow(name,body){
 const path=join(output,name+'.yaml');
 writeFileSync(path,`appId: ${app}\n---\n- launchApp:\n    stopApp: false\n    permissions: {}\n- waitForAnimationToEnd\n${body}`);
 execFileSync(maestro,['--device',udid,'test',path,'--test-output-dir',join(output,name)],{stdio:'inherit',env});
}
function snapshot(name){
 const tree=JSON.parse(execFileSync(maestro,['--device',udid,'hierarchy','--no-ansi'],{encoding:'utf8',env})),bounds={},marks=[],markBounds={};
 function visit(node){
  const attrs=node.attributes??{},id=attrs['resource-id'];
  if(id==='timeline.days'||id?.startsWith('timeline.date.')||id?.startsWith('timeline.gap.')||id?.startsWith('timeline.filter.'))bounds[id]=attrs.bounds;
  if(id?.startsWith('timeline.mark.')){marks.push(id);markBounds[id]=attrs.bounds;}
  assert.notEqual(id,'timeline.windows.edit','Expected daily row must be removed.');
  for(const child of node.children??[])visit(child);
 }
 visit(tree);
 assert.ok(Object.keys(bounds).some(id=>id.startsWith('timeline.date.')),'Read actual visible date bounds.');
 assert.ok(bounds['timeline.days'],'One persistent native timeline list must be visible.');
 const probe=JSON.parse(readFileSync(join(documents,'timeline-render-probe.json'),'utf8'));
 assert.ok(probe.lists?.length,'Enable the timeline list identity observer.');
 assert.equal(new Set(probe.lists).size,1,'Every filter must use the original FlatList instance.');
 const state={bounds,marks,markBounds,probe};writeFileSync(join(output,name+'.json'),JSON.stringify(state,null,2));
 simctl('io',udid,'screenshot',join(output,name+'.png'));
 return state;
}
flow('open',`- runFlow:\n    when:\n      notVisible:\n        id: timeline.filter.pee\n    commands:\n      - tapOn:\n          id: nav.open\n      - tapOn:\n          id: nav.timeline\n          retryTapIfNoChange: true\n- tapOn:\n    id: timeline.filter.pee\n- extendedWaitUntil:\n    notVisible:\n      id: activity.loading\n    timeout: 30000\n`);
let baseline=snapshot('pee');
for(const [name,filter] of [['poop-meal','poop-meal'],['pee-return','pee']]){
 flow(name,`- tapOn:\n    id: timeline.filter.${filter}\n- assertVisible:\n    id: timeline.filter.${filter}\n`);
 const state=snapshot(name);
 assert.deepEqual(state.bounds,baseline.bounds,'Filter changes must preserve grid, date positions and control bounds.');
 if(filter==='poop-meal')assert.notDeepEqual(state.marks,baseline.marks,'The shared timeline must update its marks to the selected activities.');
}
flow('scroll',`- swipe:\n    start: 80%,40%\n    end: 80%,75%\n    duration: 500\n`);
baseline=snapshot('scrolled-pee');
flow('scroll-filter',`- tapOn:\n    id: timeline.filter.poop-meal\n`);
const scrolled=snapshot('scrolled-poop-meal');
assert.deepEqual(scrolled.bounds,baseline.bounds,'Filters must retain the user’s scrolled date position.');
const rect=value=>value.match(/-?\d+/g).map(Number),listBounds=rect(scrolled.bounds['timeline.days']);
const target=scrolled.marks.find(id=>{const b=rect(scrolled.markBounds[id]);return b[1]>=listBounds[1]+20&&b[3]<=listBounds[3]-20;});
assert.ok(target,'A populated visible mark is required for detail verification.');
// Open and close details in one session; unchanged timeline rows must stay memoized.
let verified=false;
for(let attempt=0;attempt<3&&!verified;attempt++){
 const before=JSON.parse(readFileSync(join(documents,'timeline-render-probe.json'),'utf8'));
 flow('details-'+attempt,`- tapOn:\n    id: ${target}\n- assertVisible:\n    id: timeline.details\n- tapOn:\n    id: timeline.details.close\n- assertNotVisible:\n    id: timeline.details\n`);
 const after=JSON.parse(readFileSync(join(documents,'timeline-render-probe.json'),'utf8'));
 // A minute timer may tick during XCTest startup; retry outside that tick.
 verified=JSON.stringify(before.date)===JSON.stringify(after.date)&&JSON.stringify(before.track)===JSON.stringify(after.track);
}
assert.ok(verified,'Opening/closing details must not rerender unchanged date or track rows.');
console.log('PASS one native timeline instance, fixed date/control bounds, retained scroll, updated activities, removed daily row, and memoized details. Evidence:',output);
