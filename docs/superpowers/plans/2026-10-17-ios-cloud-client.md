# iOS Account and Cloud Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline with TDD and one fresh whole-branch review. Continue under the user's existing autonomous authorization.

**Goal:** Connect the reviewed sync engine to official native authentication and an explicit, recoverable iOS cloud enrollment flow, preserving free offline logging.

**Architecture:** Keep the SQLite engine as the only durable data/queue boundary. Use Better Auth's Expo client and SecureStore for credentials; its configured fetch client also carries protected API requests and receives cookie rotation. A serialized runner performs bounded push/pull work under an owner fence; a small account controller exposes explicit actions and redacted status to themed iOS screens. Activate only iOS. Account creation alone never enrolls, uploads or starts a trial.

**Tech Stack:** Installed Better Auth 1.7.10/Expo client, Expo SDK57 SecureStore/Network, React Native0.86 AppState, existing Zod/Hono/SQLite. No auth, state-management, or sync framework additions.

**Spec:** `docs/superpowers/specs/2026-10-17-accounts-sync-design.md`.

## Global Constraints

- iOS app first; Android activation and widget transport stay deferred. Keep existing nap history/controls unchanged.
- Free local use remains usable without accounts, connectivity, provider configuration or entitlement.
- Use free service tiers only; no live prices/catalog, real charges, paid upgrades or public store submissions. Staging is not production.
- Display only server-configured providers; never expose local OTP previews on a deployed server or use harpapro.com.
- Credentials stay inside the official SDK/SecureStore, never SQLite, logs, analytics, query strings, screenshots or test artifacts.
- One puppy UI, pet-scoped data; same-puppy confirmation before existing-cloud combination. User cancel preserves local history.
- Separate sign-in, explicit trial and explicit local-history association. The configurable14-day trial has no payment details or automatic charge.
- Pause upload on auth/entitlement failures; preserve local saves, pending mutations, server data and retry identity. Never label pending/blocked work synced.
- Appearance, language and reminder intentions synchronize; OS permissions and notification delivery stay local.
- Follow existing themes/typography/spacing and native sheet/back/keyboard conventions. Visible input labels, paste/OTP autofill,44pt targets, accessible state text, dark mode and large text.
- PR-only integration; require applicable checks and evidence. Do not claim real provider delivery from a preview or seeded session.

## Review Focus

1. Account/sign-out changes while SDK credential reads or network requests await: old work must not be sent using the new account or applied after owner detachment.
2. The server commits a push/enrollment, but the response/pull is lost or the app terminates: exact durable requests retry without duplicate history or association.
3. A concurrent create conflict belongs to a record only on a later pull page: drain validated pulls before rebasing confirmed rejection; never assume the first page is current.
4. Offline/expiry/429/5xx and malformed responses: local editing remains available, retries are bounded, and status distinguishes local save from actual cloud acknowledgment.
5. A remote preference/event arrives while a log editor or app background transition is active: refresh committed state without overwriting local editor state, touching unchanged event rows or delivering old notifications.

## File and interface map

- `src/cloud/api.ts`, `api.test.ts`: validated public config/account/enrollment/push/pull contracts and bounded fixed-origin SDK requests. No native imports.
- `src/cloud/auth.ios.ts`: official createAuthClient/expoClient/emailOTPClient/SecureStore, exact configured origin and scheme. No custom cookies or OAuth state.
- `src/cloud/runner.ts`, `runner.test.ts`: serialized resumable engine/HTTP orchestration with AbortSignal, transient retry timing and redacted status. Pure platform boundary for actual SQL tests.
- `src/local/runtime.ios.ts`, `src/storage.ios.ts`: single shared private DB/engine/facade instance, stable device ID, post-commit change signal. No second connection/cache facade per consumer.
- `src/cloud/account-controller.ts`, tests, `use-cloud.ios.ts`: explicit account/enrollment/lifecycle actions, AppState/Network scheduling and published status. Non-iOS implementation has no cloud activation.
- `src/screens/AccountScreen.tsx`, `SettingsScreen.tsx`, `App.tsx`, localization: iOS-only Settings account entry and self-contained account sheet/screen using existing tokens. No paywall at startup.
- `server/account-routes.ts`, `account-store.ts`, tests: authenticated active-only hibernating invalidation channel containing only protocol/cursor metadata.
- `scripts/verify-ios-cloud.mjs`, `.maestro/native/*`: isolated local/deployed service and installed iOS journeys; no production bypass/test route.

### Task 1: Official authentication adapter and validated API client

**Interfaces:** `createCloudApi(request: CloudRequest)` provides `config(signal?)`, `account(signal?)`, `startTrial(signal?)`, `enroll(request,signal?)`, `push(mutations,signal?)`, `pull(after,signal?)`. `CloudRequest` accepts only a fixed relative `/api/` path, method/body and AbortSignal and returns SDK `{data,error}`. Export schemas/types for server configuration/account summary/cloud access. `CloudApiError` exposes a status/category/retry delay without response contents. Native SDK adapter alone creates absolute URLs from the validated configured base.

