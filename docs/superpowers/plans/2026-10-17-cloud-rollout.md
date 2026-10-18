# Puptime Cloud Rollout

Execution design: `docs/superpowers/specs/2026-10-17-accounts-sync-design.md`.

The user delegated remaining technical decisions and autonomous execution. Implement in this order, using independently reviewed PRs. Do not wait between completed phases for routine permission. Update this file and the execution ledger with evidence; an unchecked item is not implemented.

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

The user directed **iOS app first; Android and widgets later**. The in-progress widget branch is preserved at `codex/native-storage-cutover` (`bd99857`) and is not merged. The active `codex/ios-storage-cutover` branch contains the storage facade with an iOS-only platform selector. Android keeps its existing backend; no new widget transport is activated here. Finish iOS storage qualification/review, then implement iOS accounts, owner-bound offline synchronization, onboarding and iOS end-to-end coverage. Deferred tracks must not block that sequence.

## Implementation evidence

- Foundation PR: https://github.com/patrickchin/puptime/pull/84. Shared validation/reconciliation and internal account SQLite storage implemented; 108 Node tests and 13 real local Workers runtime tests pass, including post-write rollback and simultaneous-device edits. Both typechecks, Android/iOS/web exports, and Worker bundle dry-run passed. Fresh review's two material schema/native normalization findings were reproduced RED and fixed GREEN. No customer-data HTTP route, deployment, app cloud UI, or live-service qualification is claimed from this phase.
- Identity/lifecycle PR: https://github.com/patrickchin/puptime/pull/85, merged `2adfd99`. 42 Workers runtime tests, 111 Node tests, both typechecks and fresh all-platform exports pass. Free staging deployed; real HTTPS synthetic-session happy/edge journeys pass and fixture identities/sessions are removed. Provider sign-in/delivery and native SecureStore client integration remain open; see `docs/cloud-verification.md`.
- Native persistence foundation PR: https://github.com/patrickchin/puptime/pull/86, merged `a4c6a08`. 130 Node tests, 42 Workers tests, both typechecks/all-platform exports and fresh review pass; native runtime remains pending.
- Next precise plan: `2026-10-17-native-storage-cutover.md` (phase 3b app/widget cutover; synchronization follows before phase 3 is complete).
- Scope steering clarified: defer nap-log work until a later update. Leave existing nap recording controls and history intact; preserve data through migration/sync. Do not add nap-specific behavior or inferred completion in this rollout.
