// Real native query/render qualification. Requires the explicit test Metro config.
// Only empty or previously marked synthetic, unowned databases may be reseeded.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRepository} from '../src/local/repository.ts';
import {csvToEvents} from '../src/export.ts';

const [udid,population,permission]=process.argv.slice(2),count=Number(population),app='com.patrickchin.puptime';
assert.ok([1000,10000,100000].includes(count));
assert.equal(permission,'--replace-synthetic','Explicitly authorize replacing this dedicated synthetic fixture.');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const device=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat().find(device=>device.udid===udid);
assert.ok(device?.name.startsWith('Puptime Native Storage '));
const root=simctl('get_app_container',udid,app,'data'),directory=join(root,'Documents/SQLite'),path=join(directory,'puptime-v2.db');
const output=mkdtempSync(join(tmpdir(),'puptime-native-activity-'+count+'-'));
try{simctl('terminate',udid,app);}catch{}
if(existsSync(path)){
 const old=new DatabaseSync(path,{readOnly:true});
 try{
  assert.equal(old.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Never replace an owned account profile.');
  const marker=old.prepare("SELECT value FROM metadata WHERE key='qualification_fixture'").get()?.value;
  const total=old.prepare('SELECT COUNT(*) n FROM events').get().n;
  assert.ok(total===0||marker==='native-activity-v1','Preserve unmarked populated history.');
  if(total)assert.equal(old.prepare("SELECT COUNT(*) n FROM events WHERE id NOT LIKE 'qualification-%'").get().n,0);
 }finally{old.close();}
 cpSync(directory,join(output,'previous-synthetic-sqlite'),{recursive:true});
}
mkdirSync(directory,{recursive:true});
const seedPath=join(output,'seed.sqlite'),database=await createLocalDatabase(sqliteTestConnection(seedPath));
const {petId}=await initializeLocalDatabase(database);
const end=new Date();end.setHours(0,0,0,0);const last=end.getTime()-60000;
const events=Array.from({length:count},(_,index)=>({id:'qualification-'+String(index).padStart(6,'0'),type:'pee',at:last-(count-index-1)*60000,source:'app'}));
const repository=createLocalRepository(database,petId);
for(let at=0;at<events.length;at+=1000)await repository.appendEvents(events.slice(at,at+1000));
await database.write(async sql=>{
 await sql.runAsync("UPDATE metadata SET value='false' WHERE key='show_onboarding'");
 await sql.runAsync("INSERT INTO metadata(key,value) VALUES ('qualification_fixture','native-activity-v1')");
});
await database.close();
// App is stopped; replace only the scoped synthetic database and its journal files.
const {rmSync}=await import('node:fs');
for(const suffix of ['','-wal','-shm'])rmSync(path+suffix,{force:true});
cpSync(seedPath,path);
const sql=new DatabaseSync(path,{readOnly:true}),documents=join(root,'Documents');
function expectedWindow(previousDays){
 const from=new Date(end),until=new Date(end);from.setDate(from.getDate()-previousDays);until.setDate(until.getDate()+1);
 return sql.prepare('SELECT COUNT(*) n FROM events WHERE pet_id=? AND at>=? AND at<?').get(petId,from.getTime(),until.getTime()).n;
}
const trace=()=>JSON.parse(readFileSync(join(documents,'sql-query-probe.json'),'utf8'));
const renders=()=>JSON.parse(readFileSync(join(documents,'row-render-probe.json'),'utf8')).renders;
const windows=()=>trace().reads.filter(read=>read.sql.includes('UNION ALL'));
function flow(name,body){
 const file=join(output,name+'.yaml');writeFileSync(file,'appId: '+app+'\nname: '+name+'\n---\n'+body);
 execFileSync(process.env.MAESTRO_BIN??'maestro',['--device',udid,'test',file,'--test-output-dir',join(output,name)],{stdio:'inherit',env:{...process.env,MAESTRO_CLI_NO_ANALYTICS:'1'}});
}
function screenshot(name){simctl('io',udid,'screenshot',join(output,name+'.png'));}
try{
 flow('initial-page',`
- launchApp
- extendedWaitUntil:
    visible:
      id: history.day.yesterday
      text: .*200 loaded.*
    timeout: 60000
- extendedWaitUntil:
    notVisible:
      id: activity.loading
    timeout: 30000
`);
 assert.ok(trace().reads.some(read=>read.sql.includes('ORDER BY at DESC,id DESC LIMIT')&&read.rows===201));
 assert.ok(trace().reads.every(read=>read.rows<=201));
 const before=renders(),target=events.at(-1).id;
 assert.equal(Object.keys(before).length,200,'The actual EventRow body observer must be active.');
 console.log('PASS '+count+': actual initial history reads201 SQL rows and renders200 records. Rows/ms:',trace().reads.map(read=>[read.rows,read.ms]));
 flow('edit-loaded-record',`
- tapOn:
    id: event.pee.edit
    index: 0
- scrollUntilVisible:
    element:
      id: editor.note.input
    direction: DOWN
    visibilityPercentage: 50
- tapOn:
    id: editor.note.input
- setClipboard: Native bounded edit
- pasteText
- tapOn:
    id: editor.close
- extendedWaitUntil:
    visible:
      id: event.pee.note
      text: Native bounded edit
    timeout: 30000
`);
 const after=renders(),changed=Object.keys(before).filter(id=>before[id]!==after[id]);
 assert.deepEqual(changed,[target]);
 assert.equal(sql.prepare('SELECT note FROM events WHERE id=?').get(target).note,'Native bounded edit');
 screenshot('saved-record');
 flow('load-next-page',`
- tapOn:
    id: history.day.yesterday
- scrollUntilVisible:
    element:
      id: history.loadMore
    direction: DOWN
    visibilityPercentage: 50
- tapOn:
    id: history.loadMore
- extendedWaitUntil:
    visible:
      id: history.day.yesterday
      text: .*400 loaded.*
    timeout: 30000
`);
 assert.ok(trace().reads.every(read=>read.rows<=201));
 assert.ok(trace().reads.some(read=>read.sql.includes('(at,id)<')&&read.rows===201));
 console.log('PASS '+count+': one edit rerenders only its row; load-more uses a second keyset page, with no whole-history read.');
 const timelineStart=windows().length;
 flow('comparison-window',`
- tapOn:
    id: nav.open
- tapOn:
    id: nav.timeline
    retryTapIfNoChange: true
- extendedWaitUntil:
    visible:
      id: timeline.range
      text: .*[1-9][0-9]* entries.*
    timeout: 60000
- extendedWaitUntil:
    notVisible:
      id: activity.loading
    timeout: 30000
`);
 assert.deepEqual(windows().slice(timelineStart).map(read=>read.rows),[expectedWindow(14)]);
 screenshot('populated-timeline');
 const scheduleStart=windows().length;
 flow('routine-window',`
- tapOn:
    id: nav.open
- tapOn:
    id: nav.schedule
    retryTapIfNoChange: true
- extendedWaitUntil:
    visible:
      id: screen.schedule
    timeout: 30000
- extendedWaitUntil:
    notVisible:
      id: activity.loading
    timeout: 30000
- assertVisible:
    id: screen.schedule
`);
 assert.deepEqual(windows().slice(scheduleStart).map(read=>read.rows),[expectedWindow(14)]);
 const insightsStart=windows().length;
 flow('insights-window',`
- tapOn:
    id: nav.open
- tapOn:
    id: nav.insights
    retryTapIfNoChange: true
- extendedWaitUntil:
    visible:
      id: screen.insights
    timeout: 30000
- extendedWaitUntil:
    notVisible:
      id: activity.loading
    timeout: 30000
`);
 assert.deepEqual(windows().slice(insightsStart).map(read=>read.rows),[expectedWindow(9)]);
 const exportStart=trace().reads.length;
 assert.ok(!trace().reads.some(read=>/^SELECT \* FROM events WHERE pet_id=\? ORDER BY at DESC,id DESC$/.test(read.sql)));
 console.log('PASS '+count+': comparison/routine/frequency read only requested date windows; monthly summaries stay SQL aggregates. Windows rows/ms:',windows().map(read=>[read.rows,read.ms]));
 flow('explicit-full-export',`
- scrollUntilVisible:
    element:
      id: insights.export
    direction: DOWN
    visibilityPercentage: 50
- extendedWaitUntil:
    visible:
      id: insights.export
      enabled: true
    timeout: 30000
- tapOn:
    id: insights.export
`);
 const csvs=readdirSync(root,{recursive:true}).filter(file=>/puptime-activity-.*\.csv$/.test(file)).map(file=>join(root,file)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
 assert.ok(csvs.length);const exported=csvToEvents(readFileSync(csvs[0],'utf8'));
 assert.equal(exported.length,count);
 assert.deepEqual(new Set(exported.map(event=>event.id)),new Set(events.map(event=>event.id)));
 assert.equal(exported.find(event=>event.id===target).note,'Native bounded edit');
 assert.ok(trace().reads.slice(exportStart).some(read=>read.rows===count),'Only explicit export requests the complete dataset.');
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM events').get().n,count);
 screenshot('full-export-share');
 writeFileSync(join(output,'query-report.json'),JSON.stringify({population:count,reads:trace().reads,decoded:trace().decoded},null,2));
 console.log('PASS '+count+': explicit native CSV contains every ID and the saved edit after bounded pages; OS share opened without selecting a recipient. Evidence:',output);
}finally{sql.close();}
