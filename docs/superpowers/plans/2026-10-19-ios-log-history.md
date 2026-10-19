# iOS Log History and Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, task by task, with one fresh whole-branch review after all tasks. No implementer agents or per-task reviews.

**Goal:** Let someone discreetly inspect a log's local and cloud versions, understand an automatic merge, and explicitly restore an earlier version without losing pending edits or changing ownership.

**Architecture:** Query the existing indexed SQLite revisions and authenticated server history. Extend the existing transactional repository and sync restore path rather than adding another journal, queue or persistence layer. Keep the editor mounted while its history is open; a secondary Settings destination makes deleted logs discoverable.

**Tech Stack:** Existing React Native/Expo, Expo SQLite, Zod, Better Auth request adapter, Node/Workers tests and Maestro. No new dependency or paid service.

**Spec:** `docs/superpowers/specs/2026-10-17-accounts-sync-design.md`, synchronization/revision rules, preferences/lifecycle and verification. This is phase4 history work, not completion of account export/deletion/device-management, billing/web, observability or release gates.

## Global Constraints

- iOS first. Android and widgets remain deferred until the human resumes them. Keep their runtime and source compatibility; no new nap behavior. Preserve existing nap data and allow reading it, but defer restoring versions involving nap timing/type.
- Local history and local restoration remain free, offline and account-free. A paid entitlement is required only for fetching additional server history. Existing cloud restore may require this log's pending changes to be acknowledged first; explain this safeguard without discarding them or adding a purchase prompt.
- Reuse stable puppy/event IDs, owner generations, field reconciliation and intent:restore. Deleted records require explicit restoration; ordinary imports/stale edits must still preserve deletion. Preserve estimated provenance and historical custom labels without reactivating a deleted quick action.
- Store current event/routine values in the existing typed SQL columns. Revision payloads are existing immutable snapshots; query only bounded indexed rows. Never load all events or all revisions to show one log's history.
- An earlier version creates a new local revision and, for an actively bound puppy, one validated restore operation against the current mirrored revision. No-ops create neither. Unbound profiles never acquire upload work.
- Every restore rechecks the selected version, latest local revision, owner generation/account, current binding and pending-record state inside the transaction. Stale views show reload/retry and preserve all data.
- Keep credentials, names, notes and revision bodies out of telemetry/logs. Do not record private code entry. Free tiers only; no real charge, domain purchase, store submission or public provider claim.
- Reuse themes, three languages, safe areas, scalable text, reduced-motion conventions and >=44pt targets. UI qualifiers must include populated history and unchanged-row render evidence on the task's iOS device. The explicit Android deferral overrides general Android runtime qualification.
- All changes land through a reviewed GitHub PR with green exact-head checks. PR99 is the parent and must integrate before this child merges. Its frozen remote head and CI are independent of this checkout's next branch.

## Design contract

- Add a secondary History action inside the existing log editor. Flush and retain its current draft before entering; keep the editor/list mounted, and use one presented native sheet rather than stacking native Modals. Back returns to the same log and safe editing baseline.
- Settings provides Recent changes as a secondary destination. Its bounded list includes deletions and opens the same per-log history panel. It is not another primary tab or an unsolicited conflict dialog.
- Local versions appear immediately with date/time, changed fields and source. Show before/after values for the selected revision and a clear Deleted state. Do not label local sequence numbers as server revision numbers or pretend every historic cloud version exists locally.
- Offer an explicit Cloud versions section only for the current bound record. It has independent loading/offline/expired/error/retry/paging states. A failure there does not hide local history. Distinguish server merge/deletion/restoration reasons using the actual validated response.
- Restore requires a selected nondeleted snapshot and a concrete confirmation showing what will change. Keep the original history and stable event identity; preserve current data if a concurrent edit, deletion, account change or write failure invalidates confirmation. A successful restore appears as a new version and refreshes the editor's acknowledged baseline.
- Empty, current/identical, unavailable, pending, stale, read-failed and save-failed states remain understandable and recoverable. A current or nap-related version must not offer an action that cannot safely run.

## Review Focus

