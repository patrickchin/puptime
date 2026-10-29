import {getCareSelection,getLocalRuntime} from './local/runtime.native';
export type CareAccess={scope:string;expiresAt:number|null;canLog:boolean;ended:boolean};
export async function getCareAccess():Promise<CareAccess>{
 const runtime=await getLocalRuntime(),care=getCareSelection();
 if(!care)return {scope:'owner',expiresAt:null,canLog:true,ended:false};
 const blocked=await runtime.database.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='care_blocked' AND value='1'"));
 const ended=!!blocked||care.expiresAt!==null&&care.expiresAt<=Date.now();
 return {scope:runtime.petId,expiresAt:care.expiresAt,canLog:!ended&&care.permission==='contribute',ended};
}
