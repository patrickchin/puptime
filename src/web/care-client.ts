import {z} from 'zod';
import {cloudRecordSchema} from '../cloud/protocol.ts';
import {acceptShareSchema,shareSchema,careWriteSchema,carePageSchema,sharedPuppiesSchema,type CareWrite} from '../sharing.ts';

export type {CareRow,CarePage} from '../sharing.ts';
const previewSchema=z.object({puppyName:z.string(),ownerName:z.string(),share:shareSchema});
export type CarePreview=z.infer<typeof previewSchema>;
export class CareError extends Error{
 constructor(public status:number){super(status===410?'This invitation has expired or access has ended.':status===401?'Sign in to accept this household invitation.':status===403?'Your access does not allow this change.':status===409?'This entry changed or the invitation was already accepted. Refresh and try again.':status===429?'Too many attempts. Wait a moment and try again.':'Couldn’t reach Puptime. Check your connection and try again.');}
}
export function createCareClient(origin:string,transport:typeof fetch=fetch){
 async function call<T>(path:string,schema:z.ZodType<T>,body?:object):Promise<T>{
  let response;try{response=await transport(origin+path,{method:body?'POST':'GET',credentials:'include',redirect:'error',headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}catch{throw new CareError(0);}
  if(!response.ok)throw new CareError(response.status);
  const parsed=schema.safeParse(await response.json());if(!parsed.success)throw new CareError(503);return parsed.data;
 }
 return {
  preview:(id:string,token:string)=>call('/api/care/preview',previewSchema,acceptShareSchema.parse({id,token})),
  accept:(id:string,token:string,name?:string)=>call('/api/care/accept',z.object({id:z.string()}),acceptShareSchema.parse({id,token,name})),
  page:(id:string,kind:'event'|'routine'='event',after=0)=>call(`/api/care/${encodeURIComponent(id)}?kind=${kind}&after=${after}`,carePageSchema),
  puppies:()=>call('/api/care/puppies',sharedPuppiesSchema),
  write:(id:string,input:CareWrite)=>call(`/api/care/${encodeURIComponent(id)}/logs`,z.object({ok:z.literal(true),record:cloudRecordSchema}),careWriteSchema.parse(input)),
 };
}
export type CareClient=ReturnType<typeof createCareClient>;
