import assert from 'node:assert/strict';
import test from 'node:test';
import {sqliteEngineReceipt} from './native-activity-probe/sqlite-engine.js';
const expected={version:'3.51.3',sourceId:'2026-03-13 10:38:09 737ae4a34738ffa0c3ff7f9bb18df914dd1cad163f28fd6b6e114a344fe6d618'};
test('existing native helper issues only the fixed two-field engine query',async()=>{
 const seen=[];
 const database={read:action=>action({getFirstAsync:async sql=>{seen.push(sql);return expected;}})};
 assert.deepEqual(await sqliteEngineReceipt(database),expected);
 assert.deepEqual(seen,['SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId']);
});
test('query receipt rejects extra fields, malformed versions/source IDs and no row',async()=>{
 for(const value of [null,{...expected,private:'never output'},{...expected,version:'3.51.3 extra'},{...expected,sourceId:'private sentinel'},{}]){
  await assert.rejects(sqliteEngineReceipt({read:action=>action({getFirstAsync:async()=>value})}));
 }
});
