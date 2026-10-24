import { z } from 'zod';
import { cloudBaseUrl, CloudApiError, cloudErrorCategory, throwIfAborted } from './api.ts';
import { identifierSchema } from './protocol.ts';
import { writeCloudExport } from './export-stream.ts';

type ExportOptions={method:'POST';body:{expectedAccount:string};headers:Record<string,string>;credentials:'omit';redirect:'error';retry:0;signal:AbortSignal;onResponse:(context:{response:Response})=>Promise<Response>};
type ExportFetch=(url:string,options:ExportOptions)=>Promise<{data:unknown;error:{status:number}|null}>;
export type CloudExportRequest=(expectedAccount:string,destination:WritableStream<Uint8Array>,signal?:AbortSignal)=>Promise<void>;

export function createCloudExportRequest(fetchClient:ExportFetch,origin:string,timeoutMs=60000):CloudExportRequest {
 const base=cloudBaseUrl(origin,true);if(!base)throw new Error('Cloud origin is missing.');
 return async(expectedAccount,destination,signal)=>{
  if(!identifierSchema.safeParse(expectedAccount).success)throw new CloudApiError('invalid-request',400);
  throwIfAborted(signal);
  const aborter=new AbortController(),abort=()=>aborter.abort();
  signal?.addEventListener('abort',abort,{once:true});
  // Better Fetch clears its timer when headers arrive. This timer also covers
  // a stalled body and the SDK's successful-response credential persistence.
  const timer=setTimeout(abort,timeoutMs);let complete=false;
  try {
   const result=await fetchClient(base+'/api/account/export',{
    method:'POST',body:{expectedAccount},headers:{'content-type':'application/x-www-form-urlencoded','x-puptime-profile-photos':'1'},credentials:'omit',redirect:'error',retry:0,signal:aborter.signal,
    async onResponse({response}){
     if(!response.ok){void response.body?.cancel().catch(()=>{});throw new CloudApiError(cloudErrorCategory(response.status),response.status);}
     await writeCloudExport(response,destination,aborter.signal);complete=true;
     // The Expo plugin's onSuccess runs after this hook. Keep every auth header,
     // while replacing only the consumed export body and its representation.
     const headers=new Headers(response.headers);headers.set('content-type','application/json');headers.delete('content-length');
     return new Response('{"complete":true}',{status:response.status,headers});
    },
   });
   throwIfAborted(signal);throwIfAborted(aborter.signal);
   if(result.error)throw new CloudApiError(cloudErrorCategory(result.error.status),result.error.status);
   if(!complete||!z.object({complete:z.literal(true)}).safeParse(result.data).success)throw new CloudApiError('invalid-response');
  }catch(error){
   throwIfAborted(signal);
   if(aborter.signal.aborted)throw new CloudApiError('network');
   throw error instanceof CloudApiError?error:new CloudApiError('network');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
}