- [x] RED: malformed config/account/push/pull/enrollment results reject; all provider flags/expiry/user/pet identities validated; missing/unsafe base URLs and forbidden public domain reject. A50-operation body stays below65536 UTF8 bytes; oversized/empty pushes fail before dispatch. Auth/entitlement/throttle/server errors preserve status and do not leak private server content.
- [x] Run targeted Node tests, expect missing API/failing assertions. Implement shared Zod contracts and small client methods using existing protocol schemas. Fixed paths only; no arbitrary external URL can receive credentials.
- [x] Add official Expo/SecureStore/email OTP plugin adapter with scheme `puptime`, storage prefix `puptime.auth`, base URL from explicit build configuration. Missing URL disables cloud with a clear configuration state; it cannot break local startup. Local HTTP allowed only in an explicit development build against loopback, HTTPS otherwise.
- [x] Verify actual installed SDK hooks attach credentials and capture Set-Cookie for protected routes with its `$fetch` client. Tests use actual Better Auth client/Workers runtime where possible; native SecureStore/runtime remains Task6 acceptance. No hand-built session/cookie parser.
- [x] Run npm test, Workers tests and both typechecks; expected all pass. Commit API/auth adapter.

### Task 2: Restartable bounded sync runner

**Interfaces:** `createSyncRunner({sync,api,petId,deviceId,sessionAccountId,changed,random?})` provides `run(signal):Promise<RunResult>`. `RunResult` distinguishes idle/synced/pending/blocked/auth-required/expired/retry/error, contains counts and retry delay, never record contents. Run is serialized by the controller. Engine APIs are consumed unchanged; every response is passed with the captured account/generation fence.

- [x] RED real SQL: free/signed-in-unenrolled runs send no sync/trial/enrollment calls. Resume saved enrollment with its exact immutable request and persisted baseline cursor; response loss/reopen retries safely. Existing-cloud confirmation is never inferred by runner.
- [x] RED: push commits then fetch fails; retry resends identical IDs and preserves later local edits. Pull all100-record pages before applying confirmed rejections so a record on a later page is available. Persist every successful page; final accepted/rejected receipts use an empty page at the committed cursor. SQL failure leaves retry work intact.
- [x] RED: resyncRequired enters engine staging, resumes pages and commits only complete baseline; retained accepted push results retry idempotently. A changed account/generation or aborted credential read stops dispatch/apply. No tight loop on retry_later/empty progress.
- [x] RED: offline/401/402/410/429/5xx/timeouts/malformed data preserve local edits and queue. Use bounded exponential delay1s→60s with jitter, honor capped Retry-After;401/402 wait for explicit state refresh, no automatic retry storm. Drain bounded work per run and schedule continuation when more remains.
- [x] Implement with native AbortController and existing engine methods; no custom queue database. Run full tests/typechecks, commit runner.

### Task 3: Shared iOS runtime and explicit account controller

**Interfaces:** `getLocalRuntime()` returns the existing single `{database,petId,storage,sync,deviceId}`; storage.ios wrappers consume that storage. `createAccountController(...)` provides read/subscribe, refresh/sign-in completion, `enableCloud({confirmedPetId?})`, retry, signOut and stop. SDK sign-in/sign-out are serialized with transport shutdown so credentials cannot switch beneath a pending dispatch. Snapshot includes configured providers/account/local status and recoverable action state.

- [ ] RED: account sign-in/refresh alone never activates trial/prepares association/queues upload. Explicit enable checks current account; existing puppy needs matching confirmation; different puppy/cancel retains everything. New account activation uses explicit trial then saved preparation/enrollment/baseline.
- [ ] RED: sign-out stops/aborts/awaits runner before SDK credentials change; pending/blocked counts require UI confirmation, detach preserves local data/cloud; failed sign-out is recoverable and cannot silently enable uploads. Restart signed out with an old association never dispatches it. Account mismatch never reassigns pending work.
- [ ] RED: post-commit local signal schedules work without treating sync projection as a new local edit; failed writes do not report saved. AppState inactive/offline cancels timers/subscription; activation/reconnection/manual retry schedule one run, coalescing repeated signals. Don't refresh all app state after every field edit merely to update cloud counts.
- [ ] Implement runtime factory, controller and iOS hook; keep non-iOS cloud facade disabled. Use an in-memory post-commit signal only; all durable intent stays in SQLite. Run full tests/types and fresh iOS export; commit.

### Task 4: Nonintrusive iOS account/enrollment UI

**Design contract:** Reuse Settings rows and current theme tokens/heading fonts. Account row identifies local-only, signed-in-unenrolled, pending, synced, paused or needs-attention with text. Account view uses a normal header/back control; email/code fields have visible labels and one-time-code autofill/paste. One primary action per step. A small puppy-history summary is the distinctive object: actual puppy name and event count at enrollment, never decorative sales metrics. No pricing badge, repeated upgrade modal, fake social proof or forced signup. Existing themes take precedence over new palettes/fonts.

