# iOS First-Launch Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline, task by task, with one fresh whole-branch review at the end. No implementer agents or per-task reviews.

**Goal:** Make first opening Puptime a complete, resumable setup journey through optional account creation/sign-in, puppy creation or restore, contextual notification choices, the skippable feature walkthrough and the first real log.

**Architecture:** Extend the existing Expo SQLite runtime and official Better Auth controller. Keep device setup progress separate from synced puppy/account data and walkthrough replay. Reuse the tested sync runner and themed walkthrough; add explicit pristine-device restore intent rather than replacing replication.

**Tech Stack:** Existing React Native/Expo, Expo SQLite, Better Auth Expo/SecureStore, Zod, React Native Animated, Node tests, Workers tests and Maestro. No new dependency or paid service.

**Spec:** `docs/superpowers/specs/2026-10-17-accounts-sync-design.md`, especially “Onboarding, account UI, and public surfaces” and “Preferences and lifecycle”. This is a bounded phase-4 slice. Revision-history/export/deletion UI, billing/web and observability remain subsequent work; none is claimed complete by onboarding.

## Global Constraints

- iOS first. Android and widgets remain deferred until the human explicitly resumes them; retain their existing runtime behavior and only widen shared types when required.
- Free local offline use without an account. An equally usable local path is always available. Sign-in alone starts neither a trial nor data upload.
- Apple/Google/email codes use the configured official SDK methods. Show actual provider availability; do not invent delivery or distributed-build evidence. No code/token in telemetry, files, screenshots or videos.
- Explicit14-day no-card cloud activation. No automatic paid conversion or finalized price copy. Keep the existing stable local puppy ID and explicit confirmed cloud-puppy binding; no accidental second puppy.
- Name-only profile minimum: trimmed1–256 UTF-16 units; Not now/blank uses My puppy. Do not invent breed/photo/birthday fields.
- Preserve existing themes/fonts/puppy-journal asset, >=44pt targets, safe areas, scrolling/keyboard, scalable text, reduced motion and all three languages. Examples remain React state only.
- OS permission and Notify on this device are local. Synced reminder preferences must not enable delivery on another device.
- Commit through reviewed GitHub PRs only. Free tiers; no domain purchase, real charge or store submission. Never use harpapro.com.
- Full first-open videos and fresh screenshots are required. A feature-walkthrough clip alone is not onboarding evidence.

## Flow and design contract

These presentation choices are the builder's calls within the approved scope:

1. Welcome uses the existing puppy illustration and a concise outcome: Get started, plus Already use Puptime? Sign in. State that local use needs no account. No OS prompt or checkout on launch.
2. New setup commits the puppy name with its next checkpoint. Not now commits the existing My puppy minimum. Back/restart never creates another puppy. Returning sign-in may reach the cloud-puppy confirmation before creating a local name.
3. Account choice offers configured providers/email or Continue without an account. Verification has the existing wrong/expired/rate-limited/network/cancel recovery. A restart during an unfinished email challenge returns to the email step for an explicit resend; never auto-send or persist a code. Completed SDK authentication is recovered from SecureStore and is not repeated.
4. A signed-in person chooses cloud explicitly. New accounts can start the14-day trial or stay local. Returning accounts see their actual cloud puppy/count and explicitly restore it. Expired/unavailable access offers a local route with accurate retained-cloud-data copy. Existing local records always use the existing confirmation/combine safeguard.
5. The embedded feature walkthrough has the three practice stops (log, timeline, routine), with Skip leading onward to permission choices. Standalone Settings replay keeps its existing ending and leaves setup/data/account state alone.
6. Explain reminders using the existing example, then Allow reminders or Not now. Request OS permission only after Allow; denied/blocked/offline states never block local use. Show a short ready state and Start logging. That action completes setup; it does not fabricate the first event.

