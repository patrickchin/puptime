import {z} from 'zod';
import {cloudRecordSchema,identifierSchema,localIdSchema,recordPatchSchema} from './cloud/protocol.ts';

export const shareIdSchema=z.string().regex(/^shr_[a-f0-9]{32}$/);
export const inviteTokenSchema=z.string().regex(/^inv_[a-f0-9]{32}$/);
export const createShareSchema=z.strictObject({id:shareIdSchema,token:inviteTokenSchema,petId:identifierSchema,
  kind:z.enum(['household','temporary']),permission:z.enum(['contribute','view']),
  expiresAt:z.number().int().nullable(),label:z.string().trim().min(1).max(80),
}).refine(value=>value.kind==='household'?value.expiresAt===null&&value.permission==='contribute':value.expiresAt!==null,'Invalid sharing options.');
export type CreateShare=z.infer<typeof createShareSchema>;
export const shareSchema=z.strictObject({id:shareIdSchema,petId:identifierSchema,kind:z.enum(['household','temporary']),
  permission:z.enum(['contribute','view']),label:z.string(),expiresAt:z.number().nullable(),inviteExpiresAt:z.number(),
  memberName:z.string().nullable(),accepted:z.boolean(),revoked:z.boolean(),createdAt:z.number()});
export type PuppyShare=z.infer<typeof shareSchema>;
export const shareListSchema=z.strictObject({shares:z.array(shareSchema).max(100)});
export const acceptShareSchema=z.strictObject({id:shareIdSchema,token:inviteTokenSchema,name:z.string().trim().max(80).optional()});
export const careWriteSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('event'),requestId:identifierSchema,localId:localIdSchema,intent:z.enum(['create','patch','delete']),expectedRevision:z.number().int().min(0).optional(),patch:recordPatchSchema('event')}),
  z.strictObject({kind:z.literal('routine'),requestId:identifierSchema,localId:localIdSchema,intent:z.enum(['create','patch','delete']),expectedRevision:z.number().int().min(0).optional(),patch:recordPatchSchema('routine')}),
]);
export type CareWrite=z.infer<typeof careWriteSchema>;
export const careRowSchema=z.object({record:cloudRecordSchema,localId:z.string(),canEdit:z.boolean()});
export type CareRow=z.infer<typeof careRowSchema>;
export const carePageSchema=z.object({puppyName:z.string(),records:z.array(careRowSchema).max(50),nextCursor:z.number().nullable(),share:shareSchema,ownerName:z.string(),actorName:z.string()});
export type CarePage=z.infer<typeof carePageSchema>;
export const sharedPuppiesSchema=z.object({puppies:z.array(z.object({id:shareIdSchema,name:z.string(),ownerName:z.string(),petId:identifierSchema,kind:z.enum(['household','temporary']),permission:z.enum(['contribute','view']),expiresAt:z.number().nullable()})).max(100)});
export function reuseCareRows(previous:CareRow[],next:CareRow[]){const old=new Map(previous.map(row=>[row.record.id,row]));return next.map(row=>{const saved=old.get(row.record.id);return saved&&saved.record.revision===row.record.revision&&saved.canEdit===row.canEdit?saved:row;});}
export const careNote=(note:string|undefined)=>note?.replace(/(?:^|\n\n)Logged by [^\n]+$/,'')??'';
export function careEditPatch(row:CareRow|undefined,desired:Record<string,unknown>){
  if(!row)return desired;
  const before=row.record.data as Record<string,unknown>;
  return Object.fromEntries(Object.entries(desired).filter(([key,value])=>key!=='source'
    && !(key==='endedAt'&&value===null&&before.endedAt===undefined)
    && JSON.stringify(value)!==JSON.stringify(key==='note'?careNote(before.note as string|undefined):before[key])));
}
export function sharingUrl(origin:string,id:string,token:string){return `${origin}/care?invite=${shareIdSchema.parse(id)}#${inviteTokenSchema.parse(token)}`;}

export type SharedPuppy=z.infer<typeof sharedPuppiesSchema>['puppies'][number];
