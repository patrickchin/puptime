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

const [udid]=process.argv.slice(2),app='com.patrickchin.puptime';
const simctl=(...args)=>execFileSync('xcrun',['simctl',...args],{encoding:'utf8'}).trim();
const devices=Object.values(JSON.parse(simctl('list','devices','available','-j')).devices).flat();
assert.match(devices.find(device=>device.udid===udid)?.name??'',/^Puptime 459e App Store (iPhone|iPad)$/);
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
const now=Date.now(),events=[];
const daily=[['pee',7,5],['meal',7,30],['poop',7,55],['walk',8,20],['pee',9,40],['pee',11,35],['meal',12,0],['pee',13,15],['walk',16,30],['pee',17,0],['meal',18,30],['poop',19,5],['pee',20,40]];
for(let day=20;day>=0;day--)for(const [type,hour,minute] of daily){
  const at=new Date(now);at.setDate(at.getDate()-day);at.setHours(hour,minute+(day%3-1)*4,0,0);
  if(at.getTime()<=now)events.push({id:'evt_'+randomBytes(16).toString('base64url'),type,at:at.getTime(),source:'app'});
}
await storage.appendEvents(events);
assert.ok(events.length>=260);
assert.equal((await storage.loadEvents()).length,events.length);
assert.equal(await storage.loadPuppyName(),'Mochi');
assert.equal(await storage.shouldShowOnboarding(),false);
await database.close();
mkdirSync(directory,{recursive:true});cpSync(path,target);
simctl('status_bar',udid,'override','--time','9:41','--dataNetwork','wifi','--wifiMode','active','--wifiBars','3','--batteryState','charged','--batteryLevel','100');
simctl('ui',udid,'appearance','light');
console.log(`Seeded ${events.length} synthetic events for ${petId}; no customer data used.`);
