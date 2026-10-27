// Disposable marketing fixture. Never replaces a populated or account-owned database.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {cpSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createLocalDatabase,initializeLocalDatabase} from '../src/local/database.ts';
import {sqliteTestConnection} from '../src/local/sqlite-test-adapter.ts';
import {createLocalRuntime} from '../src/local/runtime-factory.ts';
import {parseEvents} from '../src/storage-validation.ts';
import {suggestScheduleFromEvents} from '../src/analytics.ts';

const [udid,csvPath]=process.argv.slice(2),app='com.patrickchin.puptime';
assert.ok(csvPath,'Supply the original activity CSV; it stays outside version control.');
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8'}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.match(devices.find(device=>device.udid===udid)?.name??'',/^Puptime 459e App Store (iPhone|iPad) Real History$/);
try{simctl('terminate',udid,app);}catch{}
const directory=join(simctl('get_app_container',udid,app,'data'),'Documents/SQLite');
const target=join(directory,'puptime-v2.db');
if(existsSync(target)){
  const previous=new DatabaseSync(target,{readOnly:true});
  try{
    assert.equal(previous.prepare('SELECT COUNT(*) n FROM events').get().n,0,'Preserve existing history.');
    assert.equal(previous.prepare('SELECT COUNT(*) n FROM local_sync_owner').get().n,0,'Preserve account-owned data.');
  }finally{previous.close();}
  throw new Error('Use a fresh dedicated simulator installation for each capture session.');
}
const path=resolve('output/app-store',udid+'.sqlite');
assert.ok(!existsSync(path),'Keep previous capture fixtures.');
mkdirSync(resolve('output/app-store'),{recursive:true});
const database=await createLocalDatabase(sqliteTestConnection(path));
const {petId}=await initializeLocalDatabase(database);
const {storage}=await createLocalRuntime(database,petId);
await storage.completeOnboarding({puppyName:'Mochi'});
await storage.saveThemePreference('light');
await storage.saveLanguagePreference('en');
// csv's standard parser handles the older nine-column export as well as current CSVs.
const rows=JSON.parse(execFileSync('python3',['-c','import csv,json,sys; json.dump(list(csv.DictReader(open(sys.argv[1],encoding="utf-8-sig"))),sys.stdout)',resolve(csvPath)],{encoding:'utf8'}));
assert.ok(rows.length>0,'The CSV must contain activity history.');
const events=parseEvents(rows.map(row=>({
 id:'evt_'+randomBytes(16).toString('base64url'),type:row.Type,
 at:Date.parse(row['Started At (ISO)']),source:row.Source,
 ...(row['Ended At (ISO)']?{endedAt:Date.parse(row['Ended At (ISO)'])}:{}),
 ...(row.Estimated==='true'?{estimated:true}:{}),
 ...(row['Custom Label']?{customLabel:row['Custom Label']}:{}),
})));
// Preserve recorded dates, times, sources, durations and duplicate timestamps.
// Personal notes are deliberately omitted from public marketing captures.
await storage.appendEvents(events);
const saved=await storage.loadEvents();
assert.deepEqual([...saved].sort((a,b)=>a.id.localeCompare(b.id)),[...events].sort((a,b)=>a.id.localeCompare(b.id)));
const anchor=Math.max(...events.map(event=>event.at))+10*60_000;
const suggestion=suggestScheduleFromEvents(events,14,new Date(anchor));
assert.ok(suggestion.entries.length>0);
await storage.saveSchedule(suggestion.entries.map(entry=>({...entry,id:'rtn_'+randomBytes(16).toString('base64url'),reminder:false})));
assert.equal(await storage.loadPuppyName(),'Mochi');
assert.equal(await storage.shouldShowOnboarding(),false);
await database.close();
mkdirSync(directory,{recursive:true});cpSync(path,target);
simctl('status_bar',udid,'override','--time','9:41','--dataNetwork','wifi','--wifiMode','active','--wifiBars','3','--batteryState','charged','--batteryLevel','100');
simctl('ui',udid,'appearance','light');
console.log(`Imported ${events.length} recorded activities, with original timestamps and sources; personal notes omitted. Capture clock: ${new Date(anchor).toISOString()}`);
