export type CareAccess={scope:string;petId?:string;expiresAt:number|null;canLog:boolean;ended:boolean};
export async function getCareAccess():Promise<CareAccess>{return {scope:'owner',expiresAt:null,canLog:true,ended:false};}
