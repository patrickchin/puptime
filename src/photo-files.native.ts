import { Directory, File, Paths } from 'expo-file-system';
import { entityId } from './entity-id';
import { assertPuppyPhotoBytes, puppyPhotoSchema } from './puppy-photo';

const directory=()=>new Directory(Paths.document,'dog-photos');
export const puppyPhotoFile=(id:string)=>new File(directory(),`${puppyPhotoSchema.parse(id)}.jpg`);
export const localPuppyPhotoUri=(id?:string)=>id&&puppyPhotoFile(id).exists?puppyPhotoFile(id).uri:undefined;
export function savePuppyPhotoFile(bytes:Uint8Array,id=entityId('img')):string {
  assertPuppyPhotoBytes(bytes);
  directory().create({intermediates:true,idempotent:true});
  const target=puppyPhotoFile(id),temporary=new File(directory(),`${id}.tmp`);
  if(target.exists)return id;
  try{temporary.create({overwrite:true});temporary.write(bytes);temporary.moveSync(target);return id;}
  finally{if(temporary.exists&&temporary.name.endsWith('.tmp'))temporary.delete();}
}
export function removePuppyPhotoFile(id:string) {const file=puppyPhotoFile(id);if(file.exists)file.delete();}
