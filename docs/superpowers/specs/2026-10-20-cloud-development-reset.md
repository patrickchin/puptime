# Cloud accounts and puppy logging: development scope

October 20, 2026. This document supersedes conflicting scope in the October 17 account/sync design and October 18 SQL design. It records the user's revised priorities; it does not claim the proposed simplification is implemented.

## Objective

Develop reliable optional accounts and offline-first puppy logging with cloud backup and device synchronization. Use a clear, constrained SQL model for puppies, logs, routines, preferences and necessary synchronization state. Keep account-free local use and optional Apple, Google and email-code sign-in. Design ownership for multiple puppies while initially presenting one puppy. Use established tools and free service tiers. Make shared React Native changes for both iOS and Android, verify the app on iOS, and defer Android runtime testing and platform-specific fixes. Prove the core journeys locally and against the development backend. Submit changes through reviewed GitHub PRs. Present a small curated set of main happy paths and important failure paths.

Payments, subscriptions, trial conversion, App Store/Play Store publication, release marketing and exhaustive distribution checks are outside this development milestone. Observability should support development without becoming the critical path ahead of working accounts, logs and sync. Browser puppy logging, widgets and nap-specific work remain deferred.

## Clean development baseline

There are no released users. Old development database formats, fixtures and candidate implementations do not require preservation or conversion. Replace obsolete migrations with a documented initial schema when the new implementation is ready; reset only Puptime-owned development resources. Do not touch another product's accounts, databases, credentials or infrastructure. Do not retain a compatibility layer solely to protect a disposable test fixture.

Fresh-install setup, fresh database creation, repeat startup and ordinary offline durability still need to work. Future migrations after release remain possible. Logs a person creates in the new app before choosing to sign in must still upload when they explicitly enable sync: that is an ordinary product flow, separate from migrating an old development database.

Do not merge the pending account-deletion/recovery stack merely because it has extensive qualification evidence. Re-evaluate it against this simpler scope. Keep only code that the selected current design needs. No database has been wiped by this planning change.

## Where the existing SQL is

The current backend has two different SQL stores. Looking only at `server/migrations` shows the identity/account metadata database, not the entire application schema.

| Store | Current definition | Purpose |
| --- | --- | --- |
| D1 | `server/migrations/0001-auth.sql` | Better Auth user, session, provider account, verification and rate-limit tables; local email preview support |
| D1 | `server/migrations/0002-cloud-accounts.sql`, `0003-deleting-account-credentials.sql` | Trial/access and deletion-related metadata/fences |
| Per-account Durable Object SQLite | `server/account-store.ts`, constructor | Pets, generic record metadata, typed `record_events` and `record_routines`, revisions, operation acknowledgments and device enrollment |
| Shared event/routine column definitions | `src/record-sql.ts` | Core constrained event and routine fields used by native and server SQL |
| Native SQLite | `src/local/database.ts` | Local puppies, events, routines, settings, revisions and synchronization state |
| Unmerged lifecycle candidates | Candidate migrations 0004–0006 | Custom reauthentication, deletion receipts, recovery and completion proofs; not core log storage |

Puppy logs are implemented and stored in SQL. Current event/routine values are typed columns, not authoritative JSON documents. JSON still appears in immutable history, pending operations and some flexible preferences. The embedded cloud DDL makes the schema harder to discover and review; replace that arrangement with explicit versioned SQL files and a short schema guide.

## Authentication and account lifecycle

Let Better Auth own identity, OAuth state, email verification, sessions, provider linking and its standard authenticated deletion flow. Generate/check its schema using the installed SDK's tooling rather than designing replacements for those models.

Better Auth has freshness/verification checks and before/after deletion hooks. It does not automatically know about puppy records in an external Durable Object, local offline databases, application sync queues or Apple's provider revocation requirements. Those need a small application boundary where relevant. This does not justify a second general account lifecycle system for this milestone.

Prefer standard SDK operations plus minimal idempotent application cleanup. Remove custom original-owner reauthentication/recovery, receipt leases and permanent completion tables unless a concrete requirement still needs them after simplification. Do not replace them with another state-machine framework. Keep basic authorization, recent verification for destructive operations, sensible errors and isolation between accounts. Advanced interrupted-deletion recovery is deferred behind core accounts and sync.

The installed Better Auth 1.7.10 deletion handler performs separate awaited deletes; switching databases alone does not make that entire flow transactional. Define the simpler supported behavior honestly instead of promising the old all-or-nothing recovery contract with fewer tables.

