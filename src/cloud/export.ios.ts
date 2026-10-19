import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { uuid } from 'expo-modules-core';
import * as Sharing from 'expo-sharing';
import { CloudApiError, throwIfAborted } from './api';
import type { CloudExportAction } from './account-controller';
import type { CloudExportRequest } from './export-request';

const active=new Set<string>();
const cache=()=>new Directory(Paths.cache,'puptime-cloud-exports');
export function clearCloudExportCache():void {
 // Only our directory is inspected. A second client initialization must not
 // delete another still-active export/share; terminated processes leave no set.
 try{const root=cache();if(root.exists)for(const entry of root.list())if(!active.has(entry.uri))entry.delete();}catch{/* Retry orphan cleanup on the next client initialization. */}
}

export function createNativeCloudExport(request:CloudExportRequest):CloudExportAction {
 return async(expectedAccount,ready,signal)=>{
  const directory=new Directory(cache(),uuid.v4());active.add(directory.uri);
  try {
   throwIfAborted(signal);
   directory.create({intermediates:true});
   const file=new File(directory,'puptime-cloud-export.ndjson');file.create();
   const handle=file.open(FileMode.WriteOnly);
   // SDK 57's writableStream sink does not close its handle when a write throws.
   // Own the handle instead, including malformed streams and aborted downloads.
   try{await request(expectedAccount,new WritableStream<Uint8Array>({write:bytes=>handle.writeBytes(bytes)}),signal);}finally{handle.close();}
   if(!await Sharing.isAvailableAsync())throw new Error('Sharing unavailable.');
   if(!await ready())return 'cancelled';
   throwIfAborted(signal);
   await Sharing.shareAsync(file.uri,{dialogTitle:'Download cloud data',mimeType:'application/x-ndjson',UTI:'public.plain-text'});
   return 'shared';
  }catch(error){
   throwIfAborted(signal);
   throw error instanceof CloudApiError?error:new Error('Cloud export failed.');
  }finally{
   try{if(directory.exists)directory.delete();}catch{/* Startup cleanup retries only this private export directory. */}
   active.delete(directory.uri);
  }
 };
}
