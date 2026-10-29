import {getCareSelection,getRuntimeForCare,loadCareSelection} from './local/runtime.native';
export type CareAccess={scope:string;petId?:string;expiresAt:number|null;canLog:boolean;ended:boolean};
export async function getCareAccess():Promise<CareAccess>{
 await loadCareSelection();const care=getCareSelection(),runtime=await getRuntimeForCare(care);
 if(!care)return {scope:'owner',petId:runtime.petId,expiresAt:null,canLog:true,ended:false};
 const blocked=await runtime.database.read(sql=>sql.getFirstAsync("SELECT value FROM metadata WHERE key='care_blocked' AND value='1'"));
 const ended=!!blocked||care.expiresAt!==null&&care.expiresAt<=Date.now();
 return {scope:runtime.petId,petId:runtime.petId,expiresAt:care.expiresAt,canLog:!ended&&care.permission==='contribute',ended};
}
