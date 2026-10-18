import { identifierSchema, localIdSchema, type CloudRecord, type RecordKind } from './protocol.ts';

export function cloudRecordId(kind: RecordKind, cloudPetId: string | null, localId: string): string {
  localIdSchema.parse(localId);
  if (kind === 'accountPreferences') {
    if (cloudPetId !== null || localId !== 'preferences') throw new Error('Invalid account preference identity.');
    return JSON.stringify(['accountPreferences']);
  }
  identifierSchema.parse(cloudPetId);
  if (kind === 'puppy') {
    if (localId !== cloudPetId) throw new Error('Puppy record identity must match its cloud puppy.');
    return cloudPetId!;
  }
  return JSON.stringify([kind, cloudPetId, localId]);
}

export function localRecordId(record: Pick<CloudRecord, 'id' | 'kind' | 'petId'>): string {
  let localId: string;
  if (record.kind === 'puppy') localId = record.id;
  else if (record.kind === 'accountPreferences') localId = 'preferences';
  else {
    let parts: unknown;
    try { parts = JSON.parse(record.id); } catch { throw new Error('Invalid cloud record identity.'); }
    if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== record.kind || parts[1] !== record.petId || typeof parts[2] !== 'string') {
      throw new Error('Invalid cloud record identity.');
    }
    localId = parts[2];
  }
  if (cloudRecordId(record.kind, record.petId, localId) !== record.id) throw new Error('Noncanonical cloud record identity.');
  return localId;
}

export function fieldPatch(before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, unknown> {
  const previous = before ?? {};
  return Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(after[key]))
    .map((key) => [key, after[key] === undefined ? null : after[key]]));
}
