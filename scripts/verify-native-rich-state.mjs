// One case in the existing real-native SDK runner. Importing performs no I/O.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readLocalRecords} from '../src/local/sync-projection.ts';
import {localRecordId} from '../src/cloud/record-identity.ts';
import {accountEnglish,accountSpanish} from '../src/cloud/account-copy.ts';
import {nativeSnapshot,assertNativeDetached,assertNativeTransition} from './native-account-evidence.mjs';

export async function readRichNativeState(path){
 const db=new DatabaseSync(path,{readOnly:true});db.exec('BEGIN');
 try{
  const tables=nativeSnapshot(db);assert.equal(tables.puppies.length,1);
  const sql={getFirstAsync:async(query,...values)=>db.prepare(query).get(...values)??null,getAllAsync:async(query,...values)=>db.prepare(query).all(...values)};
  return {tables,records:await readLocalRecords(sql,tables.puppies[0].id)};
 }finally{db.exec('ROLLBACK');db.close();}
}
const projected=records=>records.map(record=>({kind:record.kind,localId:record.kind==='puppy'?'puppy':record.localId,data:record.data})).sort((a,b)=>JSON.stringify([a.kind,a.localId]).localeCompare(JSON.stringify([b.kind,b.localId])));
export function assertRichCloud(local,remote){
 // Pull returns every revision, not just current records. Preserve that original
 // array for later history equality; project only each ID's highest sequence.
 const latest=new Map();
 for(const value of remote){
  assert.ok(Number.isSafeInteger(value.sequence)&&value.sequence>0);const record={...value,localId:localRecordId(value)},previous=latest.get(value.id);
  if(!previous||record.sequence>previous.sequence)latest.set(record.id,record);else if(record.sequence===previous.sequence)assert.deepEqual(record,previous,'One sequence cannot describe conflicting cloud records.');
 }
 assert.deepEqual(projected([...latest.values()].filter(record=>!record.deleted)),projected(local),'Every current cloud record must match its actual production native projection.');
}
// Quiet status explicitly defaults off when its optional device row is absent.
const devicePreferences=tables=>({notify_on_device:tables.metadata.find(row=>row.key==='notify_on_device')?.value,quiet_status_on_device:tables.metadata.find(row=>row.key==='quiet_status_on_device')?.value??'false'});
export function accountFlowEnvironment(language,{EXPECTED_COUNT}={}){
 assert.ok(['en','es'].includes(language));const copy=language==='es'?accountSpanish:accountEnglish;
 const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return {ACCOUNT_CODE_LABEL:copy['account.code'],ACCOUNT_TITLE:copy['account.title'],ACCOUNT_SIGNED_IN:copy['account.signedInAs'],ACCOUNT_STATUS:copy['account.status.synced'],ACCOUNT_LOG_COUNT:copy['account.logsMany'].replace('{count}',String(EXPECTED_COUNT)),ACCOUNT_SIGN_OUT_TITLE:'^'+escape(copy['account.signOutTitle'])+'$',ACCOUNT_SIGN_OUT_ACTION:'(?i)^'+escape(copy['account.signOut'])+'$',ACCOUNT_CANCEL:'(?i)^'+escape(copy['account.cancel'])+'$',ACCOUNT_READY:'^('+[accountEnglish,...(language==='es'?[accountSpanish]:[])].flatMap(strings=>[strings['account.status.synced'],strings['account.combineConfirmTitle']]).map(escape).join('|')+')$'};
}

