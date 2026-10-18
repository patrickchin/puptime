# Puptime Cloud Rollout

Execution design: `docs/superpowers/specs/2026-10-17-accounts-sync-design.md`.

The user delegated remaining technical decisions and autonomous execution. Implement in this order, using independently reviewed PRs. Do not wait between completed phases for routine permission. Update this file and the execution ledger with evidence; an unchecked item is not implemented.

Acceptance includes review videos of new features, steps and meaningful test
journeys. Record the real iOS app and actual service-test output, label recorded
reruns and evidence scope, omit credential entry, and keep a linked gallery with
logs outside the worktree. Follow `docs/review-videos.md`. Group unit tests by
suite; give end-to-end journeys individual clips or chapters.

1. [x] **Cloud record and synchronization foundation.** Versioned validated operations, deterministic field merging, durable revision history, idempotency and incremental pull, per-account SQLite Durable Object. No unauthenticated public route to customer data. Detailed plan: `2026-10-17-cloud-foundation.md`.
2. [x] **Identity, entitlement, and account lifecycle server.** Better Auth with D1 and Expo authentication support; configured Apple/Google/email-code login; trial/access checks, protected account routing, explicit puppy association, full export, sign-out/deletion. Billing catalog stays configurable. Real sender/provider availability is a separate verified gate.
3. [ ] **Transactional native persistence and sync.** Expo SQLite migration preserving originals, app/widget transactions, restartable enrollment/outbox, pull/rebase, notification preferences, iOS pending-operation acknowledgment. Two-client fault tests before wiring ordinary UI to cloud.
4. [ ] **Native onboarding and cloud UI.** Product-grounded walkthrough, optional puppy name, Settings enrollment/status/recovery, discreet history/restoration, device-only notification delivery. Dedicated iOS/Android Maestro journeys, populated Android performance checks, screenshots.
5. [ ] **Billing and connected web account management.** Stripe Checkout/Portal/webhooks, native store purchases through a maintained SDK, catalog-derived labels and cross-platform entitlement. Desktop marketing plus responsive authenticated account/export/deletion routes. Do not include browser logging in the initial release dependency chain.
6. [ ] **Observability, privacy, and release surfaces.** Official Sentry integrations and symbol/source-map CI, redacted product events/marketing telemetry, consent/preferences, policy/terms/store metadata and account-support runbooks. Actual ingestion/error/email/billing service evidence is required.
7. [ ] **Deployed release qualification.** End-to-end happy/edge matrices on local, deployed staging, and distributed release builds against live services; isolated synthetic users, store/device gates, recovery and rollback drills, evidence ledger. Clearly identify blocked/unexecuted domain/provider/live-transaction checks. No paid infrastructure or real charges automatically.
8. [ ] **Later browser puppy logging.** After the native cloud release is qualified, design authenticated browser activity creation/edit/history/routine access against the existing API. Decide offline-browser scope at that boundary. It must not delay marketing/account-management delivery.

Create a precise subsystem plan at each boundary using the actual interfaces and verified dependencies from earlier work. Scope changes and technical rulings belong in the design/ledger rather than assumptions in code. Final price amounts and public release configuration remain revisable until the feature set is complete.

## Current execution priority

The user directed **iOS app first; Android only when explicitly resumed, and widgets later**. The in-progress widget branch is preserved at `codex/native-storage-cutover` (`bd99857`) and is not merged. PR88's iOS storage cutover and PR 93's sync engine have merged after green native CI. The iOS account/cloud client PR 96 merged as 3c44fa3 after both verification checks, Pages and the full native CI passed. Android remains unverified and keeps its existing backend; no new widget transport is activated here. The interactive iOS onboarding slice is underway with its own plan and native evidence. Deferred tracks must not block that sequence.

### Storage and architecture follow-up from October 18

The user questioned JSON event storage and the cost of adding accounts/sync to the original single-device structure. Inspection confirms local events have indexed identity/time columns plus JSON bodies; ordinary reads and edits still materialize the complete puppy history. The server stores generic JSON records in per-account SQLite. Those are current implementation facts, not the desired large-history access pattern.

After completing the bounded onboarding slice, make the following an explicit reviewed subsystem plan before expanding lifecycle/history UI:

