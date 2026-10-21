import { z } from 'zod';

import { customActivityKey, eventTypes, isQuickEventType, normalizeCustomLabel } from '../domain.ts';
import { activityEmojis } from '../activity-customization.ts';

const timestamp = z.number().int().min(-8640000000000000).max(8640000000000000);
export const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const localIdSchema = z.string().min(1).max(256).refine((id) => !!id.trim() && !/[\u0000-\u001f\u007f]/.test(id));
// Existing CSV records can have user-supplied IDs. SQL binds them as values.
export const recordIdSchema = z.string().min(1).max(2048).refine((value) => !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const label = z.string().trim().min(1).max(256);
const customLabel = z.string().trim().min(1).max(40);
const activityKey = z.string().refine((value) => isQuickEventType(value) || (value.startsWith('custom:')
  && !!normalizeCustomLabel(value.slice(7)) && value === customActivityKey(value.slice(7))), 'Unsupported activity key.');
const eventFields = {
  type: z.enum(eventTypes), at: timestamp, endedAt: timestamp.nullable().optional(),
  customLabel: customLabel.optional(), note: z.string().max(16384).optional(),
  source: z.enum(['app', 'widget']), estimated: z.boolean().optional(),
};
const eventObject = z.strictObject(eventFields);
export const eventDataSchema = eventObject.superRefine((event, context) => {
  if ((event.endedAt !== undefined && (event.type !== 'nap' || (event.endedAt !== null && event.endedAt < event.at)))
    || (event.type === 'custom' && !event.customLabel)) {
    context.addIssue({ code: 'custom', message: 'Activity timing or custom label is invalid.' });
  }
});
const puppy = z.strictObject({ name: label });
const routineFields = { type: z.enum(eventTypes), customLabel: customLabel.optional(), minutes: z.number().int().min(0).max(1439), reminder: z.boolean().optional(), toleranceMinutes: z.number().int().min(0).max(1440).optional() };
const routineObject = z.strictObject(routineFields);
export const routineDataSchema = routineObject.refine((data) => data.type !== 'custom' || !!data.customLabel, 'Custom activity requires a label.');
const customization = z.strictObject({ activityKey, name: customLabel.optional(), emoji: z.enum(activityEmojis).optional(), color: z.number().int().min(0).max(6).optional() });
const customActivity = z.strictObject({ label: customLabel });
const accountPreferences = z.strictObject({
  theme: z.enum(['system', 'light', 'dark', 'puppy-journal', 'soft-play', 'day-trails']).optional(),
  language: z.enum(['system', 'en', 'zh-Hans', 'es']).optional(),
  widgetActions: z.array(activityKey).min(2).max(4).refine((values) => new Set(values).size === values.length).optional(),
  reminderLeadMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), z.literal(30)]).optional(),
  widgetConfirmations: z.boolean().optional(),
  pottyAfterPeeEnabled: z.boolean().optional(), pottyAfterMealEnabled: z.boolean().optional(),
  pottyAfterPeeDelayMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(120), z.literal(180), z.literal(240)]).optional(),
  pottyAfterMealDelayMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(120), z.literal(180), z.literal(240)]).optional(),
});
const schemas = { event: eventDataSchema, puppy, routine: routineDataSchema, customActivity, customization, accountPreferences };
export type RecordKind = keyof typeof schemas;
export type RecordData = z.infer<(typeof schemas)[RecordKind]>;
export function recordDataSchema<Kind extends RecordKind>(kind: Kind): typeof schemas[Kind] { return schemas[kind]; }
const common = {
  protocolVersion: z.literal(1), operationId: identifierSchema, deviceId: identifierSchema,
  recordId: recordIdSchema, petId: identifierSchema.nullable(), baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  intent: z.enum(['create', 'patch', 'delete', 'restore']),
};
const eventPatch = eventObject.partial().extend({ note: eventFields.note.nullable(), customLabel: eventFields.customLabel.nullable() });
export const mutationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('event'), patch: eventPatch }),
  z.strictObject({ ...common, kind: z.literal('puppy'), patch: puppy.partial() }),
  z.strictObject({ ...common, kind: z.literal('routine'), patch: routineObject.partial().extend({ customLabel: customLabel.nullable().optional(), reminder: z.boolean().nullable().optional(), toleranceMinutes: z.number().int().min(0).max(1440).nullable().optional() }) }),
  z.strictObject({ ...common, kind: z.literal('customActivity'), patch: customActivity.partial() }),
  z.strictObject({ ...common, kind: z.literal('customization'), patch: customization.partial().extend({ name: customLabel.nullable().optional(), emoji: z.enum(activityEmojis).nullable().optional(), color: z.number().int().min(0).max(6).nullable().optional() }) }),
  z.strictObject({ ...common, kind: z.literal('accountPreferences'), patch: accountPreferences }),
]).superRefine((mutation, context) => {
  if ((mutation.kind === 'accountPreferences') !== (mutation.petId === null)
    || (mutation.kind === 'puppy' && mutation.recordId !== mutation.petId)
    || (mutation.intent === 'delete' ? Object.keys(mutation.patch).length !== 0 : Object.keys(mutation.patch).length === 0)) {
    context.addIssue({ code: 'custom', message: 'Invalid record scope or mutation patch.' });
  }
});
export type Mutation = z.infer<typeof mutationSchema>;
const revisionReasons = ['created', 'updated', 'merged', 'deleted', 'preserved-deletion', 'restored', 'preserved-timing', 'inferred-nap-end'] as const;
const recordMetadata = {
  id: recordIdSchema, petId: identifierSchema.nullable(),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  deleted: z.boolean(), updatedAt: timestamp,
};
export const cloudRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...recordMetadata, kind: z.literal('event'), data: eventDataSchema }),
  z.strictObject({ ...recordMetadata, kind: z.literal('puppy'), data: puppy }),
  z.strictObject({ ...recordMetadata, kind: z.literal('routine'), data: routineDataSchema }),
  z.strictObject({ ...recordMetadata, kind: z.literal('customActivity'), data: customActivity }),
  z.strictObject({ ...recordMetadata, kind: z.literal('customization'), data: customization }),
  z.strictObject({ ...recordMetadata, kind: z.literal('accountPreferences'), data: accountPreferences }),
]).refine((record) => (record.kind === 'accountPreferences') === (record.petId === null)
  && (record.kind !== 'puppy' || record.id === record.petId), 'Invalid record scope.');
