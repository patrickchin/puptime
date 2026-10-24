import {getLocalRuntime} from '../local/runtime.native';
import {localPuppyPhotoUri,puppyPhotoFile,savePuppyPhotoFile} from '../photo-files.native';
import type {PhotoSync} from './runner';
import type {createPhotoTransfer} from './photo-transfer';

export function createNativePhotoSync(transfer:ReturnType<typeof createPhotoTransfer>):PhotoSync {
 return {
  has:id=>!!localPuppyPhotoUri(id),
  current:async()=> (await (await getLocalRuntime()).storage.loadPuppyProfile()).photoId,
  upload:async(id,petId,accountId,signal)=>{
   const file=puppyPhotoFile(id);if(!file.exists)throw new Error('The saved profile photo is missing.');
   await transfer.upload(id,petId,accountId,file,signal);
  },
  download:async(id,accountId,signal)=>{
   if(localPuppyPhotoUri(id))return false;
   const bytes=await transfer.download(id,accountId,signal);if(!bytes)return false;
   savePuppyPhotoFile(bytes,id);return true;
  },
 };
}
