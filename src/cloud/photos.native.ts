import {getLocalRuntime} from '../local/runtime.native';
import {localPuppyPhotoUri,puppyPhotoFile,savePuppyPhotoFile} from '../photo-files.native';
import type {PhotoSync} from './runner';
import type {createPhotoTransfer} from './photo-transfer';
import {assertPuppyPhotoBytes} from '../puppy-photo';

export function createNativePhotoSync(transfer:ReturnType<typeof createPhotoTransfer>):PhotoSync {
 return {
  has:id=>!!localPuppyPhotoUri(id),
  current:async()=> (await (await getLocalRuntime()).storage.loadPuppyProfile()).photoId,
  upload:async(id,petId,accountId,signal)=>{
   const file=puppyPhotoFile(id);if(!file.exists)throw new Error('The saved profile photo is missing.');
   // Expo File has toJSON(), which the auth SDK serializes as metadata.
   const bytes=await file.bytes();assertPuppyPhotoBytes(bytes);
   await transfer.upload(id,petId,accountId,bytes,signal);
  },
  download:async(id,accountId,signal)=>{
   if(localPuppyPhotoUri(id))return false;
   const bytes=await transfer.download(id,accountId,signal);if(!bytes)return false;
   savePuppyPhotoFile(bytes,id);return true;
  },
 };
}
