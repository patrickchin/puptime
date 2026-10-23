import { z } from 'zod';

// A small, self-contained avatar survives cache eviction and uses existing
// offline profile sync, including its 64 KiB request limit.
export const MAX_PUPPY_PHOTO_LENGTH = 32768;
export const puppyPhotoSchema = z.string().max(MAX_PUPPY_PHOTO_LENGTH)
  .regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/)
  .refine(value => (value.length - 'data:image/jpeg;base64,'.length) % 4 === 0, 'Invalid JPEG encoding.');
export type PuppyProfile = { name: string; photo?: string };
