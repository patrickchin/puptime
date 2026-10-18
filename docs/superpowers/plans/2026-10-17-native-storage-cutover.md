# iOS App Storage Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans inline, TDD, one fresh whole-branch review. Follow the repository's dedicated-device and screenshot gates.

**Goal:** Switch the iOS app to the verified SQLite repository while preserving existing settings and history. This is phase 3b. No cloud upload yet; phase 3c adds owner-bound association/outbox/transport after this cutover is qualified. Android and widget changes are deferred by the user.

**Architecture:** `storage.ios.ts` lazily opens the app SQLite connection and delegates to a testable `createNativeStorage(database, petId)` facade. Android and web retain their existing backend. Events/routines use the foundation repository; settings read/modify/write operations use the same serialized transaction connection. The existing widget integration is unchanged; its replacement remains on the unmerged deferred branch.

**References:** `2026-10-17-native-persistence.md`, `../specs/2026-10-17-accounts-sync-design.md`, `docs/cloud-verification.md`.

## Scope update

User steering: focus on the iOS app; Android and widgets later. Completed widget work and its review finding are preserved, unmerged, on `codex/native-storage-cutover` (`bd99857`). The active iOS subset uses `src/storage.ios.ts`; Android keeps AsyncStorage and the existing widget transport remains in place. Stop further widget/Android work and qualification. The review found a stale snapshot boundary in the deferred transport; that code is not included in this iOS subset and must be fixed before its eventual merge.

## Invariants

- No account required, no cloud association/upload/trial, no changed pricing.
- Preserve all existing APIs, IDs, history, custom labels/deletion markers, customization, language/appearance and reminder preferences. Nap-log features are deferred: retain current controls and manual start/end/import behavior without introducing inferred completion.
- App success means a committed write. Any quota/lock/error preserves existing data and reports failure; never confirm an unsaved action.
- Per-puppy identity exists throughout. The schema supports more than one puppy without exposing multi-puppy UI.
- Retain original AsyncStorage and migration snapshots. Future explicit local deletion must clear these, the app DB, widget queue and acknowledged-operation IDs.
- No remote credentials or private user content in diagnostics/screenshots. Use synthetic populated history for verification.

### Task 1: Complete native storage facade

**Files:** Add `src/local/native-storage.ts` and tests, `src/storage.ios.ts`; extend database schema/migrations/tests as needed, using existing normalizers. Keep web `src/storage.ts` semantics intact.

**Interfaces:** `createNativeStorage(database, petId)` exposes the same function names and return shapes imported from `storage` today. Every settings read/modify/write and related multi-key update is one database transaction. Historical custom activity derivation reads the transaction's event rows, avoiding nested queued database calls/deadlock. `shouldShowOnboarding` uses the migration's pre-default onboarding decision; completion persists atomically. Initialization caches success only and retries after errors.

- [x] Write failing real-SQL compatibility tests for every existing settings API, onboarding, custom activity delete/recreate, history-derived labels, widget normalization, invalid/retired preferences and concurrent settings writers. Existing event/routine conformance stays in repository tests. Expected RED.
- [x] Implement the facade with existing domain/normalization functions. Expose only the small SQL repository helpers necessary to share a transaction; do not call queued repository methods inside a database transaction.
- [x] Add the iOS module selector. Android and web keep their previous implementation; Android activation is deferred.
- [x] Run full tests/typechecks/all-platform exports. Expected GREEN. Commit facade/cutover.

### Task 2: Durable iOS widget operations and acknowledgment (deferred)

**Files:** Add `native/ios/PuptimeWidgetStore.swift`, `native/ios/PuptimeQuickLogWidget.swift`, a config plugin that copies owned source into the generated extension entry point, `src/widgets/queue.ios.ts`, shared queue/import helpers and tests; update existing widget sync/bridge and app refresh. Replace the old notification-only plugin while preserving its confirmation/reminder behavior.

**Interfaces:** The app-group `puptime-widget-queue.db` contains versioned per-puppy snapshot/state and immutable operations with UUID operation IDs and increasing sequence numbers. A Swift intent commits its operation/state in one SQLite transaction before notification confirmation. The app reads bounded batches, imports event changes plus `processed_widget_operations` IDs in one app-DB transaction, then deletes only those exact operation IDs from the queue. Process death after import/before queue ack safely retries without overwriting later app edits. Snapshot/state refresh uses the observed queue sequence and must not overwrite newer unacknowledged tap state. No 100-entry truncation.

- [ ] Write failing Node/real-SQL tests for duplicate operation import, import rollback, death between commit/ack, same-event later edits, two puppies, fresh taps during ack/snapshot and >100 pending actions. Add actual Swift SQLite CLI tests for queue atomicity/concurrent connections, quota/lock failure, schema version and state merge; do not substitute JS tests for extension behavior. Expected RED.
- [ ] Implement standard app-group SQLite queue and native SwiftUI widget/AppIntent with existing actions/colors/labels/dates and notification choices. Reuse the existing Expo extension target configuration; fail prebuild clearly if the expected target is missing. Avoid modifying installed dependency source.
- [ ] Import legacy pending timeline values once without clearing newer work; migration preserves existing app edits and existing manual nap completion semantics. Persist completion/ack markers with the imported events.
- [ ] Run Swift/Node/runtime checks and compile the actual extension. An OS intent error or visible retry state replaces any false success on storage failure. Commit durable widget transport.

### Task 3: Dedicated-device cutover qualification (iOS app first)

**Device:** Dedicated `Puptime Native Storage ae0c` iPhone 17 / iOS 26.5 simulator, UDID `99EB738C-D283-4A4E-8EF7-6DED36E3A10F`. The separate Android AVD is shut down and deferred. Local builds only; no paid EAS operation required.

- [x] Populate legacy AsyncStorage with synthetic history/preferences before first new-backend launch. Verify exact migration fidelity, restart/relaunch idempotency, preserved originals, account-free offline CRUD/import/settings/routines, and interrupted/failed migration retry.
- [ ] **Deferred:** Android/widget concurrent writes, intent queue and notification delivery qualification. Preserved evidence on the deferred branch does not qualify this iOS-only subset.
- [x] Run iOS app happy/edge Maestro flows and the actual migration-failure alert flow. Real SQLite quota/lock tests isolate storage failures; no OS-wide disk exhaustion is performed.
- [ ] **Deferred:** Android populated-history editor/detail rendering qualification; no Android activation is part of this PR.
- [x] Capture fresh iOS app screenshots. Record commands/results and native limitations separately from exports/unit tests.
- [x] Commit verification changes/evidence.

### Task 4: Review, PR and next sync boundary

- [x] Fresh whole-branch review; material findings receive RED→GREEN regressions and full green suite.
- [ ] Create/attach PR; applicable CI passes; merge through GitHub.
- [ ] Record evidence and write phase 3c's precise owner-bound association/outbox/pull-rebase/transport plan against the now-real native transaction interfaces. Phase 3 remains unchecked until native synchronization fault tests pass.
