// Shared guest/enrolled upgrade evidence; no app execution at import time.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {eventDataFromSql} from '../src/record-sql.ts';
import {parseEvents} from '../src/storage-validation.ts';
const command=(binary,args)=>execFileSync(binary,args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const simctl=(...args)=>command('xcrun',['simctl',...args]);
const backupPath=/^activity-backups\/bkp_[a-f0-9]{32}\.json$/;
export const digestBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export function documentFiles(directory){
 return Object.fromEntries((existsSync(directory)?readdirSync(directory,{recursive:true,withFileTypes:true}):[]).flatMap(entry=>{
  assert.ok(!entry.isSymbolicLink()&&(entry.isDirectory()||entry.isFile()),'Reject untracked nonregular saved files.');
  if(entry.isDirectory())return [];
  const parent=entry.parentPath??entry.path,path=join(parent,entry.name),name=path.slice(directory.length+1);
  return [[name,hash(path)]];
 }).sort(([left],[right])=>left.localeCompare(right)));
}
export const protectedDocumentFiles=directory=>Object.fromEntries(Object.entries(documentFiles(directory)).filter(([name])=>!/^SQLite\/puptime-v2\.db(?:-wal|-shm|-journal)?$/.test(name)));
export function strictBackup(raw){
 assert.equal(typeof raw,'string');const value=JSON.parse(raw);
 assert.deepEqual(Object.keys(value).sort(),['format','version','createdAt','petId','puppyName','reason','appVersion','events'].sort());
 assert.equal(raw,JSON.stringify(value),'Require the exact compact JSON emitted by the original backup writer.');
 assert.equal(value.format,'puptime-activity');assert.equal(value.version,1);
 assert.ok(Number.isSafeInteger(value.createdAt)&&value.createdAt>=0&&value.createdAt<=8640000000000000);
 assert.match(value.petId,/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);assert.ok(typeof value.puppyName==='string'&&value.puppyName.length>0&&value.puppyName.length<=256);
 assert.ok(['daily','before-update','account-change','cloud-replace','import','recovery','delete'].includes(value.reason));
 assert.ok(typeof value.appVersion==='string'&&value.appVersion.length>0&&value.appVersion.length<=128);
 assert.deepEqual(parseEvents(value.events),value.events);return value;
}
export function assertDeviceClock(clock,previous){
 assert.deepEqual(Object.keys(clock).sort(),['date','timeZone','offsetSeconds','timestamp'].sort());
 assert.ok(Number.isSafeInteger(clock.timestamp)&&clock.timestamp>=0&&clock.timestamp<=8640000000000000);
 assert.ok(typeof clock.timeZone==='string'&&clock.timeZone.length>0&&clock.timeZone.length<=128);
 assert.ok(Number.isInteger(clock.offsetSeconds)&&Math.abs(clock.offsetSeconds)<=86400);
 assert.equal(clock.date,new Date(clock.timestamp+clock.offsetSeconds*1000).toISOString().slice(0,10));
 if(previous){for(const key of ['date','timeZone','offsetSeconds'])assert.equal(clock[key],previous[key],'The actual device-local day and time zone must remain unchanged.');assert.ok(clock.timestamp>=previous.timestamp,'The device clock must not move backwards.');}
 return clock;
}
export function assertOldDaily(before,clock,{oldVersion,expectedEvents=12}){
 assertDeviceClock(clock);assert.equal(before.tables.puppies.length,1);const puppy=before.tables.puppies[0];
 assert.deepEqual(before.tables.metadata.filter(row=>row.key==='active_pet_id').map(row=>row.value),[puppy.id]);
 assert.equal(before.tables.events.length,expectedEvents);assert.ok(before.tables.events.every(row=>row.pet_id===puppy.id));
 assert.deepEqual(before.tables.metadata.filter(row=>row.key==='backup_app_version').map(row=>row.value),[oldVersion]);
 assert.deepEqual(Object.keys(before.backups).sort(),Object.keys(before.files).filter(name=>name.startsWith('activity-backups/')).sort());
 const daily=[];
 for(const [name,raw] of Object.entries(before.backups)){
  assert.match(name,backupPath);assert.equal(before.files[name],digestBytes(raw));const backup=strictBackup(raw);
  assert.equal(backup.petId,puppy.id);assert.equal(backup.appVersion,oldVersion);assert.ok(backup.events.length>0);
  assert.ok(backup.createdAt<=clock.timestamp,'An old backup cannot come from the future.');
  if(backup.reason==='daily'&&new Date(backup.createdAt+clock.offsetSeconds*1000).toISOString().slice(0,10)===clock.date)daily.push(backup);
 }
 assert.equal(daily.length,1,'Establish one genuine old-runtime daily backup on this device-local date.');
}
export function assertNumericUpgrade(before,after,{started,finished,oldVersion,newVersion,expectedEvents=12}){
 assertDeviceClock(finished,started);assertOldDaily(before,started,{oldVersion,expectedEvents});
 const added=Object.keys(after.files).filter(name=>!Object.hasOwn(before.files,name));assert.equal(added.length,1,'Only the before-update backup file may be added.');
 const name=added[0];assert.match(name,backupPath);assert.equal(after.files[name],digestBytes(after.backups[name]));const backup=strictBackup(after.backups[name]);
 const puppy=before.tables.puppies[0];assert.equal(backup.reason,'before-update');assert.equal(backup.appVersion,newVersion);assert.equal(backup.petId,puppy.id);assert.equal(backup.puppyName,puppy.name);
 assert.ok(backup.createdAt>=started.timestamp&&backup.createdAt<=finished.timestamp,'The safety backup must be created inside the actual first-launch interval.');
 const events=[...before.tables.events].sort((left,right)=>right.at-left.at||Buffer.compare(Buffer.from(right.id),Buffer.from(left.id))).map(({id,...row})=>({id,...eventDataFromSql(row)}));
 assert.deepEqual(backup.events,events,'Preserve all original events in the production backup order.');
 assert.deepEqual(after.tables.metadata.filter(row=>row.key==='backup_app_version').map(row=>row.value),[newVersion]);
 const files={...after.files},backups={...after.backups};delete files[name];delete backups[name];
 const normalized={...after,files,backups,tables:{...after.tables,metadata:after.tables.metadata.map(row=>row.key==='backup_app_version'?{...row,value:oldVersion}:row)}};
 assertPreserved(before,normalized,{paletteChange:true});return name;
}
export function assertClockEnvelope(value,device,nonce){assert.deepEqual(Object.keys(value).sort(),['clock','device','nonce']);assert.equal(value.nonce,nonce);assert.equal(value.device,device);return assertDeviceClock(value.clock);}
export function prepareDeviceClock(directory,device,nonce,assertLease){
 assert.match(device,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);assert.match(nonce,/^[a-f0-9]{32}$/);assertLease();
 const source=join(directory,'device-clock.swift'),binary=join(directory,'device-clock');
 writeFileSync(source,`import Foundation
let now = Date()
let zone = TimeZone.current
var calendar = Calendar(identifier: .gregorian)
calendar.timeZone = zone
let parts = calendar.dateComponents([.year, .month, .day], from: now)
let value: [String: Any] = ["date": String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!), "timeZone": zone.identifier, "offsetSeconds": zone.secondsFromGMT(for: now), "timestamp": Int64(floor(now.timeIntervalSince1970 * 1000))]
let envelope: [String: Any] = ["nonce": "${nonce}", "device": "${device}", "clock": value]
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys]))
`,{mode:0o600,flag:'wx'});
 const sdk=command('xcrun',['--sdk','iphonesimulator','--show-sdk-path']);
 command('xcrun',['--sdk','iphonesimulator','swiftc','-sdk',sdk,'-target','arm64-apple-ios17.0-simulator',source,'-o',binary]);
 command('codesign',['--force','--sign','-',binary]);
 const sourceSHA256=hash(source),binarySHA256=hash(binary);
 return {sourceSHA256,binarySHA256,read(){assertLease();assert.equal(hash(source),sourceSHA256);assert.equal(hash(binary),binarySHA256);return assertClockEnvelope(JSON.parse(simctl('spawn',device,binary)),device,nonce);}};
}
export function assertPreserved(before,after,{paletteChange=false}={}){
 const protectedState=value=>({...value,widgetTimelines:Object.fromEntries(Object.entries(value.widgetTimelines).map(([key,entries])=>[key,entries.map(props=>{
  if(!paletteChange)return props;
  const {appearance}=props;assert.ok(appearance?.light&&appearance?.dark,'Retain both widget appearances.');
  const colours=value=>{const {background,surface,...layout}=value;assert.equal(typeof background,'string');assert.equal(typeof surface,'string');return layout;};
  return {...props,appearance:{...appearance,light:colours(appearance.light),dark:colours(appearance.dark)}};
 })]))});
 assert.deepEqual(protectedState(after),protectedState(before),'Preserve every table/row/sequence counter, saved file, photo and widget activity field.');
}
