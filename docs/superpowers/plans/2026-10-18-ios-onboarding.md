# iOS Interactive Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline with TDD and one fresh whole-branch review. Continue under existing autonomous authorization; no implementer subagents or additional review passes.

**Goal:** Make Puptime's optional first-run walkthrough playful and immediately understandable, with safe practice interactions and optional pet naming.

**Architecture:** Add the iOS platform-selected walkthrough and keep sample state entirely in React. Extend the existing SQLite completion transaction to commit an optional pet name atomically, and reuse the existing runtime/name setter for iOS Settings rename. App distinguishes first-run from replay so replay cannot commit setup or request permission.

**Tech Stack:** Existing Expo57/React Native0.86, Animated/AccessibilityInfo/native Alert, existing image/font/theme assets, production SQLite runtime. No new package or schema version.

**Spec:** docs/superpowers/specs/2026-10-18-ios-onboarding-design.md, supplementing 2026-10-17-accounts-sync-design.md.

## Global Constraints

- iOS only. Android runtime/UI/widgets remain deferred; optional shared types may widen without activating behavior.
- Four short stops, Skip throughout, Back after the first, no forced practice, name, permission, account, trial or payment.
- Existing named/default/dark themes, headingStyle(theme), ActivityIcon and puppy-journal.png. No new design system or asset dependency.
- Sample interactions never write records, routines, revisions, outbox or cloud. No new nap behavior or widget promises.
- First-run optional name is pet-scoped, trimmed, 1–256 characters; blank Start means My puppy. Skip preserves the existing name. Name and completion commit together.
- Replay changes no data, account/ownership, preferences or permission; exits to Settings. Existing completed installs remain completed.
- English/zh-Hans/Spanish,44pt targets, keyboard/large text, screen-reader labels/focus, reduced motion.
- Actual native screenshots/videos and logs per docs/review-videos.md. Free tiers, no public store submission, PR-only integration.

## Review Focus

1. A name is written but completion fails, or two finish taps race: no partial profile/completion, false navigation or duplicate revisions (Task1).
2. A replay is opened with populated synced data: sample taps, setup and dismissal cannot alter any durable history/name/permission/owner/outbox (Tasks2–3).
3. The app backgrounds during a name save/OS permission request or the screen unmounts: retain committed state, avoid stale UI updates or unintended finish (Tasks2–3).
4. Large text, Chinese/Spanish labels, keyboard and Reduce Motion: Skip/Back/Start remain usable, practice feedback remains understandable (Task4).
5. Another committed name arrives while a Settings name draft is open: update saved label without overwriting draft; failed saves never claim success (Task3).

## File map and interfaces

- src/onboarding.ts: FinishOnboardingOptions={puppyName?:string} and OnboardingScreenProps shared contract (theme, mode, notificationPermission, callbacks).
- src/local/native-storage.ts and tests: completeOnboarding(options?:FinishOnboardingOptions):Promise<void> through one settingsWrite transaction; current no-argument behavior preserved.
- src/storage.ios.ts: forwards options to the existing storage. src/storage.ts: accepts optional options for type compatibility, preserves existing non-iOS behavior.
- src/screens/OnboardingScreen.ios.tsx: complete iOS walkthrough, React-only demo state and accessible bounded motion. Existing OnboardingScreen.tsx retains Android UI and consumes the compatible shared props.
- App.tsx: passes mode, guards replay callbacks, navigates only after commit; no new global profile state/cache.
- src/components/PuppyNameSetting.ios.tsx and inert PuppyNameSetting.tsx: native name row/prompt with mounted guards and subscribeLocalWrites; inserted in SettingsScreen.tsx.
- src/localization.ts: localized onboarding/name labels; preserve legacy onboarding keys for deferred platform.
- .maestro/native/ios-onboarding-*.yaml and scripts/verify-ios-onboarding.mjs: actual UI/data acceptance. Update existing iOS onboarding flows for the separate notification control.

### Task 1: Atomic optional name and completion

**Interfaces:** add FinishOnboardingOptions; completeOnboarding(options?) trims/validates supplied puppyName, defaults supplied blank to My puppy, preserves the existing name when omitted. Uses current petId and settingsWrite/changeSink.

- [ ] Write actual-SQL tests: supplied name Biscuit saves with completion; omitted input preserves an existing renamed puppy; blank input becomes My puppy; second pet identity/name remain unchanged; protocol-overlong input rejects without completion.
- [ ] Add an UPDATE metadata trigger failure: name, completion marker, local revisions and outbox all roll back; removing trigger permits retry; repeated identical completion does not invent a name revision. Run targeted tests and observe expected RED.
- [ ] Implement signatures/transaction and platform forwarding; no new schema or hand-built persistence queue. Run targeted tests then npm test and both typechecks, expect PASS. Commit.

### Task 2: Four-stop interactive iOS walkthrough

