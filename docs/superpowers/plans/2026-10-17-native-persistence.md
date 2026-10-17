# Native Transactional Persistence Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, TDD, and one fresh whole-branch review at completion.

**Goal:** Build and verify the SQLite migration/repository boundary before switching ordinary app/widget writers or enabling synchronization. This is phase 3a; phase 3b wires every existing native storage API and widget acknowledgment, and phase 3c adds the authenticated outbox/transport. The overall native persistence/sync phase remains incomplete until those follow-ups land.

**Architecture:** Use a dedicated Expo SQLite connection per runtime, with all access serialized around its supported transaction API, WAL, foreign keys and bounded lock handling. Keep SQL and migration logic platform-independent behind the small subset of that API actually used. Tests execute that SQL with Node's built-in SQLite against real temporary files, including separate connections. The native adapter uses Expo SQLite, not a custom database engine or ORM. Preserve existing public storage behavior and all nap controls/history.

**Spec:** `docs/superpowers/specs/2026-10-17-accounts-sync-design.md`. Backend contract/evidence: `docs/cloud-verification.md`.

## Scope boundaries and invariants

- No app/widget writer switches to the new database in this foundation PR. No cloud upload, automatic trial or account association.
- One initial puppy, with pet-scoped primary keys and foreign keys for events/routines from the first schema. Device/account preferences remain separate from puppy records. Later multiple puppies must not require rewriting event identities.
- Preserve event/routine IDs, exact timestamps, notes, source and estimate provenance, custom activities/deletion markers, customizations, preferences and onboarding state. Retain original AsyncStorage entries and an exact database snapshot of them; explicit future deletion must inventory both.
- Migration is atomic, versioned and repeatable. Invalid JSON or invalid events/routines aborts without a success marker or an empty replacement store. Do not silently erase unsupported legacy settings; retain raw originals and surface migration failure where necessary.
- Opening a newer schema fails clearly. Retrying an interrupted migration neither duplicates records nor overwrites subsequent SQLite changes.
- Database primitives do not select account ownership. The later sync plan must persist owner-bound association/outbox and advance acknowledgments/cursors atomically with data.
- No UI changes or claims of native runtime acceptance from Node tests. Dedicated-device app/widget migration drills occur when the native writers switch in phase 3b.

### Task 1: Shared validation and migration fixtures

**Files:** Extract `src/storage-validation.ts` from existing event validation/classes without changing behavior; add `src/local/legacy.ts`, `src/local/legacy.test.ts`, update `src/storage.ts` imports/exports and test script pattern.

- [x] Write failing tests for a complete populated legacy snapshot (including Unicode, notes, custom activities, retired custom labels, closed/open historical naps, IDs and preferences), empty install, malformed JSON, duplicate/invalid events and invalid routines. Expected RED: missing migration parser.
- [x] Extract the existing event validator and error types unchanged. Define the existing AsyncStorage key inventory once and parse snapshots without mutating originals. Keep missing settings distinguishable from explicitly saved empty values.
- [x] Run focused and existing tests/typecheck. Expected GREEN with existing storage behavior unchanged.
- [x] Commit validation/snapshot boundary.

### Task 2: Real SQLite schema and atomic migration

**Files:** Create `src/local/database.ts`, `src/local/database.test.ts`, test-only real SQLite adapter; install Expo-compatible `expo-sqlite` and create `src/local/open.native.ts`.

**Interfaces:** `LocalDatabase` is the used subset of Expo SQLite's async query/transaction API. `migrateLegacy(db, snapshot, newId)` creates schema and inserts the legacy snapshot, initial puppy, event/routine rows and settings in one transaction, then writes the schema/migration marker. Return initial puppy ID and migration status. Native initialization checks the completed marker inside the serialized transaction before lazily reading legacy values. Completed migration never re-reads legacy storage. A lock retry restarts the entire transaction.

- [x] Write failing real-SQL tests for exact migration fidelity, empty install, retry/reopen idempotency, failure after partial insertion with rollback, unsupported newer schema, pet isolation/FKs and two competing initializers. Expected RED.
- [x] Implement minimal relational schema: metadata, puppies, events, routines, settings, retained legacy snapshots. Bind values, never interpolate user data into SQL. All per-puppy IDs are composite with pet ID; account/device settings have their own table.
- [x] Configure WAL/foreign keys/busy timeout through native supported APIs. Add bounded retry only for recognized lock contention, preserving other failures. Each retry starts a fresh transaction. Keep the configured connection private; Expo’s exclusive helper creates another connection and cannot inherit connection-local foreign-key settings.
- [x] Run actual SQLite tests and typechecks. Expected GREEN. Verify adapter shape against installed Expo SQLite types; do not use type casts to pretend unsupported APIs exist.
- [x] Commit schema/migration/adapter.

### Task 3: Transactional event/routine repository

**Files:** Create `src/local/repository.ts`, `src/local/repository.test.ts`.

**Interfaces:** `createLocalRepository(db, petId)` exposes event append/import/update/delete/read and routine replace/read against that pet. Read methods return committed data. Write methods return only after commit; validation/read/modify/write occurs in the same exclusive transaction. Existing append/upsert, estimate preservation, CSV duplicate skipping and existing conflicting-open-nap import behavior remain unchanged. Do not introduce new nap handling.

- [ ] Write failing tests for CRUD, same-ID isolation across two pets, failed write/rollback and retry, concurrent app/widget connections without lost writes, atomic routine replacement, duplicate import/no-op, existing estimate/import behavior, and corrupt row rejection. Expected RED.
- [ ] Implement per-row storage and bound queries, with an event materialization cache preserving unchanged event object references across reads/edits. Test that updating one note does not replace every unchanged event object; actual populated Android render verification belongs in phase 3b.
- [ ] Run full Node and Workers suites, both typechecks and Android/iOS/web exports. Expected GREEN.
- [ ] Commit repository.

### Task 4: Review and handoff to native cutover

- [ ] Fresh whole-branch review of main..branch against this plan, addressing material findings with RED→GREEN regressions and green suite.
- [ ] Create/attach PR, wait for applicable CI, merge through GitHub. No direct main push.
- [ ] Record completed evidence and exact remaining phase 3b/3c interfaces; write the next precise plan before switching native app/widget writers.
