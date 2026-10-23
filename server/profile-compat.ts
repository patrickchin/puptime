import type { CloudRecord, Revision } from '../src/cloud/protocol';

// Pre-photo clients validate strict profile schemas. Project the same revision
// identities and cursors onto the fields those clients can represent.
export function legacyProfile(record:CloudRecord):CloudRecord {
  if(record.kind!=='puppy')return record;
  const data={...record.data};delete (data as Record<string,unknown>).photoId;
  return {...record,data};
}
export function legacyProfileRevision(revision:Revision):Revision {
  if(revision.after.kind!=='puppy')return revision;
  const proposal:Record<string,unknown>={...revision.proposal};delete proposal.photoId;
  if(!Object.keys(proposal).length&&revision.intent!=='delete')proposal.name=(revision.after.data as {name:string}).name;
  return {...revision,before:revision.before?legacyProfile(revision.before):null,after:legacyProfile(revision.after),proposal:proposal as Revision['proposal']};
}