References: [Better Auth database/schema tooling](https://better-auth.com/docs/concepts/database), [user deletion and hooks](https://better-auth.com/docs/concepts/users-accounts), [session freshness](https://better-auth.com/docs/concepts/session-management).

## Schema design work

First produce one short schema map and explicit SQL definitions before changing storage. Review the complete model, including its real queries and ownership constraints, rather than shortening the table list in isolation.

- Represent puppies and their profile with stable IDs; every log and routine references a puppy. The one-puppy UI must not require a later schema rewrite to support multiple puppies.
- Give current logs meaningful SQL columns for activity, timestamps, notes and existing provenance fields, with foreign keys, constraints and indexes for puppy/time/activity queries. Keep current queried data separate from history snapshots.
- Make routines and reminder intent explicit. Keep OS permission, scheduled notification identifiers and device delivery state local.
- Keep personal preferences separate from puppy data. Sync appearance/language and the agreed portable preferences; resolve system appearance/language on each device.
- Keep only sync metadata required for duplicate-safe retries, ordered pulls, deletion markers and atomic edits with history. Assess whether generic record wrappers, separate operation/enrollment tables or duplicated profile data can be removed without moving the same complexity into code.
- Retain automatic combination of independent edits and a discreet revision history. Do not build a separate enterprise audit product.

For a fresh design, prefer one PostgreSQL database for Better Auth and application data if a dedicated free project is actually available. It provides ordinary interactive transactions and application foreign keys without the existing split-store deletion boundary. Keep the established local outbox/reconciliation protocol rather than replacing the offline engine. Use a supported transactional Pool/Client, not a non-interactive HTTP query wrapper, for read → reconciliation → write. A notification-only relay can remain if needed; it need not own another application database.

The fallback is the current proven D1 + account Durable Object arrangement with explicit SQL files. Do not assume putting every table into D1 automatically simplifies the implementation: the current Durable Object runs read → JavaScript reconciliation → writes in one synchronous SQLite transaction and also supplies change notifications. D1 batches cannot directly replace that interactive transaction. Moving to D1 requires conditional writes and conflict recomputation, not just moving SQL files. The previously inspected Neon account did not offer a directly usable free project; recheck free provisioning before selecting PostgreSQL. Never provision under a paid organization to satisfy the preferred diagram.

If separate stores remain, place their SQL in clearly named folders under `server/migrations` (for example `auth/` and `account/`) and document the two runners. Durable Object SQL is applied through its SQLite API; Wrangler's D1 migration command must not be presented as migrating every account store.

## Implementation order and completion evidence

1. **Agree the schema in code and remove obsolete scope.** Add explicit baseline SQL and a schema guide; remove unnecessary lifecycle/payment coupling. Select a development reset procedure. No old-data converter is required.
2. **Unify native persistence and cloud access.** Move iOS-only shared behavior to native/shared entry points so Android receives the same application changes. The current Android defaults still select AsyncStorage arrays, disabled cloud, older onboarding and a missing profile editor; they do not already have parity. Promote appropriate façades to `.native`, share the SQLite/auth/sync/wizard implementations and retire native legacy storage under the clean reset. Keep genuine platform adapters small, including replacing iOS-only prompts where straightforward. Do not claim Android was run. Its SQLite/headless writers, secure authentication callbacks, notification channels/alarms and picker behavior remain later runtime qualification items.
3. **Complete the main account/log/sync journeys.** Fresh profile and first log; optional signup; explicit upload of newly created local logs; restore on a second client; offline create/edit/delete; reconnect; duplicate-safe retry; independent edits combined and visible history; account isolation and expired-session recovery through normal sign-in. Cloud development access must not depend on checkout, a subscription or a short trial.
4. **Verify the actual development stack.** Use real SQLite/Worker/database tests, iOS Maestro and the deployed development services with disposable Puptime fixtures. Check happy and failure paths but keep detailed results as text. Add bounded diagnostics where they help identify failures.
5. **Clean up and deliver.** Remove superseded code, unnecessary development migrations and obsolete fixtures. Keep about six representative review journeys, with a few important failure cases and technical results available separately. Merge only through PRs. No store submission, paid activation or release-readiness claim.

The finish line is a simple, inspectable cloud development system whose account and logging journeys work end to end. Passing every historical release checklist is not a prerequisite for this milestone.

## Parallel ownership

Keep schema, account ownership, native persistence and the sync protocol coordinated in the main implementation chat, using bounded subagents for audits and review. They share invariants and should not be developed as unrelated competing architectures.

Two independent chats own review-gallery curation and website analytics configuration/verification. They must avoid changes to native account/sync/storage contracts. Android parity assessment informs the shared architecture here; Android runtime qualification is deferred.