1. A confirmation or history request outlives a local edit, remote merge, deletion, sign-out or account switch: stale results and restores must not target the new state/owner.
2. Restoring a deleted or estimated custom log must preserve its ID, estimated provenance and historical label without resurrecting a deleted quick action or losing newer pending work.
3. Long histories, new edits between pages, deleted cursors and equal timestamps must preserve order without gaps, full-table decoding or unchanged-row redraws.
4. An editor draft is saving, invalid, failed or remotely deleted when History/Back/Restore is tapped repeatedly: drafts survive, actions do not repeat and native sheets remain usable.
5. Cloud history is malformed, forbidden, expired, offline or returns another record/pet: reject it without exposing it or breaking free local history, and retain precise retry/reload states.

## File map

- `src/event-history.ts`: public history entry/page/head/restore selection types and specific recoverable history error categories.
- `src/local/event-history.ts`, `src/local/database.ts`: bounded local record/recent-change queries, validated snapshots/head tokens and additive revision-list index on fresh and known baseline4 databases.
- `src/local/repository.ts`, `src/local/sync-engine.ts`, `src/local/runtime-factory.ts`: reuse the existing event-write primitive and restore implementation; owner-fenced local/cloud historical restoration and commit notification.
- `src/cloud/protocol.ts`, `src/cloud/api.ts`, `src/cloud/account-controller.ts`: strict Revision response schema, encoded/paged history requests and current-session/owner checks before and after network work.
- `src/activity-data.ts`, `src/activity-data.ios.ts`: platform-selected history access using the existing cached runtime; deferred platforms return undefined.
- `src/components/EventHistoryPanel.tsx`, `src/screens/EventHistoryScreen.tsx`, `src/screens/LogScreen.tsx`, `src/screens/SettingsScreen.tsx`, `App.tsx`, `src/localization.ts`: secondary history destinations with existing design tokens, one-sheet editor integration and explicit restore confirmation.
- Existing tests plus `src/local/event-history.test.ts`, native history flows/qualifier and verification/video documentation.

### Task 1: Bounded, validated local revision queries

**Files:** `src/event-history.ts`, `src/local/event-history.ts`, `src/local/database.ts`, `src/local/runtime-factory.ts`, `src/local/event-history.test.ts`, `src/local/database.test.ts`.

**Interfaces:** `EventHistoryEntry={eventId,sequence,createdAt,source:'local'|'enrollment'|'cloud'|'restore',before:PuppyEvent|null,after:PuppyEvent|null}`. `EventHistoryHead={sequence:number|null,owner:{generation:string;accountId:string}|null,event:PuppyEvent|null,cloudRecord:CloudRecord|null}`. `EventHistoryPage={entries:EventHistoryEntry[],next:number|null,head:EventHistoryHead}`. `createEventHistoryQueries(database,petId)` produces `eventPage(eventId,options?:{before?:number;limit?:number}):Promise<EventHistoryPage>` and `recentPage(options?):Promise<{entries:EventHistoryEntry[];next:number|null}>`. Runtime exposes these queries as `history` initially; Task2 adds its restore method. Defaults50, allowed limit1..50; positive safe-integer sequence cursor, exclusive descending paging. Export the typed SQL helpers `readEventHistoryHead(sql,petId,eventId)` and `readEventHistoryEntry(sql,petId,eventId,sequence)` for Task2's in-transaction guard, not a second database writer.

- [x] Write real SQLite tests for creation/edit/deletion snapshots, same-time revisions ordered by sequence, pet/event isolation, Unicode IDs, current/deleted/empty head, exact paging with insertion between pages and a removed cursor, reopening and corrupt snapshots. Invalid inputs reject before SQL; malformed saved data rejects without modification.
- [x] Add a populated100000-revision query instrumentation check: one record/recent page decodes at most51 entries plus bounded head lookups, uses the expected indexes and has no full event/history materialization. Test a populated baseline4 reopening adds the new recent-change index without changing any application row or setup/owner state.
- [x] Run `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/local/event-history.test.ts src/local/database.test.ts`; observe missing history APIs/index behavior RED.
- [x] Implement those types/queries with existing strict event schemas and typed SQL decoding. Resolve the confirmed cloud record via current binding and the existing record-ID helper. Add `local_revision_changes` on `(pet_id,kind,sequence DESC)` to new schema and idempotently on validated current baseline4 reopen; do not reinterpret another schema or reset data. Use one short transaction for each page/head snapshot.
- [x] Run the full Node suite and all three typechecks; expect PASS. Commit `feat: query indexed log revision history` and task-done with the same command.

