# iOS Transactional Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, TDD and one fresh whole-branch review. The user has already authorized autonomous implementation; continue without another routine handoff.

**Goal:** Add an owner-bound, restartable local outbox and pull/rebase engine, preserving free offline logging and all original local identities.

**Architecture:** Extend the existing serialized Expo SQLite transaction boundary. Existing event/routine/settings mutators report their committed field changes through one optional transaction callback; account-free storage uses the same APIs without producing operations. The engine stores association, exact pending mutations, acknowledged server records and cursor durably, and projects remote state with pending local changes reapplied. This subsystem has no login UI or network scheduling; the next plan connects the official Better Auth Expo client and HTTP runner to these tested interfaces.

**Tech Stack:** Existing TypeScript, Expo SQLite, Zod and Node test runner with real SQLite adapters. Existing version-1 cloud protocol and reconciliation code. No new state-management or synchronization library.

**Spec:** `docs/superpowers/specs/2026-10-17-accounts-sync-design.md`, with the user's later iOS-app-first scope recorded in `docs/superpowers/plans/2026-10-17-cloud-rollout.md`.

## Global Constraints

- Free local use remains account-free and offline; signing in alone never uploads, associates a puppy or starts a trial.
- Use free service tiers only. No paid upgrades, real charges, public price or domain changes.
- One puppy in the UI; every local record/association remains pet-scoped and tests cover two pets.
- Preserve existing IDs, timestamps, notes, estimate provenance, custom labels, routines and manual nap history. Do not add nap-specific behavior or inferred completion.
- Account switching cannot reassign queued work. Sign-out requires the later UI's pending-work confirmation, then detaches the profile while retaining local history and cloud data.
- Same-puppy confirmation is mandatory before joining an existing cloud puppy. No association based merely on a session.
- Expiry/authentication failures pause transport, not local saves. Never report synced with pending or invalid work.
- OS permission, notification IDs, widget placement and Notify on this device remain local. Widget replacement and Android activation are deferred.
- Submit and merge through a reviewed GitHub PR. No direct main push.

## Review Focus

1. A response arrives after sign-out/account switch: it must not acknowledge or apply anything to the new owner (Tasks 3–4).
2. A local edit occurs while a request is in flight: acknowledging that request must preserve the later edit and pending operation (Task 4).
3. Legacy IDs collide across puppies/kinds or contain Unicode/quotes: cloud identities remain distinct and local IDs round-trip exactly (Task 1).
4. A locally valid legacy value exceeds cloud constraints: the local save remains committed, cloud status reports blocked work, and no truncated value is uploaded (Tasks 2–3).
5. A transaction fails after local projection/ack but before cursor update: all of it rolls back and retry produces the same result (Tasks 3–4).

## File and interface map

- `src/cloud/record-identity.ts`: reversible cloud record identifiers and field-difference helper.
- `src/cloud/protocol.ts`, `server/account-routes.ts`, `server/account-store.ts`: bounded encoded record IDs and shared response validation; preserve protocol version 1 because payload semantics are unchanged and no production client exists.
- `src/local/sync-projection.ts`: convert existing SQL events/routines/settings to typed records, apply projected records to those same tables, preserve the original local IDs.
- `src/local/sync-engine.ts`: schema, association generation, pending mutations, baseline staging, atomic acknowledgments and pull/rebase.
- `src/local/repository.ts`, `src/local/native-storage.ts`: optional transaction change sink; no callback after commit and no nested database queue calls.
- `src/local/*.test.ts`, `src/cloud/*.test.ts`, `server/*.test.ts`: real SQL and protocol regressions.
- `docs/cloud-verification.md`: exact executed evidence and remaining native/network gates.

### Task 1: Lossless scoped cloud identity and response validation

**Files:** Create `src/cloud/record-identity.ts`, its test; modify `src/cloud/protocol.ts`, `server/account-routes.ts`, `server/account-store.ts` and relevant server tests.

