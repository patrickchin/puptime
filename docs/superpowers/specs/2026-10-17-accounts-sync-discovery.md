# Puptime accounts, onboarding, and cloud roadmap

Date: October 17, 2026. Status: discovery draft; product interview in progress.

This document maps the requested change and records decisions as they are made. It is not an approved implementation specification. Split the eventual work into reviewed subsystem designs and executable plans after the unresolved product decisions are settled. The current implemented behavior is local-only; this roadmap does not change it.

## Confirmed direction

- Free local use requires no account. Signup is for optional account-backed cloud services. This supersedes the earlier mandatory-signup direction.
- When a local user signs up and enables cloud sync, carry their existing device data into the service rather than starting an empty history. Authentication, purchase/entitlement, and data upload are distinct steps; creating an account alone must not silently upload local history. If the account already contains a puppy, show its name and a history summary and ask whether the device's local history belongs to that puppy before combining them. The user confirmed this safeguard; duplicate-record/conflict rules and handling a different puppy remain to be specified.
- First cloud release: backup and synchronization across one person's devices. Shared household care follows later. Ownership and identifiers must accommodate that extension without building invitations or roles now.
- Support one puppy in the first cloud release, with multiple puppies designed into the data boundaries from the start and exposed in a later update. Use stable pet IDs separate from account IDs; scope activity, routines, active naps, reminders, and widget targets to their pet. Keep the initial one-puppy limit in product behavior rather than a database schema that can only represent one pet per account.
- All local features are free. User-facing backend services, including cloud backup, device sync, and later shared-care sync, are paid optional features. Use Obsidian's free-local/paid-services model as the commercial reference. The old approximately US$1.99 upfront app price is superseded; service prices, billing cadence, and any trial remain undecided.
- Include a walkthrough showcasing different parts of the app before the first log. Keep payment unobtrusive. Walkthrough skip/replay behavior and the detailed optional cloud-enrollment sequence remain design decisions.
- Aim to offer Apple sign-in, Google sign-in, and passwordless email codes. Verify platform availability, provider configuration, and recovery behavior before committing to the final flow.
- The user will purchase a dedicated Puptime domain later. Proceed without choosing a domain now, and do not use `harpapro.com` for Puptime's sender identity or public URLs. Domain-independent development and service preparation may continue; live sender/domain configuration remains deferred.
- Preserve offline logging and synchronize when connected. Include telemetry, Sentry crash/error reporting, operational reliability, and coordinated website, app, policy, and listing updates.
- Plan and question first; implementation follows an agreed design.

## What exists today

| Area | Evidence | Implication |
| --- | --- | --- |
| App | Expo SDK 57, React Native 0.86, TypeScript; `App.tsx` | Extend the existing app; an app rewrite is not established as necessary. |
| First run | `src/screens/OnboardingScreen.tsx`, `src/storage.ts` | Four skippable feature/notification screens; existing installations bypass first-run onboarding. Account setup needs its own persistent state. |
| Persistence | `src/storage.ts` | Whole activity arrays in AsyncStorage; write serialization covers one JavaScript runtime. No durable cloud outbox exists. |
| Data model | `src/domain.ts` | Activity IDs exist, but no pet/account identity, server revision, actor, or deletion metadata. Deletes physically remove events. |
| Android widget | `src/widget-task-handler.tsx` | Writes through storage from a separate task runtime; app/widget concurrency must be resolved. |
| iOS widget | `src/widgets/PuptimeWidget.ios.tsx`, `src/widgets/sync.ios.ts` | Pending activities live in widget snapshots, capped at 100; snapshot refresh clears pending entries. A reliable import/acknowledgment design is necessary. |
| Insights | `src/analytics.ts` | Local puppy-pattern calculations, not product telemetry. No remote analytics or Sentry integration is present. |
| Website | `App.web.tsx` | Marketing and Learn content; no connected account or logging interface. |
| Public claims | README, `PRIVACY.md`, website, Fastlane metadata, `store.config.json` | Current claims include no account/server/analytics and on-device data. Replace in coordination with actual release behavior. |
| Prior cloud plan | `RELEASE_PLAN.md` | Previously proposed Cloudflare Worker, Neon Postgres, Drizzle, Better Auth, optional accounts, caretaker links, and simple per-log synchronization. Those are proposals, not implemented infrastructure. |

