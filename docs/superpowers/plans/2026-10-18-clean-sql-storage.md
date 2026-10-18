# Clean SQL Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline with TDD and one fresh whole-branch review. No implementer subagents or repeated reviewers. Existing autonomous authorization covers execution and PR integration.

**Goal:** Establish the first-release SQL baseline, remove obsolete development imports, and make real iOS consumers use targeted writes and bounded reads.

**Architecture:** Keep the existing transactional runtime/revision/outbox. Use constrained event/routine columns and small shared field codecs on native/server, plain indexed SQLite queries, and platform-selected query callbacks with explicit React refresh. Preserve independent drafts and the deferred platforms' fallback.

**Tech Stack:** Existing Expo SQLite, Node SQLite test adapter, Cloudflare SQLite Durable Objects, Zod, React and Maestro. No new dependencies.

**Spec:** docs/superpowers/specs/2026-10-18-clean-sql-storage-design.md.

## Global Constraints

- Free account-free offline use; sign-in never auto-enrolls or starts paid access. Current local-to-cloud enrollment is required.
- iOS first; Android/widget implementation deferred. Shared fallback is preserved, not deleted.
- Native baseline4/server baseline3; old development versions unsupported without erasing their bytes. No automatic reset of local/shared/deployed resources.
- No ORM/new replication/global event bus/household system or paid infrastructure.
- Core event/routine values use constrained SQL; JSON transport, immutable snapshots and small settings remain separate.
- Preserve stable IDs, multi-pet isolation, null/absent semantics, explicit draft edits, tombstones and transaction/outbox recovery. No new nap behavior.
- Explicit bounded refresh, actual populated measurements/screenshots/videos, reviewed PRs and green applicable CI. Larger rollout remains active.

## Review Focus

1. Unsupported/corrupt development database opens: do not execute DDL that changes it before rejecting; initialization failure/retry never duplicates a puppy or routine (Task1).
2. Optional false/null/absent values and same-time imported IDs cross SQL/DTO/server/projection boundaries: round-trip without inventing edits or collapsing open-duration state (Tasks2–3).
3. A save commits but notification/refresh fails, or a remote deletion races an open editor: never roll back acknowledged state, falsely save a deletion, or overwrite the retained draft (Tasks3/5).
4. Paging ties/timestamp edits, old notification targets and export after only one page loaded: no cross-pet leakage, duplicate/gapped stable pages, inaccessible target or truncated export (Tasks4–5).
5. Custom activity tombstones, concurrent enrollment and account preferences interact with SQL projection: retain existing identity, recovery and exactly-once revision/outbox behavior without full-history local edits (Tasks2–6).

## File map

- src/local/settings.ts: extracted current storageKeys/petSettingKeys/StorageKey. src/storage-validation.ts: shared current event/routine parsing. src/cloud/protocol.ts and record-identity.ts: reuse/export current field/key schemas.
- src/local/database.ts/open.native.ts: direct guarded atomic initialization; remove legacy.ts/legacy.test.ts and migration-only qualifiers.
- src/record-sql.ts: small field-column/value/row conversion helpers, no database wrapper. src/local/repository.ts/sync-projection.ts/native-storage.ts: column CRUD, targeted transactions and current activity materialization.
- server/account-store.ts: one guarded complete baseline, typed metadata/event/routine tables and unchanged protocol/history/security behavior.
- src/local/activity-queries.ts: indexed lookup/pages/windows/latest/summary/monthly queries. src/activity-data.ts/.ios.ts and src/activity-data-types.ts: absent deferred-platform capability versus current native runtime callbacks, no subscription bus.
- App.tsx, LogScreen.tsx, TimelineScreen.tsx, components/DayTimeline.tsx, InsightsScreen.tsx: explicit bounded read consumers and retained view/draft state. Existing base storage paths continue to serve Android/web.
- scripts/verify-ios-*.mjs, .maestro/native SQL/history journeys and docs: update current fixtures/snapshots, remove obsolete migration-only checks, actual measurements and native/service acceptance.

### Task 1: Direct initialization and current validation

**Interfaces:** initializeLocalDatabase(database:LocalDatabase,newId?:()=>string):Promise<{petId:string}> replaces migrateLegacy. Fresh puppy My puppy/starter routines/show_onboarding:true and metadata schema_version:'4'/active_pet_id commit together. Reopen validates the current version/active puppy/show_onboarding and writes no seed data. Extract StorageKey/shared keys; assertValidSchedule moves out of legacy.ts. Existing schemas remain temporary internally until Task2 completes the same unreleased baseline.

