import { z } from 'zod';
import { cloudAccountSchema, CloudApiError, throwIfAborted } from './api.ts';
import { revisionSchema } from './protocol.ts';

const cursorSchema=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const manifestSchema=z.strictObject({type:z.literal('manifest'),format:z.literal('puptime-cloud-export'),version:z.literal(1),exportedAt:z.number().int().min(0).max(8640000000000000),pets:cloudAccountSchema.shape.pets});
const completeSchema=z.strictObject({type:z.literal('complete'),cursor:cursorSchema});

// A revision contains at most three bounded note snapshots. Keep room for JSON
// escaping without retaining the complete account export in JavaScript memory.
const maxLineBytes=1024*1024;
export async function writeCloudExport(response:Response,destination:WritableStream<Uint8Array>,signal?:AbortSignal):Promise<{cursor:number}> {
 const writer=destination.getWriter();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try {
  throwIfAborted(signal);
  if(!response.ok||response.headers.get('content-type')?.split(';')[0].trim()!=='application/x-ndjson'||!response.body)throw new CloudApiError('invalid-response');
  reader=response.body.getReader();
  const source=reader,onAbort=()=>{void source.cancel().catch(()=>{});};
  signal?.addEventListener('abort',onAbort,{once:true});
  try {
   const line=new Uint8Array(maxLineBytes),decoder=new TextDecoder('utf-8'),encoder=new TextEncoder();let size=0,cursor=0,started=false,complete=false;
   const petIds=new Set<string>();
   function acceptLine() {
    const decoded=decoder.decode(line.subarray(0,size)),roundtrip=encoder.encode(decoded);
    // SDK 57's native decoder does not implement all fatal/stream options.
    if(roundtrip.length!==size||roundtrip.some((byte,index)=>byte!==line[index]))throw new Error('Invalid export encoding.');
    const value:unknown=JSON.parse(decoded);
    if(!started){
     const manifest=manifestSchema.parse(value);
     for(const pet of manifest.pets){if(petIds.has(pet.id))throw new Error('Duplicate puppy.');petIds.add(pet.id);}
     started=true;
    }else if(typeof value==='object'&&value!==null&&'type' in value&&value.type==='revision'){
     const {type,...data}=value;const revision=revisionSchema.parse(data);
     if(revision.sequence!==cursor+1||(revision.after.petId!==null&&!petIds.has(revision.after.petId)))throw new Error('Invalid export order or puppy.');
     cursor=revision.sequence;
    }else{
     if(completeSchema.parse(value).cursor!==cursor)throw new Error('Incomplete export.');
     complete=true;
    }
    size=0;
   }
   for(;;){
    const chunk=await reader.read();throwIfAborted(signal);if(chunk.done)break;
    let start=0;
    while(start<chunk.value.length){
     if(complete)throw new Error('Trailing export data.');
     const newline=chunk.value.indexOf(10,start),end=newline<0?chunk.value.length:newline;
     if(size+end-start>maxLineBytes)throw new Error('Export line is too large.');
     line.set(chunk.value.subarray(start,end),size);size+=end-start;
     if(newline<0)break;
     acceptLine();start=newline+1;
    }
    await writer.write(chunk.value);throwIfAborted(signal);
   }
   if(!started||!complete||size)throw new Error('Incomplete export.');
   await writer.close();return {cursor};
  }finally{signal?.removeEventListener('abort',onAbort);}
 }catch(error){
  await Promise.allSettled([reader?reader.cancel():response.body?.cancel(),writer.abort()]);
  throwIfAborted(signal);
  throw error instanceof CloudApiError?error:new CloudApiError('invalid-response');
 }finally{reader?.releaseLock();writer.releaseLock();}
}