Use real provider labels, bounded form content and the existing theme. Public reference inspected: [Headspace's sequence on Mobbin](https://mobbin.com/explore/flows/7cdc08c0-3bcb-4882-90dd-5cf92019616f) separates welcome, provider choice and form validation. Adopt that hierarchy, not its branding or mandatory-account model. [Mobbin onboarding catalogue](https://mobbin.com/explore/mobile/flows/onboarding) is the user-facing reference. ALLEYKAT App Store id6744624267 appears to match the racing app but its onboarding remains uninspected; do not claim copied details.

## Review Focus

1. Termination between profile save, authentication, association, restore and final completion: committed state resumes, no second puppy/trial, and failed writes preserve drafts.
2. A pristine device's default name/routines meet a customized cloud puppy: restore must not overwrite cloud values or upload starter duplicates; newly created local work must never be discarded.
3. Cloud activation commits remotely but its reply is lost, or the person chooses local use while baseline transfer is incomplete: preserve idempotency and local data, pause transport before detaching, and do not silently activate upload later.
4. OS permission was previously granted, denied or changed in Settings while account preferences arrive: delivery follows this device's explicit choice and current permission, without replaying old notifications.
5. Verification, loading, errors, keyboard and maximum text interact with Back/Skip/replay: real account actions cannot repeat from double taps, local entry stays reachable, and samples never enter SQL/outbox.

## File map

- `src/first-launch.ts`: setup step/progress types and validation, no controller or persistence abstraction.
- `src/local/native-storage.ts`, `src/storage.ios.ts`, `src/local/database.ts`: small local metadata checkpoints, atomic profile/final completion and device delivery intent; existing writer/revision boundary.
- `src/local/sync-engine.ts`, `src/cloud/account-controller.ts`: explicit durable pristine restore mode and safe local-only recovery, reusing existing association/baseline/detach.
- `src/cloud/notification-delivery.ts` and `.ios.ts`, `src/reminders.ts`: platform-selected local delivery gate; base preserves deferred-platform behavior.
- `src/components/AccountSignIn.tsx`, `src/screens/AccountScreen.tsx`: extract and reuse configured provider/email form and error presentation, retaining existing Settings IDs/behavior.
- `src/screens/FirstLaunchScreen.ios.tsx`, `src/screens/OnboardingScreen.ios.tsx`, `src/onboarding.ts`, `App.tsx`: full setup coordinator, embedded tour/replay distinction, startup retry and local delivery Settings wiring.
- `src/localization.ts`, `src/screens/SettingsScreen.tsx`: all three languages and this-device notification control using existing UI conventions.
- Existing local/controller/engine/reminder tests, `.maestro/ios`, `.maestro/native`, and `scripts/verify-ios-*`: real current-state qualification. Keep recovery backups and review media outside checkout.

### Task 1: Durable setup and profile checkpoints

**Files:** `src/first-launch.ts`, `src/local/database.ts`, `src/local/native-storage.ts`, `src/storage.ios.ts`; tests `src/local/native-storage.test.ts`, `src/local/database.test.ts`, `src/local/sync-projection.test.ts`.

**Interfaces:** `FirstLaunchStep = 'welcome'|'profile'|'account'|'cloud'|'walkthrough'|'reminders'`; `FirstLaunchProgress = {step:FirstLaunchStep;puppyName:string}`. Native storage produces `loadFirstLaunch():Promise<FirstLaunchProgress|null>`, `saveFirstLaunchStep(step):Promise<void>` and `saveFirstLaunchProfile(name):Promise<void>` (atomically saves name and next account checkpoint). Existing `completeOnboarding(options?)` atomically completes setup and its existing marker; replay never calls it. Use local scalar metadata, no new persistence layer.

- [x] Write real SQLite tests: fresh welcome; profile save/reopen keeps one pet/identity; blank/default; invalid name and injected checkpoint failure roll back name/revision/step; completion failure retains resumable state; existing completed marker without setup checkpoint returns null; invalid checkpoint rejects without overwriting it. Assert setup metadata is absent from sync records.
- [x] Run the named tests and observe missing APIs/atomic behavior fail.
- [x] Implement validated metadata checkpoints through the existing database/settings writer, expose iOS facade methods, and initialize new-device delivery intent false. Final completion must preserve an explicit delivery decision and leave an absent first-run decision off.
- [x] Run native-storage/initialization/projection tests and base+iOS types; expect PASS. Commit `feat: persist first-launch setup checkpoints`.

### Task 2: Safe returning-puppy restore and local fallback

**Files:** `src/local/sync-engine.ts`, `src/cloud/account-controller.ts`; tests `src/local/sync-engine.test.ts`, `src/cloud/account-controller.test.ts`, `src/cloud/runner.test.ts`.

**Interfaces:** extend `prepareAssociation`/`enableCloud` with optional `mode:'combine'|'restore'`, default combine. Persist restore intent against the existing pending operation identity in local metadata; wire `Enrollment` remains unchanged and strict. `completeAssociation` consumes that intent only for the matching operation. Expose `canRestoreSetup(petId):Promise<boolean>` from the same SQL guard for pre-trial validation. Restore enrollment state includes optional `mode:'restore'` outside its unchanged wire request. Add controller `continueLocally({confirmPending?}={}):Promise<AccountActionResult>` to pause transport and detach an explicitly abandoned setup association while retaining local data and SDK identity. Keep existing rejected-enrollment cancellation safeguards.

- [x] Reproduce the actual existing merge using a cloud puppy with a modified starter routine and a pristine new device. Add RED restore tests covering remote name/routines/preferences, no new queued defaults, exact cloud IDs/binding, interrupted baseline/reopen, and no accidental second puppy. Require unfinished setup, zero real local events, unchanged seeded routines and no non-profile local revisions/customizations for pristine restore; recheck inside the projection transaction so concurrent new work rejects safely. A failed pristine guard preserves everything and offers explicit combine/local recovery rather than discarding changes.
- [x] Add RED lost-enroll-reply/restart and explicit local-fallback tests. Cover staged baseline and active/pending owner, retained local records, paused transport, no later implicit upload and unchanged cloud copy. Existing nonempty local data must retain the confirmation/combine path. Expired access must not be reported restored.
- [x] Implement the minimum guarded restore projection using existing baseline/transaction/runner. Prefer remote records, remove only confirmed pristine starter projections absent remotely, and preserve local defaults where no remote personal setting exists. Clear operation-scoped mode metadata on completion/detach/cancel as appropriate. Do not weaken ownership fencing or introduce a second queue.
- [x] Run engine/controller/runner/projection tests and full Workers suite plus all types; expect PASS. Commit `feat: restore a puppy during first-launch setup`.

### Task 3: Device-only reminder delivery

**Files:** `src/cloud/notification-delivery.ts`, `src/cloud/notification-delivery.ios.ts`, `src/reminders.ts`, `src/local/native-storage.ts`, `src/screens/SettingsScreen.tsx`, `App.tsx`, `src/localization.ts`; tests `src/local/native-storage.test.ts`, `src/reminders.test.ts` and `.maestro/native/ios-device-delivery.yaml` with `scripts/verify-ios-device-delivery.mjs` and an opt-in read-only notification-center Metro observer.

**Interfaces:** `getNotificationDelivery():Promise<boolean>` and `setNotificationDelivery(enabled:boolean):Promise<void>` in the platform-selected module. iOS uses local metadata; base retains existing behavior. Actual scheduling requires local intent and current OS permission. Existing `requestReminderPermission` records explicit opt-in before its OS action; Not now records false. Existing completed development installations with no flag retain prior permission-based behavior; fresh setup defaults off.

- [x] Add failing checks for two devices sharing reminder preferences with only one delivery intent, allow/deny/block/defer, OS permission changes, disabling/canceling only Puptime's notifications, and no old-alert replay after restore. Assert delivery state is absent from cloud records.
- [x] Reuse the existing scheduling and permission entrypoints; add one authoritative local gate for schedule/potty delivery and accurate Settings control. Do not request another permission or change deferred widget behavior.
- [x] Run real local storage tests and the current reminder checks/all types; expect PASS. Native permission evidence belongs to Task5. Commit `feat: keep notification delivery local to each iPhone`.

### Task 4: Complete first-open UI and reuse sign-in/walkthrough

**Files:** `src/components/AccountSignIn.tsx`, `src/screens/AccountScreen.tsx`, `src/screens/FirstLaunchScreen.ios.tsx` and its deferred-platform wrapper, `src/first-launch.ts`, `src/cloud/use-cloud.ios.ts`, `src/cloud/handle.ts`, `src/screens/OnboardingScreen.ios.tsx`, `src/onboarding.ts`, `App.tsx`, `src/localization.ts`; tests `.maestro/ios/00-onboarding*.yaml`, `.maestro/native/ios-first-launch-*.yaml`, `scripts/verify-ios-first-launch.mjs`, `scripts/verify-ios-cloud.mjs` and the shared Maestro setup helpers.

**Interfaces:** `FirstLaunchScreen.ios` consumes the existing `CloudHandle`, Task1 storage, Task2 controller and Task3 delivery functions plus existing theme/permission callbacks. Extract `AccountSignIn` from current Settings form; do not duplicate identity logic. Extend tour props with an embedded preview mode that ends after three practice stops, never writes setup/profile state, and keeps replay behavior intact. App distinguishes first-open setup from Settings replay.

- [x] Add native flows before implementation for welcome/local route, committed name/restart, name failure/retry, configured account request/verification/cancel, returning restore, permissions, final completion and first real save. Initial expected failure is the current app opening directly into the feature walkthrough. Keep the actual SQL invariants in the qualifier, not source-pattern assertions.
- [x] Implement the design contract with loading/error/offline/busy/disabled/recovery states. Block duplicate actions while committing; preserve typed names on failed writes. Account completion is SDK state, cloud activation remains separate. Back/Skip uses durable meaningful boundaries without repeating completed external actions.
- [x] Give iOS startup an inline retry on storage/setup-read failure instead of silently treating it as completed or showing false empty history. Preserve the deferred platform path. Reuse existing load-state UI where possible.
- [x] Wire contextual permissions and device Settings control, three languages, keyboard/large-text scrolling and reduced motion. Samples remain component state and replay leaves every real table/account binding alone.
- [x] Run Node/Workers/all types and affected native flows; expect PASS. Inspect fresh actual screens and fix observable clipping/overlap. Commit `feat: add complete iOS first-launch onboarding`.

### Task 5: Full first-open qualification and integration

**Files:** native flows/qualifiers above, `scripts/verify-ios-cloud.mjs`, `scripts/verify-cloud-clients.mjs`, `docs/cloud-verification.md`, `docs/superpowers/plans/2026-10-17-cloud-rollout.md`.

- [x] Build a fresh default standalone Release and prove its bundle has no test hooks/local auth URL. On dedicated task devices run fresh/local/name/failure/restart/allow/deny/defer/first-log/replay and all configured regression flows. Assert exact SQL identity/count/revisions/owner/outbox, not just visible labels. Use populated completed history for replay/upgrade preservation.
- [x] Run official native SDK account paths against the isolated current typed local service: request, wrong/expired code, successful new account with no implicit trial/upload, explicit cloud activation and existing-device restore. Omit private code entry from recordings; verify interruption/restart and cloud/offline failure recovery. Run existing independent local/staging HTTP fault matrices for changed association behavior; clean synthetic accounts and label provider/DNS/distribution gates truthfully.
- [x] Verify default light/dark, small/standard phone, largest text/keyboard/rotation, other named themes/three languages and Reduce Motion. Record full onboarding paths and important failures, save fresh screenshots, and update the review gallery and verification ledger.
- [x] Run `npm test && npm run test:server && npm run typecheck && npm run typecheck:ios && npm run typecheck:server` and the required affected native/service checks, record every deviation/ruling and task-done, commit qualification.
- [x] Record the first-launch implementation/qualification milestone in rollout phase4, with branch review/CI/integration as delivery gates; retain later history/lifecycle/billing/web/Sentry/service/distributed-release work and the active broader goal.

## Self-review and execution boundary

All five Review Focus classes have a corresponding test/native journey above. Task1 supplies validated profile/progress/completion to Task4; Task2 supplies guarded restore/fallback; Task3 supplies local delivery; Task5 verifies the composed real journey. No task assumes sign-in equals entitlement or association. Names/IDs are current interfaces, provider delivery stays gated, and no unrequested profile fields/dependencies are introduced.

The human explicitly authorized autonomous implementation and delegated technical decisions after the existing detailed product discussion. This plan makes the clarified first-open requirement concrete within that authorization; it does not open another routine permission handoff. Continue inline and keep the plan reviewable. Parent SQL PR98 must pass/merge before this slice integrates; source work may proceed from its fixed head while its isolated CI runs, with no native/Worker source mutation affecting an older running qualifier.

After Task5's implementation/qualification completion line, run one fresh whole-branch review. Re-grade by effect, make one material RED→GREEN fix pass, defer minors and do not re-review. Integrate only through a PR with green exact-head CI. Review and CI may run concurrently on a draft PR; a review fix invalidates the prior head's acceptance and requires checks on the replacement head. Record integration in the ledger; completing this bounded slice does not complete the broader cloud goal.