**Interfaces:** OnboardingScreenProps mode:'first-run'|'replay', onFinish(options?:FinishOnboardingOptions):Promise<void>, existing notification/back callbacks. App's replay finish bypasses setup writes; first-run awaits native completion before hiding. Legacy screen keeps current runtime behavior.

- [ ] Write native acceptance flow before implementation: three practice activity choices, timeline example, routine demo toggle, optional name/Skip, zero real events/routine changes through completion. Observe RED for missing native demo controls.
- [ ] Implement platform-selected screen using the spec's four stops, existing art/tokens, one brief tap-triggered Animated puppy response and local demo state. Next never depends on practice, final Start never depends on notification/name. Keep visible Practice/Example labels; no storage import or analytics.
- [ ] Wire App mode/finish and localized labels; Skip passes no name, Start passes draft, replay ending returns Settings. Keep busy/failed-save draft and disable duplicate finish. Capture actual light-mode walkthrough; expect full flow PASS and actual SQLite event/routine contents unchanged.
- [ ] Run npm test/typechecks, native affected flow and exact SQL acceptance via qualifier, expect PASS. Commit.

### Task 3: Safe replay, permissions and later rename

**Interfaces:** PuppyNameSetting({theme}) native component uses getLocalRuntime()/subscribeLocalWrites(), runtime.storage.loadPuppyName()/savePuppyName(). Non-iOS component returns null. Existing permission callbacks remain separate from finish.

- [ ] Extend native qualifier with populated history/name/preferences/owner/outbox snapshot: replay all demos and finish/Skip, then compare exact durable snapshot and OS permission. Replay has no name or permission action. Observe expected RED before guards/UI finish.
- [ ] Add iOS Settings row with actual saved name, native prompt and localized validation/error. Reload saved name on local commit, preserve an open prompt draft; commit only explicit Save and keep old saved label on error. No account/trial changes.
- [ ] Record native rename/restart, cancel, non-BMP/long name, and injected SQL failure/retry. Independent production SQLite name write during open prompt must not change draft; after cancel saved label reflects newest commit. Preserve petId and populated events.
- [ ] Record first-run notification Not now/Allow/denied; completion is independent, no automatic prompt from routine demo or replay. Update existing 00-onboarding/notification flows to assert the separate explicit action and retained first-log access. Run affected native/storage checks, full Node and types, expect PASS. Commit.

### Task 4: Accessibility, Release qualification and integration

**Interfaces:** qualifier emits credential-free PASS summaries/screenshots; recorder scripts retain current and redesigned videos outside checkout.

- [ ] Run actual small-screen/large-text, dark/default/named themes, Spanish/Chinese, keyboard and Reduce Motion journeys. Inspect all four stops and practice feedback. Correct clipping/overlap/inert targets; capture fresh screenshots and full design video.
- [ ] Build fresh standalone iOS Release on the dedicated task simulator. Run new first-run/replay/name/notification cases and whole configured11-flow suite. Verify completed-upgrade installs do not get forced onboarding. Record affected and suite videos plus exact SQL/service boundary evidence.
- [ ] Run npm test, npm run test:server, npm run typecheck, npm run typecheck:server. Record counts and compare each planned assertion against actual output; ledger deviations. Expect all PASS.
- [ ] One fresh whole-branch review per executing-plans, one material RED→GREEN fix pass; ledger all rulings/minors and no re-review. Create/attach PR depending on clientPR96 until parent merges. Require applicable CI before PR merge; preserve existing verification ledgers/artifacts and continue the full rollout afterward.

## Plan self-review

All five Review Focus classes have owning native/SQL checks. Existing theme/platform conventions and the original optional cloud boundaries remain authoritative. Name persistence has one transaction and no schema change; practice has no persistence boundary; replay bypasses mutation. Rename is included so naming does not create a one-way setup. Per-device delivery, export/history/deletion, billing/web and observability remain separate full-goal work rather than implicit completion claims.

Acceptance selector contract: retain onboarding.step.0 through .3 and onboarding.primary/skip/back. New native controls use onboarding.demo.pee/.poop/.meal, onboarding.demo.row, onboarding.demo.timeline.today, onboarding.demo.routine.reminder, onboarding.name.input and onboarding.notifications.allow. Settings uses settings.puppy.name; native prompt title/Save/Cancel are localized. Qualifier snapshots puppies/events/routines/settings/pet_settings/local_revisions/local_sync_owner/local_sync_pets/local_sync_outbox and actual notification permission, allowing only explicitly expected completion/name differences on first-run; replay permits none.

SQL regression names: 'onboarding commits puppy name and completion atomically'; 'omitted onboarding name preserves current puppy and explicit blank uses My puppy'; 'failed onboarding completion rolls back puppy revision and marker'; 'onboarding name is pet scoped, validated and idempotent'. Use existing native-storage.test.ts setup(t), database.write/read and createLocalRuntime for the revision/outbox assertion. Failure injection aborts UPDATE metadata where key=show_onboarding, after the name UPDATE has run. Expected RED includes the old function ignoring the options and leaving the original name, not an unrelated fixture failure.
