// Diagnostic build only. The production DB queue serializes these callbacks;
// capture the purpose when issuing SQL, before the native promise can suspend.
let backupDepth=0;
export const readPurpose=()=>backupDepth?'backup':'activity';
export async function withBackupRead(action){
  backupDepth++;
  try{return await action();}finally{backupDepth--;}
}
