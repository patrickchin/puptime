# Identity, Entitlements, and Account Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Protect the cloud record foundation with standard authentication, explicit cloud activation, recoverable local-puppy association, and subscription-independent export/deletion.

**Architecture:** Better Auth uses its supported D1 adapter and provider/OTP plugins. Hono routes derive the account namespace from the authenticated session, validate all external inputs with Zod, and enforce entitlement before synchronization; no submitted account ID selects storage. The account Durable Object remains the transaction boundary for pet identity, account data, and enrollment.

**Tech Stack:** Better Auth stable + Expo server plugin; Hono stable; Cloudflare D1/SQLite Durable Objects; Node/Cloudflare test runtimes. Resend official SDK only when a dedicated sender is configured.

**Spec:** `docs/superpowers/specs/2026-10-17-accounts-sync-design.md`

## Global Constraints

- All local features remain account-free and usable offline.
- Sign-in alone does not upload or associate local history.
- First-release one-puppy behavior must not become a one-pet database constraint.
- Only free service tiers; no paid plan activation, live paid catalog, or real-charge tests.
- Retain cloud data while its account exists, regardless of subscription; manual export remains available after expiry.
- No production development-code fallback, code logging, harpapro.com sender, or silent unverified-email linking.
- All repository changes through reviewed GitHub PRs.

## Review Focus

- Wrong-account and unauthenticated calls must never select another Durable Object or enumerate its history: Tasks 1/3.
- An expired trial cannot grant ongoing sync but still permits complete export: Task 2/3.
- Two devices enrolling simultaneously cannot create two first-release puppies or attach history silently: Task 3.
- Deletion must revoke sessions and account storage mapping before an old offline device can upload again: Task 4.
- Missing mail/provider configuration must give accurate availability without exposing test codes: Task 1.

### Task 1: Supported identity configuration and local D1 integration

**Files:** Create `server/auth.ts`, `server/auth.test.ts`, `server/migrations/0001-auth.sql`; modify `server/index.ts`, `server/env.d.ts`, `wrangler.jsonc`, package/lockfile and server test configuration.

**Interfaces:** `createAuth(env: Cloudflare.Env)` returns Better Auth configured for the request's D1 binding, exact origins/deep-link scheme, Expo plugin, hashed email OTPs, configured Apple/Google credentials, and disabled unverified automatic linking. `configuredProviders(env)` returns booleans only. `/api/auth/*` mounts the library handler; `/api/config` exposes configured providers/catalog availability without secrets. Auth configuration comes from environment, not hard-coded keys. The published Better Auth D1 schema generation output supplies migrations.

- [x] Write failing route/runtime tests: anonymous account endpoint denied, unsupported providers absent, missing production sender fails without code disclosure, and local OTP sign-in through a test-only controlled delivery channel. Capture codes in test infrastructure; never add a public code-returning endpoint.
- [x] Run server tests; expected FAIL for missing auth/config routes.
- [x] Install supported stable Better Auth/Hono dependencies; generate/inspect the library's D1 schema. Configure session/linking/origin/throttling rules using library options and production mail fail-closed behavior. Keep environment-specific D1 databases separate.
- [x] Run server tests and server/client typechecks; expected PASS, with successful local identity and session expiry/cancel cases recorded. Do not claim actual Apple/Google/email delivery until real configured provider checks pass.
- [x] Commit identity foundation.

### Task 2: Configurable cloud entitlement

**Files:** Create `server/entitlements.ts`, `server/entitlements.test.ts`, `server/migrations/0002-cloud-accounts.sql`; modify relevant env/config types.

**Interfaces:** `cloudAccess(account: CloudAccount, now: number)` derives `{ canSync, canExport, source, expiresAt }` from server trial/paid state. `activateTrial(accountId: string, now: number)` is atomic/idempotent and does not restart an expired trial. Catalog product IDs and price labels are provider configuration; no amount is asserted as finalized. Default trial duration is configurable, initially 14 days without automatic billing.

- [x] Write failing tests for explicit first activation, duplicate activation, expiry boundary, paid overlap, no entitlement, cancellation retaining data, and export remaining available for every existing authenticated account.
- [x] Run focused tests; expected FAIL.
- [x] Implement D1-backed state using conditional writes and provider-independent entitlement projection. Never accept paid/trial flags from the client. Only billing adapters added later can update paid entitlements.
- [x] Run all Node/platform tests and typechecks; expected PASS.
- [x] Commit entitlements.

### Task 3: Authenticated enrollment, synchronization, and export

**Files:** Create `server/account-routes.ts`, `server/account-routes.test.ts`; extend `server/account-store.ts`/tests; modify `server/index.ts`.

**Interfaces:** `/api/account` GET returns identity/entitlement/puppy summary; `/api/cloud/trial` POST explicitly starts the trial. `/api/cloud/enroll` POST accepts the local pet identifier and explicit same-puppy confirmation when cloud history already exists. The account object atomically selects/returns its initial cloud pet ID; record operations must target an enrolled pet. `/api/sync/push` POST accepts at most 50 versioned mutations and acknowledges each committed operation; `/api/sync/pull` GET returns `PullPage`; `/api/records/:id/history` GET paginates revisions. `/api/account/export` GET streams complete paged data/settings/history for authenticated owners without requiring paid access. Server session determines all storage and ownership; no public account-selector route is added.

- [x] Write failing authenticated API tests for two accounts/two pets, unconfirmed association, concurrent initial enroll, correct server pet mapping, unauthorized/future/stale cursors, mutation validation/bounds, expired entitlement, complete multi-page export, and per-operation retry after a partial batch failure. Verify CSRF/origin behavior for web and native requests.
- [x] Run server tests; expected FAIL for missing routes/ownership enforcement.
- [x] Implement route protection, bounded input parsing, explicit enrollment transaction, and export. Authentication alone must not create a pet or start upload/trial. Reject unknown pet references and make first-release different-puppy recovery non-destructive.
- [x] Run all Node/platform tests and typechecks; expected PASS.
- [x] Commit protected sync/export.

### Task 4: Sign-out, deletion, and staging verification

**Files:** Extend account routes/store and D1 lifecycle migrations/tests; create `docs/cloud-verification.md` evidence checklist and environment runbook.

**Interfaces:** Sign-out uses Better Auth session invalidation. `/api/account` DELETE requires recent authentication and explicit confirmation; durable deletion state prevents further sync before cleanup. Retryable cleanup removes account object customer content and Better Auth identity/session records; old sessions/pet IDs cannot recreate content. Backup expiry and local-device retention are documented separately.

- [x] Write failing tests for sign-out/session replay, reauthentication requirement, repeated deletion, interruption/retry, old-device upload after deletion, and inaccessible account export/history after deletion.
- [x] Run tests; expected FAIL.
- [x] Implement lifecycle cleanup and retry state; keep a minimal non-content deletion marker only as required for race protection. Inventory every identity/account/history store involved.
- [x] Run complete tests/typechecks/Worker dry-run; expected PASS. Create only verified free-tier staging resources, apply migrations, deploy, and run real authenticated happy/edge API journeys with isolated synthetic accounts. Missing provider/domain delivery remains an explicit gate.
- [ ] Conduct fresh whole-branch review; fix material findings using regression tests; create/attach PR, wait for applicable CI and merge through GitHub. Continue to native persistence with documented server interfaces.