- [x] Write real SQLite tests named 'direct initialization is atomic and reopens without reseeding', 'initialization failure rolls back and retries', 'separate initializers choose one puppy', and 'unsupported or incomplete database is unchanged'. Assert version4, no legacy_snapshots/migration_complete, exact names/IDs/settings after reopen, injected starter insert failure rollback, original bytes/rows after rejection. Run targeted test and observe RED for missing API.
- [x] Implement direct initialization/version checks and open.native without AsyncStorage; extract keys/schedule validation before removing legacy parsing. Convert test/HTTP fixture setup to direct init with explicit current runtime seeding. Delete only old-format migration tests/scripts/journeys; preserve their meaningful transaction/concurrency/reopen assertions with the new API.
- [x] Align local event/routine key/data validation with existing cloud schemas: note16384 boundary, IDs256/no controls, labels40, timing/source/estimate/routine bounds. Test accepted boundaries and one-unit-over failures through local creation/edit/import with no durable change. Existing normal note UI limit stays300.
- [x] Consolidate server fresh initialization at baseline3 without an old-version upgrade chain; verify unsupported version rejection before changing stored rows. Keep existing record representation until Task2; no live deployment/reset in this task.
- [x] Run targeted initialization/validation tests, npm test, npm run test:server and both typechecks; expect all PASS. Commit. Record actual replaced test cases/counts, not an unchanged-test-count assumption.

### Task 2: Structured current records and sync projection

**Interfaces:** shared field codecs eventSqlValues(data)/eventDataFromSql(row) and routine equivalents operate on protocol data without identity. Native tables retain pet_id/id, add constrained fields with end_state0(point)/1(open)/2(closed) and nullable booleans. Server records hold typed metadata; record_events/record_routines store core data with record_id FK; small other-kind data remains JSON. Reconstructed CloudRecord protocol is unchanged. Order native history at DESC,id DESC consistently.

- [x] Add real SQLite/Workers tests for complete field round-trips: absent/false/true estimate/reminder, missing/null/closed endedAt, Unicode/empty note, custom labels, same local IDs in two pets/kinds, and invalid constrained inserts. Assert no authoritative body column for core records. Observe RED.
- [x] Implement plain column definitions/codecs and native/server writes/reads. Update sync projection, account summary/count and all direct fixture SQL consumers. Keep revision/outbox payloads, API schemas, security/session fences, operation replay and full enrollment/export paths intact.
- [x] Run all existing meaningful local sync/HTTP/Workers rollback, rejection-ordering, two-binding preferences, restore byte-limit, empty-cursor and imported-label tests. Add a record-write/revision-failure rollback against the new server tables. Expect PASS and commit; no deployed store reset.

### Task 3: Targeted authoritative mutations

**Interfaces:** appendEvents/updateEvent/removeEvent/updateEventTime complete without returning complete history; importEvents returns {imported:number,skipped:number}. Runtime storage uses the existing changeSink/afterCommit. Explicit full reads remain loadEvents() for full-data workflows. Schedule writes target IDs; saveSchedule remains deliberate whole-routine replacement. Existing deferred-platform returned arrays may be ignored until unification.

- [x] Add instrumented real-SQL tests: edit one of10000records without SELECT-all/decoding other events; exactly one changed record/revision/outbox; unchanged edit/deletion no new revision; failed capture rolls back; independent edits serialize; deleted edit rejects. Observe RED.
- [x] Replace array-wide mutation/diff with requested-row reads/updates and explicit LocalChange capture in database.write. Materialize new custom labels atomically; ordinary settings/name writes use stored activity state without decoding full history. Preserve import duplicate/estimate/open-duration invariants and current blocked/acknowledgment recovery.
- [x] Adapt actual mutation callers/tests to completion/count results, retaining explicit full reads only where required. Verify post-commit listener failures cannot reject acknowledged saves. Run Node/Workers/types, expect PASS and commit.

### Task 4: Indexed native read queries

**Interfaces:** createActivityQueries(database,petId) returns getEvent(id), eventsPage({before?:{at:number,id:string},limit?:number}), eventsBetween(from,until), latestEvents(), summary(), monthlyStats(). Page default200, at DESC/id DESC cursor, returns {events,next}. Date windows include overlapping durations. summary returns {eventCount,earliestAt}. monthlyStats matches existing MonthlyActivityStat[]. Native activity-data exposes these stable callbacks; base returns undefined. No listener bus.