**Interfaces:**
- `cloudRecordId(kind: RecordKind, cloudPetId: string | null, localId: string): string`: puppy ID equals cloudPetId; preferences use `JSON.stringify(['accountPreferences'])`; other kinds use `JSON.stringify([kind, cloudPetId, localId])`.
- `localRecordId(record: Pick<CloudRecord, 'id' | 'kind' | 'petId'>): string`: validate canonical encoding/kind/pet and return the original local ID; reject malformed/mismatched encodings rather than guessing.
- `fieldPatch(before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, unknown>`: changed fields only; explicit null for removed optional fields. Ordered arrays are one field.
- Export `cloudRecordSchema`, `mutationResultSchema`, `pullPageSchema` and `pushResponseSchema`; validate data by its discriminated kind, integer revision/sequence, unique operation IDs and bounded pages. Keep exported TypeScript types inferred/consistent.

- [x] RED: add identity round-trip assertions for a 256-character local ID, quotes/backslashes/Unicode, event vs routine same ID, identical IDs in two pets, preference/puppy namespace boundaries, malformed tuple and mismatched scope. Assert exact local ID preservation and distinct cloud IDs. Field diff tests assert `{note:null}` for a removed note and no patch for a semantic no-op.
- [x] RED: shared response validation rejects unknown kinds, invalid per-kind data, negative/unsafe cursor, mismatched pet scope and duplicate operation results. Existing server tests verify encoded IDs longer than 256 are accepted and history works through URL-encoded IDs.
- [x] Run `node --test src/cloud/record-identity.test.ts src/cloud/protocol.test.ts` and the affected Workers test. Expect failures before implementation.
- [x] GREEN: implement the codecs with JSON and existing Zod schemas. Increase the shared record-ID cap to 2048 characters, use it in the history route, retain request body/batch limits. Limit decoded local IDs to 256 characters; larger existing local IDs remain local and become an explicit cloud validation issue in Task 3. Do not silently re-ID records.
- [x] Run `npm test`, `npm run test:server`, both typechecks. Commit `feat: preserve scoped local identities in cloud records`.

### Task 2: Transactional local projection and change capture

**Files:** Create `src/local/sync-projection.ts` and its test; modify `src/local/repository.ts`, `src/local/native-storage.ts` and their tests.

**Interfaces:**
- `LocalRecord = {kind: RecordKind; localId: string; data: Record<string, unknown>}` (pet scope is the explicit method argument).
- `LocalChange = {kind: RecordKind; localId: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null}`.
- `LocalChangeSink = (sql: SqlExecutor, changes: LocalChange[]) => Promise<void>`.
- `createLocalRepository(database, petId, onChange?: LocalChangeSink)` and `createNativeStorage(database, petId, onChange?: LocalChangeSink)` retain every existing public return shape.
- `readLocalRecords(sql: SqlExecutor, petId: string): Promise<LocalRecord[]>` snapshots events/routines/puppy/custom activities/customizations/account preferences without calling a queued repository method.
- `applyLocalRecords(sql: SqlExecutor, petId: string, records: LocalRecord[], deleted: Array<{kind:RecordKind;localId:string}>): Promise<void>` writes validated projections directly; it never emits new local operations.

- [x] RED: actual facade append/edit/remove/import, routine replace, puppy rename and preference/custom-activity changes call the sink inside the same transaction with only changed records/fields. A throwing sink rolls back the associated local change; a no-op or duplicate import creates no work. Without a sink, existing compatibility tests remain unchanged.
- [x] RED: full snapshot→projection round-trip preserves event IDs/estimates/optional fields and routine IDs, deletes a custom activity without deleting historical labels, and isolates two pets. Preferences flatten existing reminder subfields and preserve independent merging; no OS/device permission state is represented. Onboarding completion never appears in a cloud record.
- [x] Run the affected Node tests; expect missing APIs/failing assertions.
- [x] GREEN: reuse existing validators/normalizers and SQL helpers. Repository mutation loops already know old/new rows; report changes there instead of scanning all history again. Settings operations compute before/after typed values inside their existing transaction, emitting one combined set after composite updates. Add a transactional puppy-name API for later UI. Read-derived custom labels must not accidentally create a cloud mutation merely by opening a screen.
- [x] Run `npm test` and app typecheck. Commit `feat: capture iOS data changes at the SQLite transaction boundary`.

### Task 3: Owner-bound association and restartable initial upload

**Files:** Create `src/local/sync-engine.ts` and its test; extend the versioned schema migration in `src/local/database.ts`.

