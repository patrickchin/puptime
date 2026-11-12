# Puptime product operating plan

Updated November 12, 2026. The next outcome is a dependable Android beta for new puppy households. Local logging remains free without an account. Qualify the existing logging, widgets, reminders, history, recovery and optional cloud flows before adding features. Paid cloud remains a later phase; development access is not production billing.

This plan supersedes the October paid-app and single-pet roadmaps in RELEASE_PLAN.md. Existing technical contracts and data-preservation requirements still apply.

## Ownership

This chat is the orchestrator: it owns priorities, delegation, synthesis, and installation and release decisions. Delegate all implementation, reproduction, testing, builds and PR execution to subagents by default, or to an explicitly separate chat/session. Do not execute that work directly in this chat or create new chats automatically. Make routine product and engineering choices, explain material tradeoffs, and give the owner one recommendation with evidence instead of a menu of implementation choices. Submit all changes through PRs.

The owner continues normal use, installs a specifically qualified candidate, supplies device-only facts when needed, completes identity/legal/store-account steps, and authorizes spending and public communications. Prepare the exact result before requesting unavoidable approval. General delegation does not authorize erasing data, buying a domain, sending outreach, publishing social posts, or announcing a public release.

Personal usage analysis stays private. Keep exports, note contents, anonymous identifiers, account details and personal usage aggregates out of this public repository, issues and PRs. Include only necessary aggregates in the private owner brief. Use the Codex in-app browser first for live dashboards and store accounts.

## Product priorities

Serve households in the first weeks of puppy toilet training. Help them record what happened quickly, see the last potty break or meal, and understand a developing routine.

1. **Protect the current record.** Save an external backup before update/signing transitions. Resolve any gap between ongoing phone logging and the cloud copy. Check account, selected puppy, sync state, connectivity, pending operations and server acknowledgement before choosing a fix. An old cloud copy alone cannot establish the cause.
2. **Make quick logging dependable.** App, widget and notification actions must save exactly once, remain responsive with populated history, and survive process death. Prioritize last-log visibility, easy time correction and undo.
3. **Qualify one release.** Finish data safety, account deletion, supported sharing flows, signing and exact-artifact runtime checks. Fix demonstrated defects before optional cleanup.
4. **Get external evidence.** Recruit a small group of new puppy households. Establish whether they can install, log and return without help.

Pause new themes, speculative voice features, activity expansion, further navigation redesigns and general pet-management work. Retain supported capabilities. Do not add compatibility layers without an explicit requirement; preserving actual saved data is a release requirement.

## Release evidence checked November 12

Refresh this evidence before every install or publication recommendation.