export async function verifyNativeRichState({flow,signIn,remote,databasePath,freshRestore,emptyRestorePreflight,setLanguage}){
 const read=()=>readRichNativeState(databasePath());
 await flow('prepare');await flow('add-logs',{BATCHES:'4',EXPECTED_COUNT:'12'});await signIn();await flow('enable',{EXPECTED_COUNT:'12'});
 const initial=await read(),starterIds=new Set(initial.tables.routines.map(row=>row.id));
 await flow('rich-routine');
 const custom=(await read()).tables.routines.filter(row=>!starterIds.has(row.id));assert.equal(custom.length,1);const routine=custom[0];
 assert.match(routine.id,/^rtn_/);assert.equal(routine.type,'meal');assert.equal(routine.minutes%15,1,'The actual native minute wheel must save a nondefault time.');assert.equal(routine.reminder,1);assert.equal(routine.tolerance_minutes,60);
 await flow('rich-preferences',{PREF_ACTION:'seed'});setLanguage('es');await flow('wait-synced');
 const original=await read(),owner=original.tables.local_sync_owner[0];assert.ok(owner);assert.equal(original.tables.local_sync_outbox.length,0);
 assert.deepEqual(original.tables.events,initial.tables.events,'Settings and routine editing must preserve the populated note/history.');assert.ok(original.tables.events.some(row=>row.note==='Saved before and after sign-in'));
 const preferences=original.records.find(record=>record.kind==='accountPreferences');assert.ok(preferences);assert.equal(preferences.data.theme,'dark');assert.equal(preferences.data.language,'es');assert.equal(preferences.data.reminderLeadMinutes,15);assert.ok(preferences.data.widgetActions.includes('walk'));
 assert.equal(original.tables.settings.find(row=>row.key==='puptime.theme.v1').value,'dark');assert.equal(original.tables.settings.find(row=>row.key==='puptime.language.v1').value,'es');
 assert.deepEqual(devicePreferences(original.tables),{notify_on_device:'true',quiet_status_on_device:'true'});
 const cloud=await remote({allKinds:true});assertRichCloud(original.records,cloud);assert.ok(!JSON.stringify(cloud).includes('notify_on_device'));assert.ok(!JSON.stringify(cloud).includes('quiet_status_on_device'));
 await flow('reopen',{EXPECTED_COUNT:'12'});assertNativeTransition(original.tables,(await read()).tables);assert.deepEqual(await remote({allKinds:true}),cloud);
 await flow('sign-out');assertNativeDetached(original.tables,(await read()).tables);await signIn();await flow('enable',{EXPECTED_COUNT:'12'});
 const rejoined=await read();assert.equal(rejoined.tables.local_sync_owner[0].account_id,owner.account_id);assert.deepEqual(projected(rejoined.records),projected(original.records));assert.deepEqual(rejoined.tables.local_revisions,original.tables.local_revisions);assert.deepEqual(devicePreferences(rejoined.tables),devicePreferences(original.tables));assert.deepEqual(await remote({allKinds:true}),cloud);
 await flow('sign-out');await freshRestore();setLanguage('en');await flow('prepare');emptyRestorePreflight();const empty=await read();
 assert.deepEqual(devicePreferences(empty.tables),{notify_on_device:'false',quiet_status_on_device:'false'});
 await signIn();setLanguage('es');await flow('enable',{EXPECTED_COUNT:'12'});
 const restored=await read();assert.equal(restored.tables.local_sync_owner[0].account_id,owner.account_id);assert.equal(restored.tables.local_sync_outbox.length,0);assert.deepEqual(projected(restored.records),projected(original.records));assert.deepEqual(restored.tables.routines.find(row=>row.id===routine.id),{...routine,pet_id:restored.tables.puppies[0].id});assert.deepEqual(devicePreferences(restored.tables),devicePreferences(empty.tables));assertRichCloud(restored.records,await remote({allKinds:true}));assert.deepEqual(await remote({allKinds:true}),cloud);
 await flow('rich-preferences',{PREF_ACTION:'verify'});const beforeCold=await read();await flow('reopen',{EXPECTED_COUNT:'12'});const cold=await read();assertNativeTransition(beforeCold.tables,cold.tables);assert.deepEqual(projected(cold.records),projected(original.records));assert.deepEqual(await remote({allKinds:true}),cloud);
 return {checks:['Real Settings saved dark appearance, Spanish,15-minute reminder lead and walk widget actions; actual SDK cloud records exactly matched the production native projection.','Real Schedule saved a nonstarter meal routine with an edited native-wheel time,60-minute window and enabled reminder; exact identity/body and populated log notes survived same-account logout/rejoin and fresh-device cloud restore.','Source-only delivery and quiet-status opt-ins stayed local; the genuinely fresh restore device retained both opt-outs.','Final native Settings verification and cold restart retained all14 tables, every restored record and unchanged cloud records.'],receipt:{phase:'rich-state',nativeUiSeeded:true,spanishCloudAcknowledged:true,nonstarterRoutines:1,cloudRoundtrip:true,newTaskRestoreDevice:true,deviceChoicesRemainLocal:true,finalAll14TablesStable:true}};
}
