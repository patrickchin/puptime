import { launchImageLibraryAsync } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { MAX_PUPPY_PHOTO_BYTES } from './puppy-photo';
import { savePuppyPhotoFile } from './photo-files.native';

export async function choosePuppyPhoto():Promise<string|null> {
  const result=await launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:1,exif:false});
  if(result.canceled)return null;
  const asset=result.assets[0],side=Math.min(asset.width,asset.height),context=ImageManipulator.manipulate(asset.uri);
  let image;
  try {
    context.crop({originX:Math.floor((asset.width-side)/2),originY:Math.floor((asset.height-side)/2),width:side,height:side}).resize({width:512,height:512});
    image=await context.renderAsync();
    let saved=await image.saveAsync({format:SaveFormat.JPEG,compress:0.8});
    let file=new File(saved.uri);
    if(file.size>MAX_PUPPY_PHOTO_BYTES){
      file.delete();context.resize({width:256,height:256});image.release();image=undefined;
      image=await context.renderAsync();saved=await image.saveAsync({format:SaveFormat.JPEG,compress:0.65});file=new File(saved.uri);
    }
    try{return savePuppyPhotoFile(await file.bytes());}finally{if(file.exists)file.delete();}
  } finally {image?.release();context.release();}
}
