import { z } from 'zod';
import { eventTypes } from '../src/domain';
import { identifierSchema, localIdSchema, type CloudRecord, type RecordKind } from '../src/cloud/protocol';

export type ResourceKind = RecordKind;
export const resourceKindSchema = z.enum(['event', 'routine', 'puppy', 'customActivity', 'customization', 'accountPreferences']);
const cursor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.number().int().min(-8640000000000000).max(8640000000000000);
export const resourceListSchema = z.strictObject({
  kind: resourceKindSchema, petId: identifierSchema.nullable(), limit: z.number().int().min(1).max(100),
  after: cursor.optional(), since: timestamp.optional(), until: timestamp.optional(), type: z.enum(eventTypes).optional(),
}).refine(value => (value.kind === 'event' || (value.since === undefined && value.until === undefined && value.type === undefined))
  && (value.kind === 'puppy' || (value.kind === 'accountPreferences') === (value.petId === null))
  && (value.since === undefined || value.until === undefined || value.since < value.until), 'Invalid resource scope or filters.');
export type ResourceListQuery = z.infer<typeof resourceListSchema>;
export type ResourceList = { records: CloudRecord[]; nextCursor: number | null };

export const resourceWriteSchema = z.strictObject({
  requestId: identifierSchema, actorId: identifierSchema, kind: resourceKindSchema,
  petId: identifierSchema.nullable(), localId: localIdSchema.optional(),
  intent: z.enum(['create', 'patch', 'delete', 'restore']), expectedRevision: cursor.optional(),
  patch: z.record(z.string(), z.unknown()),
}).refine(value => (value.kind !== 'accountPreferences' || (value.petId === null && (value.localId === undefined || value.localId === 'preferences')))
  && (value.kind === 'accountPreferences' || value.kind === 'puppy' || value.petId !== null)
  && (value.intent === 'create' || (value.localId !== undefined && value.expectedRevision !== undefined))
  && (value.intent !== 'create' || value.expectedRevision === undefined || value.expectedRevision === 0)
  && (value.kind !== 'puppy' || value.petId === null || value.localId === undefined || value.petId === value.localId)
  && (value.kind !== 'puppy' || !['delete', 'restore'].includes(value.intent)), 'Invalid resource identity or precondition.');
export type ResourceWrite = z.infer<typeof resourceWriteSchema>;
export type ResourceWriteResult = { ok: true; record: CloudRecord }
  | { ok: false; error: 'not_found' | 'conflict' | 'precondition_failed' | 'invalid_request'; message: string };
