import {
  eventDataSchema, mutationSchema, recordDataSchema,
  type CloudRecord, type Mutation, type RevisionReason,
} from './protocol.ts';

export class ReconciliationError extends Error {
  constructor(message: string) { super(message); this.name = 'ReconciliationError'; }
}

// Shared by server reconciliation and lossless local projection when another
// legacy field cannot yet pass cloud validation. No timestamps are inferred.
export function retainValidEventTiming(current:Record<string,unknown>,candidate:Record<string,unknown>):boolean {
  if (candidate.type!=='nap'||typeof candidate.at!=='number'||typeof candidate.endedAt!=='number'||candidate.endedAt>=candidate.at) return false;
  for (const key of ['type','at','endedAt'] as const) {
    if (key in current) candidate[key]=current[key];else delete candidate[key];
  }
  return true;
}

export function reconcileMutation(
  current: CloudRecord | null, input: Mutation, now: number,
): { record: CloudRecord; reason: RevisionReason } {
  const mutation = mutationSchema.parse(input);
  if (current && (current.id !== mutation.recordId || current.petId !== mutation.petId || current.kind !== mutation.kind)) {
    throw new ReconciliationError('Record identity and ownership cannot change.');
  }
  if (mutation.baseRevision > (current?.revision ?? 0)) throw new ReconciliationError('Base revision is ahead of this record.');
  if (mutation.intent === 'create' && (current || mutation.baseRevision !== 0)) throw new ReconciliationError('Record already exists.');
  if (!current && mutation.intent !== 'create') throw new ReconciliationError('Record does not exist.');
  if (mutation.intent === 'restore' && mutation.baseRevision !== current?.revision) {
    throw new ReconciliationError('Restore requires the current record revision.');
  }
  if (current && mutation.intent === 'delete') {
    return { record: { ...current, deleted: true, updatedAt: now }, reason: 'deleted' };
  }
  if (current?.deleted && mutation.intent === 'patch') {
    return { record: { ...current, updatedAt: now }, reason: 'preserved-deletion' };
  }
  let reason: RevisionReason = mutation.intent === 'create' ? 'created'
    : mutation.intent === 'restore' ? 'restored'
      : mutation.baseRevision < (current?.revision ?? 0) ? 'merged' : 'updated';
  const candidate: Record<string, unknown> = mutation.intent === 'patch' ? { ...current?.data } : {};
  for (const [key, value] of Object.entries(mutation.patch)) {
    if (value === undefined) continue;
    if (value === null && key !== 'endedAt') delete candidate[key];
    else candidate[key] = value;
  }
  if (mutation.kind === 'event') {
    if (current?.kind === 'event' && 'estimated' in current.data && current.data.estimated) candidate.estimated = true;
    if (candidate.type !== 'nap') delete candidate.endedAt;
    if (current && mutation.intent === 'patch' && retainValidEventTiming(current.data,candidate)) reason='preserved-timing';
    eventDataSchema.parse(candidate);
  }
  const data = recordDataSchema(mutation.kind).parse(candidate);
  return { record: {
    id: mutation.recordId, petId: mutation.petId, kind: mutation.kind, data,
    revision: current?.revision ?? 0, sequence: current?.sequence ?? 0,
    deleted: false, updatedAt: now,
  }, reason };
}