- [ ] Move core event/routine fields into constrained SQL columns, preserving existing values and stable identity with a transactional, restart-safe migration. JSON API messages are a separate concern. Account for every existing sync projection, revision and enrollment consumer rather than changing only the table definition.
- [ ] Replace ordinary single-event whole-history mutations with targeted transactional writes; provide indexed date/activity queries, bounded history pages and SQL summaries. Adapt the affected UI reads so pagination is real. Retain a deliberate complete-data path for export/import and other features that require it.
- [ ] Verify large-history behavior with actual query plans, populated device tests and measured read/write work; cover at least 1,000, 10,000 and 100,000 synthetic events. Do not claim a speed improvement from schema changes alone.
- [ ] Define how committed local/remote changes refresh affected screens without overwriting open drafts. Reuse supported database/library facilities where they meet the requirement; avoid a second global event bus or duplicate authoritative state.
- [ ] Reassess the existing custom synchronization against maintained replication tools using concrete offline, free-tier, authorization and migration requirements. Preserve working behavior unless evidence supports a replacement; no infrastructure activation or service migration based on a generic preference.
- [ ] Decide the ownership boundary for eventual shared care before implementing invitations: current per-account storage requires additional design for cross-account puppy access. Multiple-pet keys alone do not establish shared-care authorization. Keep personal preferences/billing distinct from shared puppy records; no shared-care release or UI is claimed now.

The existing accounts/sync foundations and tests remain useful; this follow-up is required work, not a claim that an architectural audit or storage migration has already passed. Continue billing/web, observability and full release qualification afterward under the original scope.

## Implementation evidence

- Foundation PR: https://github.com/patrickchin/puptime/pull/84. Shared validation/reconciliation and internal account SQLite storage implemented; 108 Node tests and 13 real local Workers runtime tests pass, including post-write rollback and simultaneous-device edits. Both typechecks, Android/iOS/web exports, and Worker bundle dry-run passed. Fresh review's two material schema/native normalization findings were reproduced RED and fixed GREEN. No customer-data HTTP route, deployment, app cloud UI, or live-service qualification is claimed from this phase.
- Identity/lifecycle PR: https://github.com/patrickchin/puptime/pull/85, merged `2adfd99`. 42 Workers runtime tests, 111 Node tests, both typechecks and fresh all-platform exports pass. Free staging deployed; real HTTPS synthetic-session happy/edge journeys pass and fixture identities/sessions are removed. Provider sign-in/delivery and native SecureStore client integration remain open; see `docs/cloud-verification.md`.
- Native persistence foundation PR: https://github.com/patrickchin/puptime/pull/86, merged `a4c6a08`. 130 Node tests, 42 Workers tests, both typechecks/all-platform exports and fresh review pass; native runtime remains pending.
- iOS app cutover PR: https://github.com/patrickchin/puptime/pull/88. 138 Node tests/typecheck, signed Release simulator build, actual migration rollback/retry (1,000 exact records + ten originals), 11/11 iOS Maestro flows and independent review pass. PR native CI pending at this update. Android/widget work excluded.
- Next precise plan: `2026-10-17-ios-sync-engine.md` (phase 3c owner-bound transactional outbox and pull/rebase); phase 3 remains unchecked until native synchronization fault tests pass.
- Scope steering clarified: defer nap-log work until a later update. Leave existing nap recording controls and history intact; preserve data through migration/sync. Do not add nap-specific behavior or inferred completion in this rollout.

- iOS sync engine PR 93 merged as 607b588; iOS account/cloud client PR 96 merged as 3c44fa3 after independent review/fix acceptance and green native CI 39119334536. Client acceptance includes 241 Node/49 Workers checks, signed standalone local Release regression/upgrade, installed Debug official-SDK local cloud and independent deployed staging fault checks. Provider/distributed-authenticated-Release gates remain explicit.
- Interactive onboarding is still on its separate branch. Task 3 completed: optional puppy-name Settings editor, exact populated free/synced/pending replay preservation, actual OS permission choices; recorded videos 25/28/29. Task 4 underway: responsive accessibility layout passes largest-font SE3 Release journey 31, populated completed-upgrade and standard Release walkthrough/name 32; full suite 33 found one Settings scroll automation failure; its targeted correction passes in recording 36, with a full rerun still required. Themes/languages/Reduce Motion, final review, PR and CI remain open. See `2026-10-18-ios-onboarding.md` and external review gallery.