- [ ] Write real SQL tests for ties/cursor boundaries, empty pages, invalid cursors/limits, two-pet isolation, date boundaries/DST/overlapping duration state, latest candidates and monthly-stat parity including estimates/empty months. Assert actual EXPLAIN QUERY PLAN uses relevant pet/time indexes. Observe RED.
- [ ] Implement bound queries and codecs, existing pure10-day frequency computation over a requested date window, SQLCOUNT/MIN/month groups and latest-per-activity/open-duration candidates. Preserve unchanged row object references in a small per-query cache. Do not add an all-history fallback for a bad query.
- [ ] Test1k/10k/100k fixtures, reporting rows returned/decoded and timings separately for pages, date windows, one edit and full export. No blanket latency assertion from desktop SQL alone. Run Node/Workers/types, expect PASS and commit.

### Task 5: Actual bounded iOS consumers

**Interfaces:** App supplies optional activity-data callbacks and a committed refresh token to existing views. Native Log holds pages, load-more and retained requested-event lookup; comparison Timeline requests14-day windows/earlier expansion with earliestAt metadata; DayTimeline requests selected-day range; Insights uses10-day frequency events/monthlyStats and explicit full export. Schedule uses14-day/current data; account count uses summary; notification/widget projection uses latest candidates. Base capability absent preserves old array behavior.

- [ ] Add acceptance before changing consumers: launch100k-event history, initial Log query bounded200; explicit load-more advances; old notification/edit target loads directly; edits/drafts survive independent remote fields/deletion and foreground; export contains all100k after one visible page. Observe RED from current complete-history refresh. Use production SQLite with actual query instrumentation.
- [ ] Wire explicit query/view state and stale-result guards, retaining existing UI and draft saver. Stop automatic iOS loadEvents on ordinary save/foreground/tabs. Keep empty/error/loading states self-explanatory, use existing controls/localization and preserve import/undo/current notification-response paths. No continuous reactivity or screen redesign.
- [ ] Run affected dedicated-iOS populated log/editor/timeline/insights/schedule/export journeys, inspect actual unchanged-row work and fresh screenshots. Record video. Run full code checks, expect PASS and commit. Android device testing remains explicitly deferred; record fallback scope truthfully.

### Task 6: Native, network and first-release qualification

**Interfaces:** current qualifiers seed direct baseline, compare current SQL values/revisions/ownership/outbox and retain recovery backups outside checkout. Only isolated synthetic data may be replaced explicitly after scope checks. Local/staging schemas and provider/build scopes are labelled.

- [ ] Update all onboarding/account/sync qualifiers that snapshot legacy tables or manipulate body JSON; remove migration-only scripts/journeys and update docs. Add direct baseline native init/reopen/storage-failure acceptance. Existing older development simulator data is backed up; no automatic shipping conversion.
- [ ] Start a fresh isolated local Worker/data directory after preserving/stopping only the owned old fixture. Run independent persistent SQLite+HTTP two-client enrollment/offline/restart/conflict/retry/export/deletion matrix against typed server, recording actual output and exact data. Inspect staging account/schema scope before any deployment/transition; do not reset shared/auth resources indiscriminately.
- [ ] Build fresh signed standalone Release; run actual first-run/replay/name/storage recovery plus configured Maestro11flow regression. Run populated1k/10k/100k affected-screen qualification and report device timings/query work; capture fresh screenshots and videos. Re-run only changed/failed/required cases.
- [ ] Run npm test, npm run test:server, npm run typecheck and npm run typecheck:server; compare every planned assertion to actual evidence and ledger deviations. Commit and use task-done; expect PASS.

## Integration gate after Tasks 1–6

- [ ] One fresh whole-branch reviewer with this spec/plan/Review Focus/rulings/evidence. Re-grade by actual effect; one material RED→GREEN fix pass and green suite; minors/rulings recorded and no re-review. Create/attach PR, integrate parent PR97 first, restack only when owned processes are stopped, require exact-head applicable CI before merge. Keep all ledgers/videos until exhaustive human delivery. Continue lifecycle/billing/web/Sentry/release work afterward.

## Plan self-review

Tasks1→2 share the baseline and extracted schemas; Task2→3 share column codecs and LocalChange shapes; Task3→4 keep deliberate full reads distinct from mutations; Task4→5 provide all named query callbacks; Task5→6 owns exact current fixtures and device evidence. Each Review Focus class has a targeted test and native/service qualification. Intermediate baseline commits are unreleased and not deployed. No claim that writing the plan or passing a schema-only test completes actual bounded consumers.