**Interfaces:**
- `createLocalSync(database: LocalDatabase, options?: {newId?:()=>string; now?:()=>number})` produces the methods below and `changeSink(petId: string): LocalChangeSink`.
- `prepareAssociation(input: {accountId:string; localPetId:string; deviceId:string; enrollment:Enrollment}): Promise<{generation:string}>` stores a durable enrollment attempt but creates no upload work and changes no existing profile owner.
- `enrollmentState():Promise<({generation:string;accountId:string;request:Enrollment;stagingCursor:number;baselineComplete:boolean})|null>` exposes the saved immutable request/cursor for process-restart recovery.
- `stageBaseline(input: {generation:string; accountId:string; page:PullPage}): Promise<void>` stores validated full-baseline pages without replacing local tables. Require cursor progress and a final page before completion.
- `completeAssociation(input: {generation:string; accountId:string; cloudPetId:string}): Promise<void>` binds ownership, snapshots current local records and materializes initial mutations atomically. The caller supplies only a successful enrollment response after the explicit confirmation/trial UI; this method performs no network request.
- `detach(input:{generation:string;accountId:string}):Promise<void>` removes association, pending work, server mirrors and staging for that generation, while retaining all local history/settings/legacy copies. No same-pet owner reassignment in place.
- `status(petId:string):Promise<{state:'local'|'preparing'|'active'|'resyncing';generation:string|null;accountId:string|null;pending:number;blocked:number;cursor:number}>` contains no credentials or record contents.
- `nextBatch(input:{generation:string;accountId:string}):Promise<Mutation[]>` returns at most 50 valid immutable queued operations whose JSON request UTF-8 size stays below 65536 bytes. Preserve queue order; return no batch for a mismatched owner.

- [x] RED: free local edits produce no upload backlog; prepare alone also produces none. Completing an empty-account baseline queues exact full local contents once, including edits made after prepare. Reopening the SQL database resumes the same attempt/operation IDs. A record501 queue failure rolls back association and the entire materialization.
- [x] RED: joining an existing puppy uses only a completed staged baseline, retains remote-only records, combines same-ID local fields with the remote record and queues patches against its revision rather than a duplicate create. Local optional-field absence does not clear cloud values during initial combination. Existing cloud preferences win over local defaults; name `My puppy` does not replace an existing cloud name. Missing/foreign/incomplete generation cannot bind or detach anything.
- [x] RED: live cloud-enabled edits append immutable exact field patches; later local edits do not rewrite in-flight payloads. Expiry is a transport concern and does not make the local sink fail. A note/ID beyond cloud limits still saves locally and creates a blocked operation/diagnostic row; status cannot say synced, valid independent work still batches, and no raw note/name is included in the diagnostic reason. A later corrective edit supersedes only unsent blocked work for that record.
- [x] RED: batch packing uses UTF-8 bytes (including Unicode and long notes), stops below the server body limit, and never starves an oversized blocked record's valid neighbors. Two pets/accounts remain isolated.
- [x] Run targeted tests; expect missing engine/schema failures.
- [x] GREEN: add schema version 3 tables for a single device/profile account owner + generation, per-puppy enrollment/binding, retained local revisions, outbox/server-mirror/staging/blocked work, with indexed owner+generation keys and foreign keys. The account cursor and account preferences belong to the owner, not a puppy. Two puppy bindings for one account share the generation; a different account requires explicit detach of the owner first. Only one enrollment/baseline attempt may be pending per owner, and its original request is immutable. `detach` clears all cloud associations for that owner, preserving every local puppy. Upgrade existing schema 1/2 without reading or replacing the legacy snapshot. Use SQLite random identifiers unless tests inject IDs. Deferred widget branch's unshipped schema3 must be reconciled to the final schema before any future merge; do not cherry-pick it blindly.
- [x] GREEN: finish the association and change-sink methods using Task 2 transaction helpers. Keep queued mutation JSON immutable and parsed/validated before network eligibility. No tokens in these tables. Reject malformed saved state instead of defaulting it to empty.
- [x] Run `npm test` and both typechecks. Commit `feat: add restartable owner-bound local cloud outbox`.

### Task 4: Atomic acknowledgment, pull and local rebase

**Files:** Extend `src/local/sync-engine.ts` and tests; reuse `src/cloud/reconcile.ts` for accepted/deleted/timing behavior.