### Task 2: Atomic restoration of local snapshots

**Files:** `src/local/repository.ts`, `src/local/sync-engine.ts`, `src/local/runtime-factory.ts`, `src/event-history.ts`; real SQLite/engine/runtime/history tests.

**Interfaces:** `EventHistorySelection={source:'local';sequence:number}` initially; Task3 widens it to the documented cloud selection. `sync.restoreEventHistory({petId,eventId,selection,expected:EventHistoryHead}):Promise<PuppyEvent>`. Runtime supplies pet-bound `history={...queries,restore({eventId,selection,expected}):Promise<PuppyEvent>}`. Reuse an extracted `writeEventRecord(sql,petId,before,after):Promise<LocalChange[]>` from the repository's existing event-write primitive and an internal SQL helper for the existing `sync.restore`; do not introduce another queue/writer. The runtime's existing afterCommit notification fires once after an actual history restoration, never on rollback/no-op.

- [x] Write failing real tests for free/offline restore, stable identity, deletion restore, no-op, preserved estimate/custom-label provenance, deleted-action retention, pet isolation, injected record/revision/outbox failure and restart. Assert actual records/revisions/pending operations and callbacks, not helper invocation alone.
- [x] Add bound-puppy tests: one intent:restore against exact current mirror, no implicit trial/enrollment, pending-record/baseline rejection, stale local head, new remote revision, changed owner/generation, unbound second-pet isolation and lost-ack retry. Nap-related restoration is rejected without altering existing nap records. Repeated confirmation with the old head cannot repeat the write.
- [x] Run the focused history/engine/runtime tests and observe missing restoration behavior RED.
- [x] Implement the guard and selected local snapshot lookup inside the existing database transaction. Preserve estimated provenance from the current/latest known record, validate exact stored event data, and reject nap-related selection/current state. For an unbound target reuse the event primitive and existing revision/custom-label retention; for an active bound target reuse the existing strict restore helper, with its pending-record and ownership checks. Preparing/resyncing targets reject safely. Return the committed event; retain all history.
- [x] Run `npm test && npm run test:server && npm run typecheck && npm run typecheck:ios && npm run typecheck:server`; expect PASS. Commit `feat: restore earlier log versions atomically` and task-done.

### Task 3: Validated cloud version access

**Files:** `src/cloud/protocol.ts`, `src/cloud/api.ts`, `src/cloud/account-controller.ts`, `src/local/sync-engine.ts`, `src/event-history.ts`; protocol/API/controller/engine tests and actual Workers history-route tests.

**Interfaces:** export `revisionSchema` matching existing `Revision` fields and existing record/mutation/reason schemas, including record/pet/kind/sequence/revision consistency. `api.history(recordId,beforeRevision?,signal?):Promise<{revisions:Revision[]}>`, maximum50, strict descending/unique record-scoped results and cursor bounds. `controller.eventHistory(eventId,beforeRevision?,signal?):Promise<{revisions:Revision[]}>` derives the current record from runtime history head, verifies current session/account/entitlement/binding before and after awaiting, and throws existing CloudApiError categories without replacing the screen's local results. Widen `EventHistorySelection` to `...|{source:'cloud';revision:Revision}`; the same transactional restoration validates its exact record/pet scope and owner before taking its nondeleted after snapshot.

- [x] Write RED API/schema tests for long encoded IDs, pages/concurrent writes, malformed versions, wrong record/pet, mismatched before/after identity, duplicates/order/cursor, abort/network/402/401 and invalid payload preservation.
- [x] Write RED controller/engine tests for sign-out/account switch/disposal during a history request and old cloud selection after a new local/remote edit. Include actual server-authenticated history/merge/deletion/restore/pagination and cross-account isolation; retain local history when remote access fails.
- [x] Implement the existing SDK request route and strict response validation. Reuse the current account/runtime state; do not add another auth implementation or persistent cache. Revalidate identity/owner after the response and before exposing it. Extend only the selection branch of Task2's guarded restore; do not bypass its no-pending/current-revision checks.
- [ ] Run full Node/Workers suites and all types; expect PASS. Commit `feat: read and restore scoped cloud log versions` and task-done.

