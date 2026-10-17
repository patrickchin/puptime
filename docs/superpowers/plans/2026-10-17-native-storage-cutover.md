# Native Storage and Widget Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans inline, TDD, one fresh whole-branch review. Follow the repository's dedicated-device and screenshot gates.

**Goal:** Switch every native app/Android widget writer to the verified SQLite repository; preserve existing settings and historical behavior; make iOS widget taps durable independently of snapshot refreshes. This is phase 3b. No cloud upload yet; phase 3c adds owner-bound association/outbox/transport after this cutover is qualified.

**Architecture:** `storage.native.ts` lazily opens the shared app SQLite connection and delegates to a testable `createNativeStorage(database, petId)` facade. Web retains its existing backend. Events/routines use the foundation repository; settings read/modify/write operations use the same transaction connection. SQLite handles competing Android runtimes. iOS widget intents use standard SwiftUI/AppIntents and an app-group SQLite operation queue, avoiding the Expo JS timeline's read/replace race and truncation limit. Keep Expo's existing extension setup and public widget reload/legacy timeline APIs; own the small native widget source in the repo rather than patching dependency internals.

**References:** `2026-10-17-native-persistence.md`, `../specs/2026-10-17-accounts-sync-design.md`, `docs/cloud-verification.md`.

## Invariants

- No account required, no cloud association/upload/trial, no changed pricing.
- Preserve all existing APIs, IDs, history, custom labels/deletion markers, customization, language/appearance and reminder preferences. Nap-log features are deferred: retain current controls and manual start/end/import behavior without introducing inferred completion.
- App/widget success means a committed write. Any quota/lock/error leaves a retryable operation and shows failure; never confirm an unsaved action.
- Per-puppy identity exists throughout. Native widget operations bind the puppy shown when tapped, and cannot be reassigned by a later active-puppy change.
- Retain original AsyncStorage and migration snapshots. Future explicit local deletion must clear these, the app DB, widget queue and acknowledged-operation IDs.
- No remote credentials or private user content in diagnostics/screenshots. Use synthetic populated history for verification.

### Task 1: Complete native storage facade

**Files:** Add `src/local/native-storage.ts` and tests, `src/storage.native.ts`; extend database schema/migrations/tests as needed, using existing normalizers. Keep web `src/storage.ts` semantics intact.

**Interfaces:** `createNativeStorage(database, petId)` exposes the same function names and return shapes imported from `storage` today. Every settings read/modify/write and related multi-key update is one database transaction. Historical custom activity derivation reads the transaction's event rows, avoiding nested queued database calls/deadlock. `shouldShowOnboarding` uses the migration's pre-default onboarding decision; completion persists atomically. Initialization caches success only and retries after errors.

- [x] Write failing real-SQL compatibility tests for every existing settings API, onboarding, custom activity delete/recreate, history-derived labels, widget normalization, invalid/retired preferences and concurrent settings writers. Existing event/routine conformance stays in repository tests. Expected RED.
- [x] Implement the facade with existing domain/normalization functions. Expose only the small SQL repository helpers necessary to share a transaction; do not call queued repository methods inside a database transaction.
- [x] Add the native module selector and verify app/headless Android import the same database file; web still uses its previous implementation.
- [x] Run full tests/typechecks/all-platform exports. Expected GREEN. Commit facade/cutover.

### Task 2: Durable iOS widget operations and acknowledgment

**Files:** Add `native/ios/PuptimeWidgetStore.swift`, `native/ios/PuptimeQuickLogWidget.swift`, a config plugin that copies owned source into the generated extension entry point, `src/widgets/queue.ios.ts`, shared queue/import helpers and tests; update existing widget sync/bridge and app refresh. Replace the old notification-only plugin while preserving its confirmation/reminder behavior.

**Interfaces:** The app-group `puptime-widget-queue.db` contains versioned per-puppy snapshot/state and immutable operations with UUID operation IDs and increasing sequence numbers. A Swift intent commits its operation/state in one SQLite transaction before notification confirmation. The app reads bounded batches, imports event changes plus `processed_widget_operations` IDs in one app-DB transaction, then deletes only those exact operation IDs from the queue. Process death after import/before queue ack safely retries without overwriting later app edits. Snapshot/state refresh uses the observed queue sequence and must not overwrite newer unacknowledged tap state. No 100-entry truncation.

- [ ] Write failing Node/real-SQL tests for duplicate operation import, import rollback, death between commit/ack, same-event later edits, two puppies, fresh taps during ack/snapshot and >100 pending actions. Add actual Swift SQLite CLI tests for queue atomicity/concurrent connections, quota/lock failure, schema version and state merge; do not substitute JS tests for extension behavior. Expected RED.
- [ ] Implement standard app-group SQLite queue and native SwiftUI widget/AppIntent with existing actions/colors/labels/dates and notification choices. Reuse the existing Expo extension target configuration; fail prebuild clearly if the expected target is missing. Avoid modifying installed dependency source.
- [ ] Import legacy pending timeline values once without clearing newer work; migration preserves existing app edits and existing manual nap completion semantics. Persist completion/ack markers with the imported events.
- [ ] Run Swift/Node/runtime checks and compile the actual extension. An OS intent error or visible retry state replaces any false success on storage failure. Commit durable widget transport.

### Task 3: Dedicated-device cutover qualification

**Devices:** Create `Puptime Native Storage ae0c` iOS simulator and `Puptime_Native_Storage_ae0c` Android AVD; do not reuse another worktree's device. Local builds only; no paid EAS operation required.

- [ ] Populate legacy AsyncStorage with synthetic history/preferences before first new-backend launch. Verify exact migration fidelity, restart/relaunch idempotency, preserved originals, account-free offline CRUD/import/settings/routines, and interrupted/failed migration retry.
- [ ] Exercise Android app/headless widget competing writes and iOS actual widget/intent queue, including app refresh during taps, >100 pending actions, import/ack interruption and failure feedback. Check existing reminder/confirmation behavior.
- [ ] Run happy/edge Maestro flows on both dedicated devices; extend the matrix for storage/migration/queue cases. Use real SQLite quota/lock tests for fault isolation where OS disk exhaustion is unsafe; report that boundary explicitly.
- [ ] On populated Android history, exercise editor/detail local state and record evidence that unchanged rows do not redraw. If a regression exists, fix it with focused evidence and repeat only affected checks.
- [ ] Capture fresh app/history/settings and widget screenshots from affected native screens for the final response. Record commands/results and native limitations separately from exports/unit tests.
- [ ] Commit verification changes/evidence.

### Task 4: Review, PR and next sync boundary

- [ ] Fresh whole-branch review; material findings receive RED→GREEN regressions and full green suite.
- [ ] Create/attach PR; applicable CI passes; merge through GitHub.
- [ ] Record evidence and write phase 3c's precise owner-bound association/outbox/pull-rebase/transport plan against the now-real native transaction interfaces. Phase 3 remains unchecked until native synchronization fault tests pass.