**Interfaces:**
- `applySync(input:{generation:string;accountId:string;accepted:MutationResult[];rejected?:Array<{operationId:string;error:'conflict'|'invalid_mutation'|'retry_later'}>;page:PullPage}):Promise<void>` validates ownership and every response before committing exact-ID acknowledgments, server mirrors, rebased local projections and cursor together.
- `resetBaseline(input:{generation:string;accountId:string}):Promise<void>` resets pull staging/cursor for a full resync while preserving local pending edits; full replacement commits only when a complete staged baseline is available.
- `resyncState():Promise<({generation:string;accountId:string;stagingCursor:number;baselineComplete:boolean})|null>` exposes resumable full-pull progress. `finishResync(input:{generation:string;accountId:string}):Promise<void>` atomically replaces mirrors/projects only after `stageBaseline` has persisted the final page.
- `restore(input:{generation:string;accountId:string;record:CloudRecord;data:Record<string,unknown>}):Promise<void>` queues an explicit restore against the current revision and projects the validated restored data; a stale deletion revision rejects. Pending writes for that same record must be acknowledged before a restore can be queued, since their server acceptance changes the required revision.

- [x] RED: local edit A goes in flight, local edit B follows, server accepts A plus a different-field edit from another client; applying the response removes A only and displays B plus the other client's field. Duplicate responses are idempotent. Unknown acknowledgment IDs, mismatched record identity or future/regressing cursors fail without modifying local state.
- [x] RED: delete beats a stale local patch; pending work cannot resurrect it. Explicit restore requires the current deletion revision and creates new work. Estimate provenance stays true, and invalid historical timing follows the shared preserve-valid-timing rule without blocking other records. No new nap inference.
- [x] RED: use two separate real SQL client databases and actual shared reconciliation code to exercise independent adds, same-field ordering, delete/offline edit, restart between server commit/local ack, full resync and account detach while response is in flight. This is deterministic engine integration; report it separately from the later HTTP/Expo-runtime check.
- [x] RED: confirmed initial-create conflict becomes a fresh operation/field patch only after pulling current state; keep original payload/result receipt, make repeated rejection responses idempotent, retain retryable payloads, and block invalid/restoration-conflict work without starving other records.
- [x] RED: an unchanged 1,000-event projection retains all cached objects and writes no event rows; one edit writes only that row and retains 999 references. Empty new records must still fail validation.
- [x] RED: SQL trigger failure after projection/ack but before cursor commit rolls back every effect; remove the trigger and retry yields the exact result. Applying an old generation after detach/re-enroll is a safe no-op with no data/queue changes.
- [x] Run targeted tests; expect failures for unimplemented apply/restore behavior.
- [x] GREEN: apply validated server state to mirrors, remove only known accepted IDs matching the saved immutable payload identity, then overlay remaining pending patches in operation order using the existing reconciliation rules and project through Task 2. Never advance the pull cursor from a push sequence alone. Keep transport retry/error scheduling out of this engine.
- [x] Run `npm test`, Workers tests, both typechecks and an iOS export. Commit `feat: rebase pending local edits during atomic cloud apply`.

### Task 5: Review, merge and native transport handoff

- [ ] Self-review spec coverage and five Review Focus items; ensure each has an executed regression. Document any ruling and exact checks in this plan's ledger.
- [ ] Fresh whole-branch reviewer checks transactions/identity/ownership/response trust and tests. Fix material findings with RED→GREEN evidence and rerun the affected/full suite.
- [ ] Create/attach a GitHub PR; require applicable CI to pass, then merge through GitHub. Update `docs/cloud-verification.md` with executed engine evidence, explicitly leaving actual network, native runtime and provider-login gates unchecked.
- [ ] Write the next precise iOS client plan: official Better Auth Expo/SecureStore, authenticated bounded HTTP runner, explicit enrollment flow, AppState/Expo Network triggers/backoff, active-only invalidation subscription, nonintrusive Settings status and Maestro staging journeys. Native UI is not advertised as synced until this next phase is qualified.

## Self-review

Scope intentionally ends at a transaction-safe engine with deterministic SQL integration tests. Identity provider configuration, payment, telemetry and UI remain in later named rollout phases; Android/widget replacement remains deferred. All five Review Focus conditions map to explicit failure tests above. Existing module entry points keep the free app behavior until the iOS client integration wires `changeSink` and transport together. No new service or dependency is required for this phase.