- [ ] Implement iOS-only account Settings entry. Unconfigured/offline state offers Retry/Back; provider controls appear only when configured. Email request/verify, resend/correction and SDK social callbacks show loading/cancel/error states and preserve email input. Successful sign-in shows cloud disabled until explicit enable.
- [ ] Explicit enable view states local history will upload,14-day trial/no payment details/no automatic charge where applicable. Existing cloud summary requires same-puppy confirmation; different-puppy path cancels without changing either copy. Show pending/blocked/expired/auth/offline and last successful sync only after real acknowledgments. Manual retry cannot start a trial.
- [ ] Sign-out alert states unsynced changes remain on this device; cancel leaves account untouched. Keep account/local erasure and full export/history UI in the following lifecycle plan; do not advertise a public release before those store/privacy requirements are implemented.
- [ ] Localize English, Simplified Chinese and Spanish; use native keyboard avoidance,44pt controls, state announcements, accessible labels and dynamic text. No storage/schema detail in customer copy. TDD covers controller/state selection; Maestro covers interactions, avoiding implementation-mirroring snapshots.
- [ ] Run actual affected iOS screens on the dedicated task simulator, inspect light/dark/keyboard/large text and capture fresh screenshots. Run affected Maestro plus whole existing iOS suite. Commit.

### Task 5: Active-only account change invalidation

- [ ] RED Workers: anonymous/expired/wrong-origin/deleted accounts cannot upgrade; two owners never share notifications; accepted commits produce only `{protocolVersion:1,cursor}` invalidations after durability, duplicate retries do not invent revisions. Hibernation attachments restore subscription ownership. Closing/backgrounding client releases subscription. Retiring account closes subscriptions.
- [ ] Use Cloudflare's hibernation WebSocket API and the existing authenticated routing/account mapping, never a URL token or client-selected account ID. Validate session/access before upgrade and before dispatching metadata after wakeup; authenticated session ID may be stored in attachment but never transmitted in payload/logs. Use official identity session validation for liveness instead of homemade tokens. Expiry/revocation/retirement must suppress subsequent notifications; test this explicitly. No record contents in channel.
- [ ] Native adapter uses official SDK credentials only for the validated same origin and opens only while active, online, owner-matched and entitled. Messages schedule normal runner pulls; they never mutate records directly. Coalesce notifications, close on logout/background, use bounded reconnect delays and abort old-generation callbacks. Missed notifications recover on foreground/manual retry.
- [ ] Actual Workers tests and installed iOS connection acceptance; full tests/types; commit. If platform API imposes an unverified limitation, preserve explicit gate and implement no insecure fallback.

### Task 6: Native/deployed qualification, fresh review and PR

- [ ] Run actual schema2→3 installed iOS upgrade retaining exact events/IDs/settings and originals; free local create/edit/delete/import survives restart with no network dependency. Native SQLite failure cannot yield false save/sync status.
- [ ] Start isolated Wrangler local state with ENVIRONMENT=local; drive official email OTP signup through iOS Maestro and obtain test codes only from isolated local preview DB via harness. Wrong/reused/expired codes, cancel, successful signup-without-upload, explicit trial/enroll, offline edits/reconnect/restart,401/402/recovery and pending sign-out. No preview endpoint/auth bypass shipped. Separate this evidence from real inbox/provider delivery.
- [ ] Real two-client HTTP+SQLite fault journeys against local and deployed staging, including1000 history, lost push/enrollment response, partial pull, account mismatch and merged history. Reuse staging fixture cleanup and official signed administrative session setup where needed; label seeded-session checks honestly.
- [ ] Run npm test,43+ Workers tests, both typechecks, fresh native Release build, existing11 Maestro flows plus new account journeys and actual live-stage service checks. Record exact counts and screenshots; domain/Apple/Google/inbox/store/physical-device gates remain unchecked until executed.
- [ ] Fresh whole-branch reviewer per executing-plans; one material RED→GREEN fix pass, ledger all rulings/minors, no implementer agents or repeat review. Create/attach PR depending on enginePR93 until parent merges, then rebase on merged main and require applicable CI before merging. No direct main push.

## Self-review and later scope

All five Review Focus conditions have explicit owning tests in Tasks2–5. API schemas match server routes and existing engine signatures. One-puppy UI does not weaken multi-pet storage tests. This plan delivers native auth/enrollment and real HTTP synchronization; walkthrough redesign, discreet revision/export/deletion UI, native/store billing, Sentry and coordinated public release remain subsequent rollout plans. Marketing/telemetry work landing through other PRs must be inspected before adding duplicate implementation. Scope limitations are recorded release gates, not claims of completion.

Primary references checked October17,2026: Better Auth Expo integration/client docs; installed SDK client hooks; React Native Networking; Cloudflare Durable Objects WebSocket hibernation documentation. Existing product tokens/native conventions outrank optional design references. No paid UIZZE tool required.
