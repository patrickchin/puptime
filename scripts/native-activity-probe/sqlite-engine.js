// Called only by the opt-in native probe, through the real Expo connection.
export async function sqliteEngineReceipt(database){
 const value=await database.read(sql=>sql.getFirstAsync('SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId'));
 if(!value||Object.keys(value).sort().join(',')!=='sourceId,version'
  ||typeof value.version!=='string'||!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.version)
  ||typeof value.sourceId!=='string'||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [a-f0-9]{64}$/.test(value.sourceId)){
  throw new Error('The native SQLite engine receipt is invalid.');
 }
 return {version:value.version,sourceId:value.sourceId};
}
