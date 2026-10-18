# First-release SQL storage

The user confirmed that Puptime is unreleased and has no users. Remove obsolete development-format compatibility, and make the restrained changes we would choose with accounts and synchronization known from the beginning. This is required follow-up to onboarding PR97, not a replacement for the optional paid-cloud rollout.

## Boundaries

- Keep free, account-free offline use. Signing in does not enroll data or start paid access. Existing local data must still join an explicitly chosen cloud puppy when synchronization is enabled.
- iOS first. Android and widget implementation remain deferred. Their active source paths are not dead code: extract shared keys/validation safely and retain the existing fallback behavior.
- Reuse Expo SQLite, SQLite transactions, Zod, React state and the existing revision/outbox runtime. No new ORM, replication engine, global event bus, household/invitation system or dependency.
- Keep straightforward refresh after committed local/remote changes and foregrounding. Preserve open drafts; do not introduce continuous collaboration infrastructure.
- No paid resources or automatic erasure/reset of development or deployed data. Preserve and inspect existing resources before any explicit synthetic-fixture replacement. Public provider/payment/distribution gates remain open.

## One first-release baseline

Native startup directly initializes the current SQLite schema. Remove AsyncStorage import, parseLegacySnapshot, raw legacy snapshots, migration_complete, and development v1/v2/v3 upgrade branches. Extract still-used storageKeys, petSettingKeys and schedule validation before removing legacy.ts. Remove migration-only test journeys/scripts; retain atomic initialization, rollback/retry, reopen, foreign-key, version-guard and separate-connection concurrency checks.

Use native baseline version4, identifying the first complete SQL format; unsupported versions fail before changing their contents. Keep the existing database filename so an older development file cannot be silently replaced by opening a different empty file. Initial puppy ID, starter routine and onboarding metadata commit atomically. Reopen validates the active puppy/completion metadata and creates no second puppy or starter rows. Future released migrations can be added at this boundary; there is no shipping old-development converter.

Consolidate server initialization into its complete current baseline instead of constructing an old schema and upgrading it. The final typed server baseline is version3. Validate version before changing an existing store. Production/staging transition is a separately inspected operation, not a constructor reset.

## Queried data belongs in SQL columns

Store event/routine core fields in constrained columns on native and server: identity/puppy scope, activity type, timestamps, custom label, note, source, estimate provenance, routine minute/reminder/tolerance. Use enum/range/nullability constraints, foreign keys and indexes. No event/routine body JSON as the authoritative current record.

Preserve optional values exactly. A point record with endedAt absent differs from an open nap with endedAt:null; store a small explicit end state with the nullable end timestamp. Nullable boolean columns retain absence versus false. Preserve existing nap records/controls without adding nap-specific product behavior. Keep canonical cloud tuple identities: they preserve imported local IDs across puppy/kind namespaces and are current identity plumbing, not a legacy converter.

JSON remains appropriate for HTTP messages, immutable revision/outbox snapshots and small flexible preferences/customizations. These are separate from current queried event/routine storage. Server record metadata uses ordinary columns; typed event/routine payload tables reconstruct the unchanged validated protocol DTOs. Existing revision/export/pull paging and authorization remain intact.

Validate local creation, editing and CSV import against the same core boundaries as cloud: local IDs1–256 without controls, custom labels1–40, notes up to16384 UTF-16 units, protocol timestamp ranges and type-dependent timing. Use parsed/canonical values when a schema transforms input. Do not truncate invalid imported notes silently or remove valid recovery because its work was formerly described as compatibility.

## Targeted writes, one transaction

For a single edit, read only the requested current row, apply explicit field changes, validate, update it and capture its revision/pending upload in the existing database.write transaction. Reject edits to deleted rows and retain the editor draft. Deletes, appends and routine edits use the same authoritative path. A no-op creates no revision or upload. Import reads only incoming IDs and necessary invariant rows, keeps duplicate counts and estimate provenance, and rolls back an invalid batch.

Materialize newly introduced custom activities in that transaction; retain deletion/tombstone behavior and the existing imported-label regression. Ordinary settings/name changes must not decode event history to discover labels. Notifications after commit remain advisory and cannot turn a successful save into a failure.

Mutation APIs return completion/counts rather than reloading all history. Full-data reads remain explicit for enrollment, export and tests that actually require them. Keep stable puppy/event IDs and explicit account association; no account rewrite or duplicate queue.

## Reads must reach the consumers

Add pet-scoped event lookup, stable keyset pages (default200), indexed date windows including overlapping duration records, latest-per-activity candidates, COUNT/MIN summary and SQL monthly aggregates. Use at DESC,id DESC consistently for same-time ordering and cursor comparison. Invalid limits/cursors reject without an unbounded fallback.

Use a small platform-selected activity-data capability: the non-iOS fallback is absent, retaining existing array-driven behavior; iOS supplies the current runtime's queries. Native screen state is a bounded view cache, refreshed explicitly after commits/foreground, with stale-result guards. It is not another source of truth.

- Log fetches200 records initially and another200 on explicit load-more. Refresh preserves the amount the user loaded; a requested old event can be fetched directly without loading all intervening history. Retain stable references for unchanged rows and independent editor drafts.
- Comparison timeline fetches its initial14-day date window; loading earlier expands the requested window. Day timeline queries the selected day and overlapping durations. Use SQL earliest-time metadata for earlier-history availability, not the first page's minimum.
- Insights uses a10-day frequency window and SQL monthly summaries. Preserve current recorded-day, estimated-count, interpolation and local-calendar semantics by reusing the existing pure frequency calculation over the requested window. Export fetches all records only on explicit export and never exports just a visible page.
- Schedule suggestions use their14-day window/current-day state. Account count uses SQLCOUNT. Notification/widget projections receive latest activity/open-duration candidates; existing widget transport is not redesigned.
- App refresh must not quietly call loadEvents for every iOS save or tab. Keep the fallback for deferred platforms, and preserve notification-response lookup, import/undo, visible failures and selected drafts.

Date-window work is bounded by the requested dates and matching rows, not a promise of constant work for arbitrarily dense days. Query plans and measured work must distinguish that from keyset page bounds.

## Acceptance and release scope

Real SQLite tests cover fresh/reopen/rollback/concurrent init, constraints and optional-field round trips, targeted single-row work, two-pet isolation, atomic revision/outbox capture, remote merge/deletion, import/dedup, keyset ties and edits, calendar/DST windows, monthly-stat parity and complete export. Keep all current meaningful sync fault regressions; remove only obsolete format assertions.

Measure1,000/10,000/100,000-event fixtures with query plans, rows returned/decoded and elapsed work. A normal edit must not select/decode all history. Verify the actual mounted iOS log/detail with populated history, including unchanged-row references, paging, drafts after remote updates/deletion, restart and offline enqueue/reconnect. Record actual screens/test videos, local HTTP and independent staging scopes. No claim of a blanket speedup from schema changes alone.

Run full Node/Workers/typechecks, signed standalone Release and the configured Maestro suite on worktree-specific simulators. Inspect fresh affected-screen screenshots. Use a single fresh whole-branch review and one material fix pass per Superpowers, then PR CI/merge. Preserve previous ledgers/videos. Domain/provider/live-payment/physical-device gates remain explicit; this slice does not complete billing, web, lifecycle or observability.
