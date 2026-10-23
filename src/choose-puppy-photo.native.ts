import { launchImageLibraryAsync } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { MAX_PUPPY_PHOTO_LENGTH, puppyPhotoSchema } from './puppy-photo';

export async function choosePuppyPhoto():Promise<string|null> {
  const result=await launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:1,exif:false});
  if(result.canceled)return null;
  const asset=result.assets[0],side=Math.min(asset.width,asset.height);
  const context=ImageManipulator.manipulate(asset.uri);
  let image;
  try {
    context.crop({originX:Math.floor((asset.width-side)/2),originY:Math.floor((asset.height-side)/2),width:side,height:side}).resize({width:256,height:256});
    image=await context.renderAsync();
    let saved=await image.saveAsync({format:SaveFormat.JPEG,compress:0.65,base64:true});
    if(!saved.base64)throw new Error('The photo could not be read.');
    if(saved.base64.length+'data:image/jpeg;base64,'.length>MAX_PUPPY_PHOTO_LENGTH) {
      context.resize({width:128,height:128});
      image.release();image=await context.renderAsync();
      saved=await image.saveAsync({format:SaveFormat.JPEG,compress:0.5,base64:true});
    }
    return puppyPhotoSchema.parse(`data:image/jpeg;base64,${saved.base64}`);
  } finally {image?.release();context.release();}
}
