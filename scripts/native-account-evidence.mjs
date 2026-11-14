// Read-only evidence helpers for synthetic native account qualification.
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

export const nativeTables=['metadata','puppies','events','routines','settings','pet_settings','local_revisions','local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline','sqlite_sequence'];
const associationTables=['local_sync_owner','local_sync_pets','local_sync_outbox','local_sync_records','local_sync_acks','local_sync_baseline'];

export function nativeSnapshot(db){
  const actual=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
  assert.deepEqual(actual,[...nativeTables].sort(),'Inspect every native table; update the evidence contract when the schema changes.');
  return Object.fromEntries(nativeTables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]));
}

export function assertNativeTransition(before,after,expectedRows={}){
  assert.ok(Object.keys(expectedRows).every(table=>nativeTables.includes(table)),'Name actual tables for expected changes.');
  assert.deepEqual(after,{...before,...expectedRows},'Only explicitly expected rows may change; preserve history, settings, IDs, bodies and sequence counters exactly.');
}

export function assertNativeDetached(before,after){
  assertNativeTransition(before,after,{
    ...Object.fromEntries(associationTables.map(table=>[table,[]])),
    metadata:before.metadata.filter(row=>row.key!=='pending_restore_operation'),
  });
}

// `accepted` must be actual push responses, paired with a snapshot taken while
// those exact operations were pending. Counts alone cannot prove a safe drain.
// This checks outbox/ack rows only; pair it with explicit full-table transition
// expectations for cursor, mirror, event and history changes in the scenario.
export function assertNativeAcknowledged(before,after,accepted){
  assert.ok(accepted.length>0,'Observe a real accepted operation, not an empty count comparison.');
  const ids=new Set(accepted.map(result=>result.operationId));
  assert.equal(ids.size,accepted.length,'Each operation is acknowledged once.');
  const added=accepted.map(result=>{
    const row=before.local_sync_outbox.find(row=>row.operation_id===result.operationId);
    assert.ok(row?.mutation_json,'Every acknowledgement must match a captured pending mutation.');
    const mutation=JSON.parse(row.mutation_json);
    assert.deepEqual([mutation.operationId,mutation.recordId,mutation.kind,mutation.petId],
      [result.operationId,result.record.id,result.record.kind,result.record.petId]);
    return {generation:row.generation,operation_id:row.operation_id,local_sequence:row.sequence,
      mutation_json:row.mutation_json,result_json:JSON.stringify(result),outcome:'accepted'};
  });
  assert.deepEqual(after.local_sync_outbox,before.local_sync_outbox.filter(row=>!ids.has(row.operation_id)),
    'Acknowledging one operation must preserve every newer or unrelated pending payload.');
  assert.deepEqual(after.local_sync_acks,[...before.local_sync_acks,...added],
    'Persist the exact accepted result and original operation payload, generation and local sequence.');
}

export function assertNativeDrained(before,after,accepted,pages){
  assert.ok(before.local_sync_outbox.length>0,'Capture real pending writes before the outage ends.');
  assert.equal(accepted.length,before.local_sync_outbox.length,'Acknowledge every captured operation once.');
  assertNativeAcknowledged(before,after,accepted);
  assert.deepEqual(after.local_sync_outbox,[]);
  assert.ok(pages.length>0&&pages.at(-1).hasMore===false,'Observe the actual completed native pull response.');
  const generation=before.local_sync_owner[0]?.generation;assert.ok(generation);
  const mirrors=new Map(before.local_sync_records.map(row=>[row.record_id,row]));
  for(const record of [...accepted.map(result=>result.record),...pages.flatMap(page=>page.changes)]){
    const previous=mirrors.get(record.id);
    if(previous&&JSON.parse(previous.body).sequence>=record.sequence)continue;
    mirrors.set(record.id,{generation,record_id:record.id,body:JSON.stringify(record)});
  }
  // Ack rows were checked against exact captured operations/results above.
  // Only those receipts, mirrors and the observed pull cursor may change.
  assertNativeTransition(before,after,{
    local_sync_outbox:[],local_sync_acks:after.local_sync_acks,
    local_sync_records:[...mirrors.values()],
    local_sync_owner:before.local_sync_owner.map(row=>({...row,cursor:pages.at(-1).cursor})),
  });
}

// Call while the synthetic app is stopped, with the actual AppGroup defaults
// decoded from disk. Missing/unreadable inspection input must fail closed.
export function assertEmptyIosRestoreSources({tables,sharedDirectory,documentsDirectory,defaults}){
  assert.ok(existsSync(sharedDirectory)&&existsSync(documentsDirectory),'Resolve actual native and AppGroup containers.');
  assert.ok(defaults&&typeof defaults==='object'&&!Array.isArray(defaults),'Inspect the real shared defaults, including an absent plist as an explicitly observed empty object.');
  for(const table of ['events','local_revisions',...associationTables])assert.deepEqual(tables[table],[],`Empty restore preflight: ${table} must be empty.`);
  assert.ok(!tables.metadata.some(row=>row.key==='pending_restore_operation'),'No interrupted restore intent.');
  const journal=join(sharedDirectory,'ExpoWidgets/PuptimePending');
  assert.deepEqual(existsSync(journal)?readdirSync(journal):[],[],'No immutable widget operation files, including unreadable files.');
  for(const [key,timeline] of Object.entries(defaults).filter(([key])=>/^__expo_widgets_.*_timeline$/.test(key))){
    assert.ok(Array.isArray(timeline),`Invalid shared timeline: ${key}`);
    for(const entry of timeline){
      assert.ok(entry?.props&&typeof entry.props==='object',`Inspect every stored widget entry: ${key}`);
      const props=entry.props;
      assert.deepEqual(props.pending??[],[],'No cached widget pending history.');
      assert.ok(props.openNap===undefined||props.openNap===false,'No cached running nap.');
      assert.deepEqual(props.lastEventAt??{},{},'No cached last-activity history.');
    }
  }
  const backups=join(documentsDirectory,'activity-backups');
  for(const file of existsSync(backups)?readdirSync(backups):[]){
    const backup=JSON.parse(readFileSync(join(backups,file),'utf8'));
    assert.ok(Array.isArray(backup.events),'Every retained activity backup must be readable.');
    assert.deepEqual(backup.events,[],'No local backup may supply history to a claimed empty-device restore.');
  }
}