No standalone terms-of-service document was found in the repository audit. Routine, activity customization, reminder preferences, widget configuration, theme, and language are stored separately. CSV restores activity only; it is not a complete device backup.

## Onboarding research and design direction

Reference libraries:

- [Mobbin onboarding flows](https://mobbin.com/explore/mobile/flows/onboarding): a focused place to browse real app onboarding examples.
- [ScreensDesign](https://screensdesign.com/): recordings and searchable flow chapters, including onboarding and paywalls.
- [Page Flows](https://pageflows.com/): recorded flows and screen sequences. Full-flow access can require sign-in; direct onboarding pages returned 403 during this research.
- Likely requested app: [ALLEYKAT on the App Store](https://apps.apple.com/us/app/alleykat/id6744624267), also [alleykat.app](https://www.alleykat.app/). Identity is a likely match, not confirmation of the Instagram review. Its complete onboarding has not been inspected.

Public Page Flows indexing lists Finch onboarding steps including initial questions, naming, goal selection, notification prompts, and a first mood action. That suggests useful questions about personal relevance and a first meaningful action; it does not establish that its entire sequence fits Puptime. Study actual recordings before selecting visual details. References demonstrate designs, not proven conversion improvements.

Prepare a small reference board covering: personal relevance, sign-in, minimal pet setup, first useful activity, permission timing, returning users, and interrupted setup. For each selected example record its actual screens, access/date, useful pattern, and Puptime adaptation. Avoid inferring quality from length or estimated revenue.

Proposed Puptime journey, incorporating the requested walkthrough and account-free local use:

1. Show the local outcome: remember the puppy's day, spot patterns, and plan a routine.
2. Walk through Log, Timeline/Insights, Schedule, and Home Screen widgets using clearly labeled example data. Show representative app interactions before the first real log; the exact screen count and interaction format need prototyping.
3. Create the first puppy locally with the smallest useful set of fields. Also provide a discoverable sign-in/restore path for returning cloud customers so they need not create a duplicate puppy.
4. Arrive at a useful Log screen. Offer a real first log when appropriate, without inventing historical activity or forcing a false entry.
5. Offer cloud backup/sync from a discoverable setting or a user-initiated online action. Show the benefit, price, and what will happen to existing local data. Include account creation/recovery, purchase restoration or entitlement activation, and a recoverable initial sync; their detailed order needs design. Keep a clear way back to free local use. Do not put a purchase screen between the walkthrough and the first local log.
6. Request notification permission when a user enables a reminder; showcasing reminders in the walkthrough does not require permission. Introduce actual widget setup when relevant.

Walkthrough skip/replay behavior, the optional cloud-enrollment sequence, any cloud trial, pet fields, and permission order remain unresolved. Recommended walkthrough behavior is skippable and replayable from Settings; that is a proposal, not a confirmed decision. Include accessible controls, reduced motion, localization, keyboard handling, back navigation, cancellation, retry, wrong-account recovery, and offline/error states. Fresh local setup must work without connectivity, authentication, or purchase verification.

Measure signup completion, setup completion, time to first useful log, subsequent return, and successful cross-device restore separately. A completed slideshow is not sufficient evidence of activation. Define metrics and targets before beta; establish a baseline rather than inventing conversion targets.

## Delivery sequence

### 0. Resolve the product and operating model

Deliver a reviewed design covering optional cloud enrollment, existing-user treatment, activation goal, minimum profile, pricing model, offline contract, supported countries, and operating budget. Confirm whether any public release or paying customers already exist rather than inferring this from repository metadata.

The free-local/paid-services boundary is settled. Research comparable puppy trackers and current backend/email/Sentry pricing after choosing realistic usage assumptions. Model active accounts, retained activity, restore traffic, email-code sends, telemetry volume, and support work at small, medium, and larger adoption. Compare viable cloud-service prices and billing cadences; no amount or cadence is approved by this draft. Decide how existing purchases would be recognized across stores and accounts if entitlements are introduced. [Obsidian's pricing page](https://obsidian.md/pricing) confirms a free app with optional paid Sync and Publish services; this is a model reference, not a decision to copy its prices, encryption, or feature set.

Specify cloud entitlements, purchase restoration, cross-platform access, cancellation, refunds, payment failure, and expiry. A lost entitlement must not block free local features or erase local history. Decide remote retention and download/export access after expiry before implementing billing. Enforce paid cloud access on the server without making local feature access depend on a network entitlement check. Developer-operated diagnostics such as Sentry are operational infrastructure, not a paid customer feature; decide their privacy controls separately.

Translate unobtrusive payment into reviewable behavior: recommend upgrades only when a user chooses a cloud feature or opens its Settings entry, no recurring unsolicited upgrade dialogs, and no payment requirement for the first local log. Keep prices, renewal conditions, and cancellation clear at the purchase decision. These interaction rules are proposed interpretations to review with the prototype.

Ready when: unresolved business choices cannot silently change the sign-up flow, data ownership, or launch scope.

### 1. Specify and prototype onboarding

Review the reference board, produce a clickable walkthrough using Puptime's existing visual language, and test first local use, opting into cloud, returning cloud use, and upgrading an existing installation. Showcase app sections before the first log. Define every required, optional, loading, rejected, canceled, and retry state, including leaving an upgrade offer and continuing locally. Test small phones, large text, screen readers, keyboard autofill, and interrupted verification. Avoid adding instructional prose for controls whose labels and state already explain them.

Ready when: the user approves the flow and its recovery states; representative users can reach useful logging without assistance. Detailed screen implementation follows that approval.

### 2. Establish backend, identity, and deployment foundations

Evaluate the previously proposed Cloudflare/Neon/Drizzle/Better Auth stack first. Reuse existing Harpa/Parrot patterns only after inspecting them. Validate Expo SDK 57 compatibility, Apple/Google provider flows, email-code delivery, secure native credential storage, web sessions, callback URLs, and account linking. Latest documentation is not proof of compatibility with the app's pinned versions.

Define account, pet, activity, routine, and synchronization records with authenticated ownership. Separate device preferences from synchronized pet data. Include database migrations, request validation, server-side authorization, bounded requests, login/code throttling, transactional writes, production secrets, staging isolation, and deployment rollback. Never trust a submitted account or pet ID as authorization. Do not automatically merge identities by an unverified matching email address.

Model an account's collection of pets even while the first release exposes one puppy. Require an explicit pet ID in record ownership, storage keys/queries, sync operations, nap constraints, routine learning, reminder state, and widget targets. Migrate legacy global data to the initial stable pet ID. Avoid a unique account-to-pet relationship or a global one-open-nap constraint. Exercise two-pet fixtures in domain/storage/API isolation checks to prove the boundaries, while deferring pet-switching UI and multi-pet widget controls. This prepares the later update without building a second user-facing scope now.

Specify authenticated linking and unlinking of login methods, including Apple private-relay addresses and a person returning through a different provider. Require reauthentication for sensitive account changes and prevent removal of the last usable login method. Make duplicate-account recovery explicit without silently moving another account's history.

Choose data region, email sender/domain, backup/restore capability, retention, and budgets. Estimate recurring costs before provisioning paid production services. Preserve the existing preference for avoiding unnecessary idle database polling; event-triggered deletion or maintenance work still needs reliable completion.

Domain purchase is explicitly deferred. For development, exercise email-code flows through a local/test mail preview transport rather than sending from `harpapro.com` or inventing a production sender. Keep the chosen public base URL, sender address, and provider callback URLs configurable. Preview codes must remain confined to non-production test infrastructure; do not emit them into production logs, analytics, or client responses. A missing production sender must fail clearly without falling back to a development transport or another product's domain. DNS verification, real email delivery, and final domain-specific OAuth validation are release gates once the domain is available; local previews do not satisfy those gates.

Ready when: test accounts can authenticate across supported devices, own isolated data, recover access, and be deleted in staging; unauthorized access tests pass.

### 3. Make local saving and migration durable

Proposed default: use a transactional local database for records and the pending-operation queue if it simplifies proven app/widget consistency. Evaluate Expo SQLite against the native widget paths before selecting it. SQLite provides persistence and transactions, not synchronization by itself. Do not introduce a sync framework without comparing its guarantees, compatibility, maintenance, and cost with the required behavior.

Every acknowledged local change must durably save its new state and, when cloud sync is enabled, the work required to synchronize it. Free local use must not create a growing upload queue for a service the user has not enabled. Enabling sync needs a recoverable initial upload of existing data. Cover activity creation, automatic editor saves, deletion, undo, CSV imports, naps, custom activities, routine changes, and notification actions. Audit iOS widget snapshot replacement and Android concurrent writes specifically; a successful main-app save test is insufficient.

Migrate existing IDs, timestamps, notes, estimate provenance, routines, and relevant preferences into the correct account/pet namespace. Keep a recoverable original until migration is validated. Make migration restartable and idempotent. Handle existing cloud data, multiple source devices, storage exhaustion, corruption, app termination, and interrupted imports without silently overwriting history. Never silently upload an existing local history to a newly signed-in account.

Ready when: migration and app/widget writes survive interruption with no lost or duplicated acknowledged activity; switching accounts cannot mix their histories.

#### Carry existing local data into cloud sync

Treat enrollment as an explicit, restartable transition, not an empty account replacing the device database. Proposed behavior:

1. **Before enabling sync:** keep the full local app working without an account or network. Account creation or canceled payment does not discard local data or authorize its upload.
2. **New account with no cloud data:** when the user enables the paid service, show which local puppy and data will be synchronized. Preserve existing event IDs and estimate labels, establish stable pet ownership, and include routines/custom activities according to the agreed sync scope. Device-specific permissions and preferences remain local unless deliberately included.
3. **Account already containing data:** retrieve its pet summaries, show the puppy's name and a history summary, and ask whether the local history belongs to that puppy. Combine histories only after explicit confirmation. Do not infer that two pets are the same from their names or silently combine histories. Declining or canceling must preserve local history and leave it unattached; the first cloud release supports one puppy, so do not silently create a second cloud pet. The exact recovery presentation needs design. A clean device should restore existing cloud data without creating another puppy.
4. **While initial sync runs:** keep accepting local edits and widget actions. Save the account/pet mapping and migration progress durably, and reconcile changes made during upload. Use stable operation IDs so retrying after an interrupted response cannot duplicate the imported records.
5. **On failure or cancellation:** preserve both the original local data and retry progress; show that backup is incomplete. Bind pending work to the intended account so another sign-in cannot receive it. Never describe local records as backed up before the server acknowledges them.
6. **On completion:** verify the agreed data has been acknowledged and can be restored on another installation. Keep a working local copy for offline use. Define duplicate-record/conflict handling when both sources contain the same stable IDs; similar timestamps alone do not prove duplication.

Include fixtures for a populated local device with an empty account, populated local and cloud histories, a clean device with existing cloud data, repeated enrollment, account switching mid-enrollment, canceled purchase, and app/widget changes during interrupted initial upload. This enrollment specification is distinct from the storage-schema migration that an account-free user may receive in an app update.

### 4. Prove backup and synchronization end to end

Define a versioned protocol with stable record IDs, unique operation IDs, idempotent retries, server revisions, deletion markers, and incremental pull cursors. An operation is acknowledged only after its durable server commit. Retries must survive the app being killed after commit but before receiving the response.

Preserve independent additions, retain pending edits during pulls, and prevent deleted records from reappearing. The prior plan used the last server-accepted edit for conflicts. Revisit that rule: specify stale edits, concurrent changes to different fields, delete-versus-edit, and competing nap start/end actions. Server acceptance order is different from the time an offline edit happened. Resolve or surface conflicts without silently discarding a user's work.

Trigger synchronization on launch/resume, reconnection while active, relevant writes, and manual retry/refresh. Clarify the supported offline duration and full-resync behavior when old deletion markers or cursors expire. Plan for server-enforced logout or access revocation while an old device is offline. Do not promise that mobile operating systems run sync immediately while the app is closed.

Show saved locally, pending upload, synced, and actionable failure states without disrupting one-tap logging. Separate local save failure from cloud failure. Define which pet data synchronizes and which preferences remain per device. Rebuild local reminders from reconciled state without sending duplicate historical notifications.

Prove one full slice first: device A logs offline, survives restart, reconnects and uploads, and device B retrieves the same record once. Extend through edit, delete, undo, CSV import, routine, and widget cases. A server replica is not sufficient backup: test database restoration and account-level recovery too.

Ready when: the failure matrix below passes and a clean second installation restores the agreed data.

### 5. Add observability as the foundations are built

Integrate Sentry before beta so identity, migration, and sync work are observable from their first staging tests. Cover handled errors, unhandled JavaScript errors, native crashes, API failures, and release/environment metadata. Upload source maps and native debug symbols from each build channel actually used. Verify widget-extension crash coverage separately.

Prove a deliberate staging error and native crash produce readable reports from release builds. Verify source-map/debug-symbol association, delivery after an offline period where supported, and grouping by release. Sentry helps locate failures; fixing and regression-checking the causes remains a separate action.

Define a small product event vocabulary for the onboarding funnel and activation. Sentry issue reporting and product analytics serve different questions. Select a product analytics destination only after deciding what decisions need those events. Restrict properties to an allowlist; exclude notes, email codes, credentials, invite tokens, raw request bodies, and unnecessary user/pet details. Decide identifier handling, retention, sampling, user controls, and consent requirements for actual launch markets. Verify scrubbing in staging reports.

Monitor authentication failure rates, sync backlog age, failed migrations, API errors, crash-free sessions, database/storage usage, and email delivery/cost. Give alerts an owner and a response procedure. Operational checks should be bounded and budgeted, not create a new database polling loop by accident. Replay/profiling and broad user-behavior capture need separate justification.

Ready when: a simulated incident is detected, understood from redacted evidence, and recoverable without exposing customer history.

### 6. Complete website, policies, listings, and account lifecycle

| Surface | Required work |
| --- | --- |
| `App.web.tsx` | Explain free account-free local use, the optional paid backup/sync benefit, cloud account requirement, offline limits, and actual pricing. Add support, privacy, terms, and account-deletion routes. Keep Learn useful. Connected web logging is a separate scope decision. |
| App Settings | Account identity, last sync/pending state, retry, recovery, export, sign-out, and deletion. Define handling of unsynced work before destructive actions. |
| `PRIVACY.md` and hosted policy | Actual cloud data flow, identity/email providers, Sentry/analytics, purposes, retention, deletion/backups, regions, user controls, and contact. Preserve accurate dictation disclosures. |
| New terms | Operator identity, acceptable use, account responsibilities, cloud availability/offline limits, data ownership, deletion/termination, and any selected payment/refund terms. Adapt to launch markets and have legal review where needed. |
| Store descriptions and configuration | Update `store.config.json`, Fastlane description/promotional/release/reviewer text, links, screenshots, account-access instructions, and platform privacy/data-safety declarations. Keep duplicate metadata sources consistent. |
| Documentation and release process | Update README, release plan, setup instructions, environment/secret documentation, migration/support runbooks, and incident/restore procedures. |

Implement account deletion in the app and an accessible web request path; delete associated cloud data through a retryable process, explain permitted retention and backup expiry, and prevent old offline clients from recreating deleted accounts/data. Define ownership handling before later household sharing. Sign-out is not account deletion.

Apple's review guidance requires meaningful account-based features when requiring sign-in, in-app account deletion for apps supporting account creation, and applicable equivalent login choices when using third-party login. Google requires the applicable in-app and external deletion pathways. Verify these and store privacy declarations against the final feature set before submission; authentication alone is not the product benefit.

Draft policy and marketing changes alongside implementation, then coordinate publication with the feature rollout. Do not change the current app's public privacy promises to describe cloud collection that has not shipped.

Ready when: users can understand the service, recover or delete accounts, and store reviewers can exercise the release without special developer assistance.

### 7. Verify, stage, and release

Run unit/integration checks and native end-to-end flows using dedicated task-named iOS and Android devices. Use populated Android history and verify opening/editing local detail does not redraw unchanged rows. Show fresh screenshots inline after UI implementation, as required by `AGENTS.md`.

| Failure or scenario | Required evidence |
| --- | --- |
| Fresh, returning, and upgrading user | Correct onboarding branch, preserved data, no duplicate puppy. |
| Account-free first launch without connectivity | Walkthrough, setup, and local logging work without auth or purchase verification. |
| Populated local device enrolls in cloud | Existing history is preserved; an existing cloud puppy's name/history summary is shown and combining requires confirmation; declining leaves local data unattached; interrupted retries do not duplicate or mix account data. |
| Email/provider login canceled, expired, throttled, unavailable, or changed | Clear recovery, retained setup progress, and safe provider linking without losing access to history. |
| Cloud offer dismissed, purchase canceled, entitlement expired, or billing unavailable | Free local features and history remain accessible; remote access follows the agreed retention/entitlement policy. |
| Airplane mode, flaky requests, timeouts, server outage | Local logging remains durable; queued work retries safely. |
| Kill before/after local write, upload, acknowledgment, or cursor update | No acknowledged changes disappear; retries do not duplicate records. |
| Two devices edit/delete the same record | The approved conflict policy is visible and deterministic. |
| Two-pet domain/storage/API fixtures | Queries, authorization, sync, routines, and nap/reminder state remain isolated by pet even though the first release UI supports one puppy. |
| App and widget write concurrently | Both writes survive; correct account/pet and nap state. |
| Duplicate CSV import and estimated activities | Stable IDs and estimate provenance remain intact. |
| Logout, account switch, account deletion, later offline reconnect | No cross-account leakage or deleted-data resurrection. |
| Disk full, unreadable data, interrupted migration | Original history remains recoverable; errors are actionable. |
| Large history, repeated edits, routine changes, time zones/DST | Responsive UI, unchanged-row stability, correct timestamps and reminder behavior. |
| Native crash and server exception in release builds | Readable, correctly attributed, scrubbed Sentry reports. |
| Database recovery and bad client/server rollout | Demonstrated restore and a rollback path that preserves newly created data. |

Roll out to an internal cohort, then a limited external beta, then a staged release. Define numerical go/no-go thresholds with the beta population and service budgets before testing. Treat confirmed data loss or authorization leakage as stop conditions. Keep old-client compatibility and failed-rollout recovery in scope. Rollback of app code must not discard pending operations or depend on reversing an irreversible data migration.

All repository changes go through GitHub pull requests. Release and merge readiness require the applicable checks and an agreed product design. Later shared-care work receives its own design and plan.

## Decision queue for the product interview

Already settled: backup/device sync first; one puppy initially with multiple-pet data boundaries from the start; all local features free without an account and user-facing cloud services paid; carry existing local data into cloud when sync is enabled; confirm the puppy using its name/history summary before combining local history with existing cloud data; unobtrusive payment; a pre-log app walkthrough; aim for Apple, Google, and email-code login; dedicated domain purchase deferred, with no use of `harpapro.com` for Puptime's sender/public URLs.

Resolve the following in dependency order, with recommendations and concrete consequences rather than a bulk questionnaire:

1. The recovery presentation when local history belongs to a different puppy than the one in an existing account; the first cloud release's one-puppy scope and confirmation before combining are settled.
2. Paid-service amounts, billing cadence, entitlement/retention rules, and treatment of existing purchasers, after current market/cost research.
3. Existing-installation upgrade presentation, local-data upload consent, and detailed cloud-enrollment ordering.
4. Required pet setup fields and the pet identity needed for reliable cross-device restore.
5. Which data restores across devices: activities, routines, custom activities, and preference boundaries.
6. Cloud-session expiration and reauthentication, logout/deletion semantics, conflict visibility, and supported sync offline duration; free local access remains available.
7. Walkthrough skip/replay behavior, onboarding activation goal, notification timing, and any optional cloud trial.
8. Launch countries, data region, operational budget, retention, telemetry controls, and support expectations.
9. Whether owner web access belongs in this release or the website remains marketing/support/account lifecycle only.

Then review the full product design. Create separate implementation plans for identity/backend, local storage/migration/sync, onboarding/account UI, observability, and release surfaces. Each plan needs exact file responsibilities, interfaces, meaningful checks, and reviewable PR-sized tasks. Do not invent those interfaces while the decisions above can still change them.

## Skills and primary references

Skills read for this work (fetched into temporary storage where not installed):

- [Superpowers brainstorming](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md): establish the design before building.
- [Superpowers writing-plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md): executable subsystem plans after an approved specification.
- [Matt Pocock grill-me](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md) and its [grilling dependency](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md): explore decisions and their prerequisites.
- [Marketing Skills onboarding](https://github.com/coreyhaines31/marketingskills/blob/main/skills/onboarding/SKILL.md) and [signup](https://github.com/coreyhaines31/marketingskills/blob/main/skills/signup/SKILL.md): useful optional skills for activation and registration. Their generic examples are not evidence for Puptime-specific uplift.
- Installed `anti-ui-slop`: ground UI decisions in the existing product and focused real references.

Technical and policy references checked during discovery:

- [Expo Sentry integration](https://docs.expo.dev/guides/using-sentry/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) — select the version compatible with this repository before implementation.
- [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo)
- [Apple App Review Guidelines, including 4.8 and 5.1.1](https://developer.apple.com/app-store/review/guidelines/)
- [Google account-deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