// Reconciliation constructs a provisional revision-zero record before the
// store assigns committed metadata. Network responses use the stricter schema.
export type CloudRecord = {
  id: string; petId: string | null; kind: RecordKind; data: RecordData;
  revision: number; sequence: number; deleted: boolean; updatedAt: number;
};
export type RevisionReason = typeof revisionReasons[number];
export const mutationResultSchema = z.strictObject({
  operationId: identifierSchema, record: cloudRecordSchema,
  sequence: recordMetadata.sequence, reason: z.enum(revisionReasons),
}).refine((result) => result.sequence === result.record.sequence, 'Mismatched acknowledgment sequence.');
export const pullPageSchema = z.strictObject({
  changes: z.array(cloudRecordSchema).max(100),
  cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), hasMore: z.boolean(),
  resyncRequired: z.boolean().optional(),
}).refine((page) => page.resyncRequired
  ? !page.changes.length && page.cursor === 0 && !page.hasMore
  : (!page.hasMore || page.changes.length > 0)
    && (page.changes.length === 0 || page.changes.at(-1)!.sequence === page.cursor)
    && page.changes.every((record, index) => index === 0 || record.sequence > page.changes[index - 1].sequence),
'Invalid change cursor or page order.');
export const pushResponseSchema = z.strictObject({
  accepted: z.array(mutationResultSchema).max(50),
  rejected: z.array(z.strictObject({ operationId: identifierSchema, error: z.enum(['conflict', 'invalid_mutation', 'retry_later']) })).max(50),
}).refine((response) => {
  const ids = [...response.accepted, ...response.rejected].map((result) => result.operationId);
  return ids.length <= 50 && new Set(ids).size === ids.length;
}, 'Invalid or duplicate operation results.');
export type Revision = {
  recordId: string; revision: number; sequence: number; operationId: string; deviceId: string;
  acceptedAt: number; baseRevision: number; intent: Mutation['intent']; proposal: Mutation['patch'];
  before: CloudRecord | null; after: CloudRecord; reason: RevisionReason;
};
export const revisionSchema = z.strictObject({
  recordId: recordIdSchema, revision: recordMetadata.revision, sequence: recordMetadata.sequence,
  operationId: identifierSchema, deviceId: identifierSchema, acceptedAt: timestamp,
  baseRevision: common.baseRevision, intent: common.intent, proposal: z.record(z.string(), z.unknown()),
  before: cloudRecordSchema.nullable(), after: cloudRecordSchema, reason: z.enum(revisionReasons),
}).refine(({recordId,revision,sequence,baseRevision,intent,before,after}) =>
  recordId === after.id && revision === after.revision && sequence === after.sequence
  && (before
    ? before.id === recordId && before.petId === after.petId && before.kind === after.kind
      && before.revision + 1 === revision && before.sequence < sequence && baseRevision <= before.revision
      && (intent !== 'restore' || baseRevision === before.revision)
    : revision === 1 && baseRevision === 0 && intent === 'create'),
'Invalid revision identity or committed order.').transform((value, context) => {
  const proposal = mutationSchema.safeParse({protocolVersion:1,operationId:value.operationId,deviceId:value.deviceId,
    recordId:value.recordId,petId:value.after.petId,kind:value.after.kind,baseRevision:value.baseRevision,
    intent:value.intent,patch:value.proposal});
  if (!proposal.success) {context.addIssue({code:'custom',message:'Invalid revision proposal.'});return z.NEVER;}
  return {...value,proposal:proposal.data.patch};
});
export type MutationResult = Omit<z.infer<typeof mutationResultSchema>, 'record'> & { record: CloudRecord };
export type PullPage = Omit<z.infer<typeof pullPageSchema>, 'changes'> & { changes: CloudRecord[] };


export const enrollmentSchema = z.strictObject({
  operationId: identifierSchema, deviceId: identifierSchema, localPetId: identifierSchema, name: label,
  confirmedPetId: identifierSchema.optional(),
});
export type Enrollment = z.infer<typeof enrollmentSchema>;
