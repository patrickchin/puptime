import {z} from 'zod';
import {acceptShareSchema,createShareSchema,shareListSchema,shareSchema,shareIdSchema,carePageSchema,careWriteSchema,sharedPuppiesSchema,type CreateShare,type CareWrite} from '../sharing.ts';
import {cloudRecordSchema} from './protocol.ts';
import {CloudApiError,cloudErrorCategory} from './api.ts';

export function createSharingApi(origin:string,fetcher:(url:string,options:{method:'GET'|'POST';body?:object;headers:Record<string,string>;credentials:'omit';redirect:'error';retry:0;timeout:number})=>Promise<{data:unknown;error:{status:number}|null}>){
  async function call<T>(path:string,accountId:string,schema:z.ZodType<T>,body?:object):Promise<T>{
    let result;try{result=await fetcher(origin+path,{method:body?'POST':'GET',...(body?{body}:{}),headers:{'x-puptime-account':accountId},credentials:'omit',redirect:'error',retry:0,timeout:15000});}catch{throw new CloudApiError('network');}
    if(result.error)throw new CloudApiError(cloudErrorCategory(result.error.status),result.error.status);
    const parsed=schema.safeParse(result.data);if(!parsed.success)throw new CloudApiError('invalid-response');return parsed.data;
  }
  return {
    accept:(accountId:string,id:string,token:string)=>call('/api/care/accept',accountId,z.strictObject({id:shareIdSchema}),acceptShareSchema.parse({id,token})),
    list:(accountId:string,petId:string)=>call(`/api/sharing?petId=${encodeURIComponent(petId)}`,accountId,shareListSchema),
    create:(accountId:string,input:CreateShare)=>call('/api/sharing',accountId,shareSchema,createShareSchema.parse(input)),
    revoke:(accountId:string,id:string)=>call(`/api/sharing/${shareIdSchema.parse(id)}/revoke`,accountId,z.strictObject({ok:z.literal(true)}),{}),
    puppies:(accountId:string)=>call('/api/care/puppies',accountId,sharedPuppiesSchema),
    carePage:(accountId:string,id:string,kind:'event'|'routine'='event',after=0)=>call(`/api/care/${shareIdSchema.parse(id)}?kind=${kind}&after=${z.number().int().min(0).parse(after)}`,accountId,carePageSchema),
    careWrite:(accountId:string,id:string,input:CareWrite)=>call(`/api/care/${shareIdSchema.parse(id)}/logs`,accountId,z.object({ok:z.literal(true),record:cloudRecordSchema}),careWriteSchema.parse(input)),
  };
}
export type SharingApi=ReturnType<typeof createSharingApi>;
