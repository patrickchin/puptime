import {cloudBaseUrl,CloudApiError,cloudErrorCategory,throwIfAborted} from './api.ts';
import {identifierSchema} from './protocol.ts';
import {assertPuppyPhotoBytes,MAX_PUPPY_PHOTO_BYTES,puppyPhotoSchema} from '../puppy-photo.ts';
import type {RecordCloudDiagnostic} from './sync-diagnostics.ts';

type PhotoOptions={method:'GET'|'POST';body?:unknown;headers:Record<string,string>;credentials:'omit';redirect:'error';retry:0;timeout:number;signal:AbortSignal;onResponse?:(context:{response:Response})=>Promise<Response|void>|Response|void};
export type PhotoFetch=(url:string,options:PhotoOptions)=>Promise<{data:unknown;error:{status:number}|null}>;
export function createPhotoTransfer(fetchClient:PhotoFetch,origin:string,timeoutMs=15000,diagnose?:RecordCloudDiagnostic) {
 const base=cloudBaseUrl(origin,true);if(!base)throw new Error('Cloud origin is missing.');
 const options=(accountId:string,signal:AbortSignal):PhotoOptions=>({method:'GET',headers:{'x-puptime-account':identifierSchema.parse(accountId)},credentials:'omit',redirect:'error',retry:0,timeout:15000,signal});
 async function call(path:string,request:PhotoOptions,validate?:(data:unknown)=>void) {
  const signal=request.signal,aborter=new AbortController(),abort=()=>aborter.abort();
  throwIfAborted(signal);signal.addEventListener('abort',abort,{once:true});request.signal=aborter.signal;
  const started=Date.now(),route=request.method==='POST'?'photo-upload':'photo-download',onResponse=request.onResponse;
  let status:number|undefined;
  request.onResponse=async context=>{status=context.response.status;return onResponse?.(context);};
  function report(result:'success'|'error'|'cancelled',category?:CloudApiError['category']) {
   try{diagnose?.({event:'request',route,method:request.method,result,status,durationMs:Math.max(0,Math.min(86_400_000,Date.now()-started)),...(category?{category}:{})});}catch{/* Diagnostics never affect photo transfer. */}
  }
  const timer=setTimeout(abort,timeoutMs);
  try{const result=await fetchClient(base+path,request);throwIfAborted(signal);if(aborter.signal.aborted)throw new CloudApiError('network');if(result.error){status=result.error.status;throw new CloudApiError(cloudErrorCategory(result.error.status),result.error.status);}validate?.(result.data);report('success');return result.data;}
  catch(error){
   if(signal.aborted){report('cancelled');throwIfAborted(signal);}
   const failure=aborter.signal.aborted?new CloudApiError('network'):error instanceof CloudApiError?error:new CloudApiError('network');
   status=failure.status||status;report('error',failure.category);
   throw !failure.status&&status?new CloudApiError(failure.category,status,failure.retryAfterMs):failure;
  }
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
 }
 return {
  async upload(photoId:string,petId:string,accountId:string,body:unknown,signal:AbortSignal) {
   puppyPhotoSchema.parse(photoId);identifierSchema.parse(petId);
   const request=options(accountId,signal);request.method='POST';request.body=body;request.headers['content-type']='image/jpeg';
   await call(`/api/photos/${petId}/${photoId}`,request,result=>{if(!result||typeof result!=='object'||!('photoId' in result)||result.photoId!==photoId)throw new CloudApiError('invalid-response');});
  },
  async download(photoId:string,accountId:string,signal:AbortSignal):Promise<Uint8Array|null> {
   puppyPhotoSchema.parse(photoId);const request=options(accountId,signal);let bytes:Uint8Array|undefined;
   request.onResponse=async({response})=>{
    if(!response.ok)return response;
    if(response.headers.get('content-type')?.split(';')[0]!=='image/jpeg'||!response.body)throw new CloudApiError('invalid-response');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    const abortRead=()=>{void reader.cancel().catch(()=>{});};request.signal.addEventListener('abort',abortRead,{once:true});
    try{for(;;){throwIfAborted(request.signal);const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>MAX_PUPPY_PHOTO_BYTES)throw new CloudApiError('invalid-response');chunks.push(next.value);}}
    finally{request.signal.removeEventListener('abort',abortRead);await reader.cancel().catch(()=>{});reader.releaseLock();}
    bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    try{assertPuppyPhotoBytes(bytes);}catch{throw new CloudApiError('invalid-response');}
    const headers=new Headers(response.headers);headers.set('content-type','application/json');headers.delete('content-length');
    return new Response('{"complete":true}',{status:200,headers});
   };
   try{await call(`/api/photos/${photoId}`,request,()=>{if(!bytes)throw new CloudApiError('invalid-response');});}catch(error){if(error instanceof CloudApiError&&error.status===404)return null;throw error;}
   return bytes!;
  },
 };
}
