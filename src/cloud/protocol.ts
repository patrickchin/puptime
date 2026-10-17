import { z } from 'zod';

import { eventTypes } from '../domain.ts';

const timestamp = z.number().int().min(-8640000000000000).max(8640000000000000);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
// Existing CSV records can have user-supplied IDs. SQL binds them as values.
const recordId = z.string().min(1).max(256).refine((value) => !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const label = z.string().trim().min(1).max(256);
const eventFields = {
  type: z.enum(eventTypes), at: timestamp, endedAt: timestamp.nullable().optional(),
  customLabel: label.optional(), note: z.string().max(16384).optional(),
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
const routineFields = { type: z.enum(eventTypes), customLabel: label.optional(), minutes: z.number().int().min(0).max(1439), reminder: z.boolean().optional(), toleranceMinutes: z.number().int().min(0).max(1440).optional() };
const routineObject = z.strictObject(routineFields);
const routine = routineObject.refine((data) => data.type !== 'custom' || !!data.customLabel, 'Custom activity requires a label.');
const customization = z.strictObject({ activityKey: z.string().min(1).max(264), name: label.optional(), emoji: z.string().max(16).optional(), color: z.number().int().min(0).max(6).optional() });
const customActivity = z.strictObject({ label });
const accountPreferences = z.strictObject({
  theme: z.enum(['system', 'puppy-journal', 'soft-play', 'day-trails']).optional(),
  language: z.enum(['system', 'en', 'zh-Hans', 'es']).optional(),
  widgetActions: z.array(z.string().min(1).max(264)).min(2).max(4).refine((values) => new Set(values).size === values.length).optional(),
  reminderLeadMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), z.literal(30)]).optional(),
  widgetConfirmations: z.boolean().optional(),
  pottyAfterPeeEnabled: z.boolean().optional(), pottyAfterMealEnabled: z.boolean().optional(),
  pottyAfterPeeDelayMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(120), z.literal(180), z.literal(240)]).optional(),
  pottyAfterMealDelayMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(120), z.literal(180), z.literal(240)]).optional(),
});
const schemas = { event: eventDataSchema, puppy, routine, customActivity, customization, accountPreferences };
export type RecordKind = keyof typeof schemas;
export type RecordData = z.infer<(typeof schemas)[RecordKind]>;
export function recordDataSchema(kind: RecordKind) { return schemas[kind]; }
const common = {
  protocolVersion: z.literal(1), operationId: identifier, deviceId: identifier,
  recordId, petId: identifier.nullable(), baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  intent: z.enum(['create', 'patch', 'delete', 'restore']),
};
const eventPatch = eventObject.partial().extend({ note: eventFields.note.nullable(), customLabel: eventFields.customLabel.nullable() });
export const mutationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('event'), patch: eventPatch }),
  z.strictObject({ ...common, kind: z.literal('puppy'), patch: puppy.partial() }),
  z.strictObject({ ...common, kind: z.literal('routine'), patch: routineObject.partial().extend({ customLabel: label.nullable().optional(), reminder: z.boolean().nullable().optional(), toleranceMinutes: z.number().int().min(0).max(1440).nullable().optional() }) }),
  z.strictObject({ ...common, kind: z.literal('customActivity'), patch: customActivity.partial() }),
  z.strictObject({ ...common, kind: z.literal('customization'), patch: customization.partial().extend({ name: label.nullable().optional(), emoji: z.string().max(16).nullable().optional(), color: z.number().int().min(0).max(6).nullable().optional() }) }),
  z.strictObject({ ...common, kind: z.literal('accountPreferences'), patch: accountPreferences }),
]).superRefine((mutation, context) => {
  if ((mutation.kind === 'accountPreferences') !== (mutation.petId === null)
    || (mutation.kind === 'puppy' && mutation.recordId !== mutation.petId)
    || (mutation.intent === 'delete' ? Object.keys(mutation.patch).length !== 0 : Object.keys(mutation.patch).length === 0)) {
    context.addIssue({ code: 'custom', message: 'Invalid record scope or mutation patch.' });
  }
});
export type Mutation = z.infer<typeof mutationSchema>;
export type CloudRecord = {
  id: string; petId: string | null; kind: RecordKind; data: RecordData;
  revision: number; sequence: number; deleted: boolean; updatedAt: number;
};
export type RevisionReason = 'created' | 'updated' | 'merged' | 'deleted' | 'preserved-deletion' | 'restored' | 'preserved-timing' | 'inferred-nap-end';
export type Revision = {
  recordId: string; revision: number; sequence: number; operationId: string; deviceId: string;
  acceptedAt: number; baseRevision: number; intent: Mutation['intent']; proposal: Mutation['patch'];
  before: CloudRecord | null; after: CloudRecord; reason: RevisionReason;
};
export type MutationResult = { operationId: string; record: CloudRecord; sequence: number; reason: RevisionReason };
export type PullPage = { changes: CloudRecord[]; cursor: number; hasMore: boolean };
