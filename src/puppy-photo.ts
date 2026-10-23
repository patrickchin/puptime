import { z } from 'zod';

export const MAX_PUPPY_PHOTO_BYTES = 256 * 1024;
export const puppyPhotoSchema = z.string().regex(/^img_[a-f0-9]{32}$/);
export type PuppyProfile = { name: string; photoId?: string };
export function assertPuppyPhotoBytes(bytes:Uint8Array):void {
  if(bytes.length<4||bytes.length>MAX_PUPPY_PHOTO_BYTES||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff||bytes.at(-2)!==0xff||bytes.at(-1)!==0xd9)throw new Error('Invalid profile JPEG.');
}