| Area | Finding and consequence |
| --- | --- |
| Published APK | [v1.12.3](https://github.com/patrickchin/puptime/releases/tag/v1.12.3), October 29, source `aa4c471`. It predates newer sharing and notification work. The latest-release badge does not qualify the next install. |
| Signing | The [APK build run](https://github.com/patrickchin/puptime/actions/runs/40810306613) reports `CN=Android Debug`. Establish production signing and the data-preserving update path before Play distribution. |
| Source checks | Main `fb092d8`, November 10, has [passing source checks](https://github.com/patrickchin/puptime/actions/runs/42800442628). |
| Runtime checks | The [main iOS run](https://github.com/patrickchin/puptime/actions/runs/42800442486) compiled the app/widget and passed 12 of 13 Maestro flows. Side-navigation/notification preferences failed at `settings.notifications.deviceDelivery`; later account/onboarding qualification was skipped. Investigate the failure rather than equating compilation with runtime acceptance. |
| Release-critical work | Review [native account deletion #178](https://github.com/patrickchin/puptime/pull/178), [async data safety #179](https://github.com/patrickchin/puptime/pull/179), and [sharing acceptance #173](https://github.com/patrickchin/puptime/pull/173). [Cleanup #180](https://github.com/patrickchin/puptime/pull/180) is optional unless a demonstrated release defect depends on it. |
| Store setup | Verify store eligibility, app records, membership, agreements and uploaded-build availability in the relevant consoles. Repository configuration alone does not establish these gates. |
| Store artifact | The Android workflow builds APKs. AAB generation, upload signing, Play App Signing and submission configuration still need qualification. |
| Asset rights | [Bundled narration](../assets/puppy-care/audio/README.md) was generated for noncommercial use. Default commercial candidate: omit those recordings and retain written guides. Review website distribution too. Regeneration requires suitable rights and an approved budget. Upgrading later does not retroactively license old recordings. |
| Cloud charging | The server grants development access. Billing is not implemented. Do not sell subscriptions or expose an unrestricted development entitlement as a production business model. |

## APK install decisions

**Current verdict: Hold.** Protect current phone history and qualify backup freshness first. A merged PR or successful build does not alone justify another installation.

Request at most one routine owner install per week. Urgent data-loss or security fixes can justify an earlier qualified candidate. Give an explicit `Install`, `Optional`, or `Hold` verdict. For `Install` or `Optional`, include the exact version/build, source commit, immutable download link, checksum, tested upgrade path, reason and owner action. For `Hold`, identify the blocking gates and next action; an unqualified candidate needs no download link.

Before an update, save an activity CSV through the system share sheet to storage outside the app. Verify the file and restore a copy into a disposable installation. Automatic snapshots do not protect against uninstalling or clearing app storage. CSV contains activity, not a complete settings backup. Keep the original installation and backup intact.

Never ask the owner to uninstall to bypass a signature mismatch. Compare package, certificate fingerprints and version code first. A debug-to-production signing change may need an explicitly planned backup/restore transition. Establish how Play-generated APKs and GitHub APKs will coexist; do not promise interchangeable updates without signing evidence.

## Candidate gates

- Passing source checks at the candidate commit and a triaged runtime baseline. Per AGENTS.md, shared UI verification defaults to a dedicated iOS Simulator; Android-specific behavior/configuration and the Android release/upgrade artifact also need Android checks. A green Android smoke test cannot waive an unresolved shared-behavior failure.
- Populated-history logging, time edits, undo, notes, restart and offline operation. Local editor/detail changes must not redraw unchanged history rows.
- Real Android widget and quick-notification saves, reminder permissions/timing, and process-death recovery. Enabled reminder settings do not establish notification delivery.
- Upgrade from the installed release against representative copied history. Preserve puppies, IDs, notes, estimates and current edits.
- Transactional CSV import/export and automatic backup recovery, including failure handling, on disposable data.
- For cloud-enabled flows, demonstrate freshness, offline-outbox replay, retries, account/puppy isolation, conflicts, deletion and relevant sharing revocation against the deployed service.
- Record version, package, certificate and checksum. Inspect the exact build configuration for synthetic collectors, fixtures and intended production variables.

## Beta and public release gates

For closed beta, meet the candidate safety gates, resolve owner-reported data-loss/sync issues, and get a production-signed AAB accepted by Play's internal track. Check the final artifact against current [target API policy](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) and [16 KB compatibility guidance](https://developer.android.com/guide/practices/page-sizes). Complete privacy policy, Data Safety, support contact, content rating, countries and deletion flows. Provide a direct beta entry and feedback route on the website.

Keep cloud beta access bounded and explicitly free during testing, with verified service limits and failure visibility. Do not require payment details or promise permanent free cloud. Planned monthly/yearly cloud subscriptions need separate validation and production entitlement work.

For public release, resolve beta defects and qualify the exact submitted build. There must be zero unresolved data-loss, account-access or cross-puppy isolation defects. Obtain production access, policy review, accepted metadata/screenshots, asset rights and approval of the concrete public launch package. Prepare a distribution halt/rollback procedure that preserves local records.

Working external-use gate: among ten nonfounder households, aim for eight to install and save a first log without live help, and six to log on at least three distinct dates during their first week. These are initial decision thresholds, not industry benchmarks or proof of product-market fit. Report counts and individual reasons. Recruit about 20 eligible testers to allow for dropouts.

Google's [new-personal-account rule](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) applies to accounts created after November 13, 2023: 12 testers continuously opted in for 14 days, followed by a production-access application. Verify the actual account requirement. The elapsed testing period does not guarantee approval.

Public cloud requires production access controls and a verified cost/support plan. If it is not ready, use a tested free local release with cloud enrolment held to private beta. Do not add billing just to meet a date. Existing cloud users must retain a safe access/export path.

iOS follows the same functional scope after its failing runtime checks are fixed. Verify membership, agreements, current SDK requirements, the exact uploaded build, TestFlight availability and [in-app account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/). Android feedback does not establish iOS distribution readiness.

## Target sequence

Dates use Asia/Shanghai. These are conditional windows, not promises to ship an unsafe build.

| Window | Outcome |
| --- | --- |
| November 12–18 | Protect phone history, investigate backup freshness, settle release-critical PRs, resolve CI failures, prepare signing and asset-rights changes. |
| November 19 onward | First qualified owner candidate, followed by internal/closed beta when gates pass. If blocked, report the specific cause and revised window; hold the existing installation. |
| Following two weeks | Test with 12–20 eligible households, address concrete failures and prepare listing, website and demo assets. |
| Early December or later | Earliest plausible public window if the qualifying closed test starts November 19. Fourteen full days end around December 3; production-access and store review follow. Actual gates determine the date. |

## Name and positioning

Keep **Puptime**. Recommended store name: **Puptime: Puppy Potty Log**. Recommended domain: **getpuptime.com**, with **usepuptime.com** as fallback. Keep `puptime.pages.dev` for beta.

November 12 Verisign checks returned no registration record for [getpuptime.com](https://rdap.verisign.com/com/v1/domain/getpuptime.com) and [usepuptime.com](https://rdap.verisign.com/com/v1/domain/usepuptime.com). This does not establish registrar availability/price, handle availability or trademark clearance. Check name conflicts in the launch markets before purchase. Do not pursue acquisition of `puptime.com`; rename only for a substantive conflict. **PupCadence** is a preliminary rename fallback needing its own checks.

Suggested message: **A free puppy log for the first weeks at home.** Explain the result: **See when your puppy last went, and how their routine is taking shape.** Validate the wording with testers.

[Doggy Time](https://www.doggytime.app/), [Pup to Date](https://puptodate.com/) and [PupTempo](https://play.google.com/store/apps/details?hl=en&id=com.bilaal5279.puptempo) already cover reminders, widgets, sharing or local logging. Demonstrate Puptime's experience; avoid unsupported uniqueness claims or an AI/GPS feature race.

## Marketing with little owner involvement

Default spend is zero until nonfounders successfully use the app. Use one owned destination, a few trainer/class introductions and one reusable demo. The owner forwards a prepared invitation and occasionally supplies real puppy footage; Codex prepares everything else for review.

1. Recruit five new-puppy households through existing relationships. Prepare one short invitation with installation and feedback instructions.
2. Prepare a kit for two or three reward-based trainers or puppy classes, aiming for another five households per introduction. Send only with explicit instruction. Community beta invitations require permission under the community rules and founder disclosure.
3. Once the build qualifies, make the primary website action **Get the Android beta**, with accurate availability and a feedback route. A source-code visit is not an installation conversion. Keep analytics consent separate from beta access.
4. Prepare one 20-second quick-log → saved history → routine demo. Reuse it in up to two posts a week; stage drafts for approval. Keep the founder off a daily multi-channel posting schedule.
5. Improve three existing guides around toilet training, getting started and first nights, connecting them to the beta. Avoid mass content generation.

Read r/puppy101 for customer language, but do not advertise there: its [rules](https://www.reddit.com/r/puppy101/comments/cdz83a/) prohibit self-promotion. Do not post covert recommendations or fabricate testimonials. Defer paid ads, Product Hunt, referral software and elaborate funnels until they solve an observed problem.

## Measurement and cadence

Keep a private operating brief: what changed, install verdict, at most three priorities, remaining release gate and the owner's exact action, if any. Refresh live evidence before consequential recommendations. An active Codex automation, **Lead Puptime product and release reviews**, schedules these reviews for Monday and Thursday at 10:00 Asia/Shanghai. This is a product operating review, not continuous monitoring. Local work requires the computer and desktop app to be running; verify execution in the Scheduled view and report meaningful changes or required owner actions.

Confirm hosted native telemetry receipt before interpreting it; see [app telemetry](app-telemetry.md). Analytics are opt-in. Anonymous IDs represent installation consent periods, not people. Widgets/headless logging are excluded from foreground creation telemetry. Screen-time increments overlap navigation dwell. Keep QA fixtures separate, use completed local dates consistently, and distinguish activity occurrence from sync acceptance.

Track first-log completion, distinct first-week logging dates, quick-log reliability, recovery success, cloud freshness and reasons for stopping. Supplement optional telemetry with consented feedback and privacy-minimizing exports. Logging less because training succeeded can be success. Missing events can mean disabled collection, offline or local-only use; they do not prove abandonment.

Use the project skill and marketing context in `.agents/`. Selected roadmap, GTM, launch and store-listing skills support decisions; current official policy and artifact evidence take precedence. Maintain one ordered backlog rather than creating more planning systems.