### Task 4: Discreet iOS history surfaces

**Files:** platform data access, `EventHistoryPanel`, `EventHistoryScreen`, Log/Settings/App/localization above; native Maestro history flows written before UI implementation.

**Interfaces:** extend existing platform data files with `getEventHistoryData():Promise<EventHistoryData|undefined>`; iOS returns the cached runtime history, base returns undefined. LogScreen receives optional history data and current cloud handle for the secondary panel. Settings receives an optional Recent changes callback. `EventHistoryPanel` consumes the same runtime data/current controller for a selected eventId, reports committed restore results and Back; `EventHistoryScreen` supplies the recent-list navigation. No new primary tab.

- [ ] Write native flows/SQL assertions for opening editor history with a committed draft, local older/deleted snapshots, Recent changes discovery, paging, confirmation/cancel/restore, repeated taps and a stale/write-failed confirmation. Initial RED is the absent editor history action. Preserve an owned populated fixture before use; never clear another profile/device.
- [ ] Implement the design contract using existing cards, buttons, loading/error primitives, sheet and typography. Flush valid editor changes before entry; failed/invalid/deleted draft recovery remains reachable. Render history within the existing presented editor sheet and retain the underlying list. Refresh the acknowledged editor baseline after restore; old autosave callbacks must not undo it.
- [ ] Add current/empty/pending/stale/offline/cloud-error states, actual before/after fields/reason and separate local/server labels. Nap versions remain readable with restoration deferred. Confirm a concrete selected version and preserve private values in-app only. Add all strings in English/Spanish/Simplified Chinese.
- [ ] Run full Node/Workers/types and affected actual native flows; inspect fresh screenshots at small/standard phone, light/dark and maximum text/keyboard. Prove unchanged underlying rows do not redraw while history selection/detail state changes. Fix observable clipping/overlap/inert controls. Commit `feat: add discreet iOS log history and restore` and task-done.

### Task 5: Native and deployed history qualification

**Files:** reusable `scripts/verify-ios-history.mjs`, `.maestro/native` history flows, existing HTTP matrix, cloud/video verification docs and rollout milestone.

- [ ] Qualify free and owned populated histories with actual SQLite counts/IDs/revisions and untouched rows: restore/offline/reconnect/restart/deletion/estimate/custom label, stale local/remote confirmation, pending operation, failure/retry and full bounded paging. Use dedicated task-named devices and explicit scoped backups. Preserve current1002-event owned fixture.
- [ ] Run actual local and deployed-staging authenticated history/merge/restore/isolation/paging edge paths with synthetic accounts and authoritative cleanup; do not substitute fake sessions for public provider proof. Record actual native SDK interactions where relevant without private code entry.
- [ ] Build a fresh default standalone Release and prove no test hooks/local auth URL. Run affected history flows plus the configured regression suite on that immutable bundle. Verify current completed installations keep setup/history/owner state. Retain explicit provider/distribution/physical gates.
- [ ] Record actual app journeys and grouped full test/type output, inspect fresh screenshots and update the external gallery/docs with precise scope and failed harness attempts. Run full Node/Workers/all types, native/service qualifiers and task-done; commit qualification.
- [ ] Record this bounded phase4 milestone without closing the full rollout or the later lifecycle/billing/web/Sentry/release gates. Then run one fresh whole-branch review, re-grade by user effect, make one material RED→GREEN fix pass, defer minors and do not re-review. PR integration follows only after exact-head checks and PR99 have passed/merged.

## Self-review and execution boundary

Task1's page/head/SQL helper types feed Task2 guards and Task4 rendering; Task2's local selection is explicitly widened in Task3 before Task4 consumes cloud versions. Task3 consumes existing authenticated history rather than creating new service permissions. Task4 preserves autosave and row identities rather than replacing activity loading. Task5 pins all five Review Focus classes with actual local/native/deployed evidence. Current schema4 gains an idempotent additive index, not development-format conversion. Full lifecycle/billing/web/telemetry work remains required later.

The human already authorized autonomous implementation and technical decisions. This plan makes that existing scope reviewable; proceed inline without another routine approval handoff. Work may begin on the isolated child branch while PR99's frozen remote head runs CI; any parent CI correction is qualified on its own head and incorporated before child integration. No current native qualification or reviewer is reading mutable child source.
