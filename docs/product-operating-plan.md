# Puptime product operating plan

Release evidence refreshed November 14, 2026. Refresh the dated checkpoint before another install or publication decision. The next outcomes are a dependable Android candidate and a concrete store-preparation package. Local logging stays free without an account. Qualify saving, history, recovery and optional cloud flows before expanding features. Paid cloud remains a later phase; development access is not production billing.

This plan supersedes the historical paid-app and single-pet roadmaps in [RELEASE_PLAN.md](../RELEASE_PLAN.md). Existing technical contracts and data-preservation requirements still apply.

## Ownership

The root product-owner chat orchestrates priorities, delegation, synthesis and install/release recommendations. Assigned agents carry out implementation, reproduction, testing, builds, independent reviews and PR execution. This restriction applies to the root chat, not to its assigned agents. Use existing sessions or subagents; do not create user-owned chats automatically. Make routine decisions and give one recommendation with evidence instead of a menu of implementation choices. Submit changes through PRs.

The owner continues normal use, installs a specifically qualified update when needed, supplies device-only facts that change a decision, completes identity/legal/store-account steps and authorizes spending or public communication. Prepare the concrete result before requesting unavoidable approval. General delegation does not authorize deleting live data, buying a domain, sending outreach, publishing posts or releasing to a store.

Keep personal records, usage aggregates, account identifiers, diagnostics, exports, screenshots and private evidence manifests out of public repository files, issues and PRs. The separately approved PR #157 media package has the limited store/launch use described below. Use the Codex in-app browser first for live dashboards and store accounts when available; use connected tools or CLI for unavailable capabilities.

## Next three priorities

1. **Confirm dependable recovery and saving.** Complete private acceptance of the qualified recovery update. Check journal access, normal logging and fresh cloud acknowledgement without treating a published APK as evidence of installation or recovery. Preserve an external backup before update/signing transitions.
2. **Qualify the next beta candidate.** Finish the account regression matrix, supported sharing acceptance, exact-artifact upgrade checks, store signing/distribution, privacy/deletion and asset-rights gates. Changes must save exactly once, remain usable with populated history and survive restart. Fix demonstrated defects before optional cleanup.
3. **Prepare stores in parallel.** Complete the [store/privacy/deletion/asset-rights checklist](store-readiness.md), listing drafts and signing evidence while candidate tests run. A small household product trial may be proposed as optional learning; it is not an agreed prerequisite for this preparation or release.

Pause new themes, speculative voice features, activity expansion and general navigation or pet-management redesigns. Preserve supported capabilities and real saved data. Add a compatibility layer only when explicitly required.

## Release checkpoint

Refresh this evidence before consequential install or publication advice. Public release records describe artifacts, not the state of any person's phone.

| Area | Evidence and consequence |
| --- | --- |
| Android recovery APK | [v1.12.5](https://github.com/patrickchin/puptime/releases/tag/v1.12.5) is published. Tested source `cb8034b` and merged tag source `b8f82e0` have the same source tree; the build applies its release-version override. The fix reads previously shipped appearance values without changing stored history or preference values, and retains the photo-transfer and diagnostic fixes. This is GitHub distribution, not store availability. |
| Upgrade qualification | The release record covers an update over the affected published v1.12.4, preserving populated history and backups, restart, an existing widget and notification logging. Independent native checks cover an affected database and fresh cloud combination. Genuine provider/public-service recovery and the broader account matrix are not claimed complete. |
| Next batch | Connection summaries [#186](https://github.com/patrickchin/puptime/pull/186), branding [#191](https://github.com/patrickchin/puptime/pull/191), Settings search [#192](https://github.com/patrickchin/puptime/pull/192), themed confirmations [#193](https://github.com/patrickchin/puptime/pull/193), palette [#195](https://github.com/patrickchin/puptime/pull/195), telemetry metadata [#197](https://github.com/patrickchin/puptime/pull/197) and store/audio preparation [#198](https://github.com/patrickchin/puptime/pull/198) are merged source, **not in v1.12.5**. No newer APK is qualified. Batch these changes after the remaining safety and actual-artifact checks; a source merge alone does not justify another owner install. |
| Completed hosted iOS baseline | [Run 43383649287 at `aacd58f`](https://github.com/patrickchin/puptime/actions/runs/43383649287) passed 13 standard and 17 conversational flows, plus actual native email-SDK guest sign-in, enrollment, sign-out/recombine, baseline restore and account-deletion checks against isolated HTTPS Better Auth/D1/Durable Objects. This includes the #184/#188 driver repairs. Those older helpers checked events/association/pending counts; they did not establish the stronger all-table/fresh-device or genuine provider qualification below. |
| Stronger account and upgrade evidence | [#196](https://github.com/patrickchin/puptime/pull/196), extending the draft [#189](https://github.com/patrickchin/puptime/pull/189) evidence work, remains under qualification. Prepared helpers or queued runs are not passing cases. Obtain actual receipts for all-table/fresh-device restore, original-runtime upgrades, offline writes and pending logout, account/puppy isolation and photo failures/recovery. Native invitation acceptance, caregiver editing/attribution and revocation also need their own execution; the onboarding sharing offer in the 17-flow suite is not that proof. |
| Execution and platform scope | The configured remote workstation remains unavailable and no completed remote-session matrix is established. This does not erase the separate successful hosted baseline above. The shared lifecycle/upgrade matrix is iOS-only by the owner's choice; Android remains required for Android-specific code/configuration and exact APK/AAB acceptance. Keep genuine Google/Apple/provider qualification separate from isolated email OTP, and use only separately authorized test identities, never live personal accounts as fixtures. |
| Native usage visibility | Existing opt-in native screen/time/navigation/action events were verified privately in PostHog on November 14, separately from website analytics. Keep usage figures, identities and dashboard links private. Collection covers consenting foreground use, including returns, not all widget/headless activity or necessarily only one person. [#197](https://github.com/patrickchin/puptime/pull/197) adds build/finite-error metadata for a future binary; it does not add those fields retrospectively to v1.12.5. Provider retention remains unverified; see [telemetry coverage](app-telemetry.md). |
| Store and distribution | [#198's checklist](store-readiness.md) separates production signing, AAB/IPA inspection, agreements, privacy/deletion and console acceptance. These remain distinct from GitHub APK distribution. The [Android APK workflow](../.github/workflows/android-apk.yml) now defaults manual runs to artifact-only (`publish=false`); explicit `publish=true` is required for a GitHub release. [APK/AAB qualification receipts](android-builds.md) do not establish Play signing or store acceptance. Freeze and authorize the candidate before dispatch, qualify Android-specific configuration on Android, and establish the data-preserving signing transition before store distribution. |
| Asset rights | [Original narration](../assets/puppy-care/audio/README.md) was generated for noncommercial use. Merged #198 excludes its imports from the shared app/web registry and disables the unused background-playback configuration; original files and written guides remain. Fresh export/source checks are not final IPA/AAB or Android native-config acceptance. Scan the exact artifact under the [store checklist](store-readiness.md), and check preview soundtracks separately. A later plan upgrade does not retroactively license recordings. |
| Cloud charging | Development access is not production billing. Keep beta entitlement bounded and explicit; paid cloud needs separate production access controls, cost/support validation and billing work. |

## APK install decisions

**New-batch recommendation: Hold; no newer APK is qualified. Recovery recommendation: Install v1.12.5 as an update only if still on v1.12.4.** If it is already installed, continue using it rather than downloading again for a source-only change. Confirm device acceptance privately before calling recovery complete or promoting the next batch.

[Exact APK](https://github.com/patrickchin/puptime/releases/download/v1.12.5/Puptime-1.12.5.apk): package `com.patrickchin.puptime`, version code `1012005`, tested source `cb8034b45a5c74e0ab2c7c60759b5276e3b85664`. APK SHA-256: `82fa41075db35d747360183a2c3ff364e5c4fb4813519135d7a5eb076249a927`. Certificate SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching v1.12.4. See the [release record](https://github.com/patrickchin/puptime/releases/tag/v1.12.5) for qualification limits.

Before updating, verify an activity CSV saved through the system share sheet outside app storage and prove its restore on a disposable fixture. If a current read failure prevents a fresh export, preserve the installation and existing recoverable snapshots; qualify the repair/update path and state the limitation. CSV covers activity, not a complete settings backup. Automatic app snapshots do not protect against uninstalling or clearing storage.

Install over the existing app, open the journal and check **My account** for **Up to date**. If access or sync fails, preserve the installation and investigate privately. Never recommend uninstalling, clearing data or a signature-mismatch workaround. Compare package, certificate and version code first; qualify any signing transition and do not promise interchangeable GitHub/Play updates without evidence.

Batch routine updates to at most one owner install per week. An urgent qualified recovery or security fix can justify an earlier install. Give an explicit **Install**, **Optional** or **Hold** verdict. Install/Optional includes version/build, immutable artifact link, source, checksum, reason, tested upgrade path and the smallest owner action. Hold names the actual blocking gate and next step; it needs no speculative download link.

The published diagnostic export is a bounded **transport and sync-queue report**, not a backup, general crash logger or complete local-storage report. Source change #197 adds optional finite handled-read/write/import failure codes to product telemetry for a future binary; it does not expand that export or diagnose the underlying data class. Neither missing telemetry nor a read-error code proves inactivity, corruption or a healthy cloud copy. Exclude raw values, records, SQL, identifiers and secrets.

## Candidate verification

Use iOS for shared native UI and the selected shared lifecycle/upgrade matrix. Run Android verification when Android-specific behavior/configuration or the final Android upgrade/store artifact is involved; do not duplicate the shared matrix merely for platform coverage. Use the configured remote connection or an authorized hosted workflow for heavy builds and E2E. Keep machine aliases, credentials and checkout paths private. If the remote workstation is unreachable, mark that execution **not run**, while recording any separate hosted receipts at their true source and scope. A specifically authorized bounded local check adds only its stated host/source/fixture evidence. A native compile, SDK fixture pass, final-artifact update and genuine production-provider acceptance are separate facts.

Qualify the changed paths at the exact candidate commit and keep successful source checks, native compilation, runtime behavior and distribution availability distinct:

- Populated-history logging, time correction, notes, undo, restart and offline operation. Local editor/detail changes must not redraw unchanged activity rows.
- Actual widget and quick-notification saves, reminder permissions/timing and process-death recovery. An enabled setting does not prove delivery.
- Upgrade from the last shipped runtime, including state **created by that runtime**, preserved identities/history/pending work and backup recovery. Fresh databases alone are insufficient.
- Account creation/sign-in, offline edits, logout, upgrade, re-enrollment/combine and cold restart using the real native SDK and an isolated actual service. Cover the values really shipped for appearance, locale, reminder and widget preferences, including historical serialized values read by the new runtime. Check preferences separately from activity reads.
- Same-name/different-identity and mismatched-name histories, correct account/puppy targeting, explicit confirmation and cancellation/local-only preservation. Names or counts do not establish identity. Confirm retries do not duplicate history or lose pending work.
- Cloud freshness, outbox replay, conflicts, account deletion and relevant sharing/revocation against the intended service. Do not qualify by changing or deleting a live personal account.
- Transactional import/export and backup recovery, including failures, on disposable data. Inspect the sealed artifact's version, signing and target variables; exclude fixtures and synthetic collectors from a release.

A narrow urgent hotfix can be qualified for its demonstrated failure and update path while broader beta gates remain open. State that boundary. Do not call a bounded fix a full-matrix pass, or manufacture an unrelated gate for a docs-only change.

## Store and beta gates

For Android store testing, meet the candidate safety gates, resolve reported data-loss/sync defects and qualify a production-signed AAB on the intended track. An internal track is an optional starting point, not a general mandatory gate. Verify the actual developer-account requirements in the console. Follow the independent [store readiness gates](store-readiness.md) for privacy, deletion, audio rights, signing, AABs, agreements and declarations; none is replaced by a household trial. As checked November 12, Google's [target API policy](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) requires Android 16/API 36 for new mobile apps and updates. Check [16 KB page compatibility](https://developer.android.com/guide/practices/page-sizes) on the final native libraries/artifact; requirements and deadlines must be refreshed before submission. Complete privacy policy, Data Safety, support contact, rating, countries and deletion flows. Provide direct beta entry and feedback on the website.

Keep cloud beta access bounded and explicitly free during testing. Do not require payment details or promise permanent free cloud. Monthly/yearly subscriptions remain later work, not a deadline shortcut. If public cloud is not ready, a local release is an option only after its actual feature/access configuration and safe access/export for existing users are qualified.

For public release, qualify the exact submitted build and resolve data-loss, account-access and cross-puppy isolation defects. Obtain production access, policy review, accepted listing/media, asset rights and approval of the concrete launch package. Prepare a halt/rollback procedure that preserves local records.

Optional product-learning proposal, not an agreed release gate: if the owner chooses a household trial, assess installation/first logging and repeat use without live help. Earlier five-household recruitment and ten-household activation targets were suggestions, not mandatory prerequisites or proof of demand. Use consented feedback to explain failures. Size any legally required store test from the actual console rule, independently of this optional research.

Google's [new-personal-account rule](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) applies to personal accounts created after November 13, 2023: at least 12 testers continuously opted in for 14 days before applying for production access. Verify its applicability. Elapsed time does not guarantee approval.

iOS follows the same qualified scope. Verify membership, agreements, current SDK requirements, the uploaded build, TestFlight availability and [in-app account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion). Android acceptance does not establish iOS distribution readiness.

## Target sequence

Use Asia/Shanghai dates and conditional windows, not promises controlled by a store.

| Window | Outcome |
| --- | --- |
| November 12–18 | Complete recovery acceptance, restore remote test execution and finish the next candidate's remaining safety, signing and asset-rights gates. |
| November 19 onward | Target internal/closed beta only when those gates pass. Report a concrete blocker and revised window if they do not. |
| Following two weeks | Run an applicable store-required test; optional household feedback can run alongside it if chosen. Fix observed failures and reuse the approved listing/media package after candidate checks. |
| Public release | After the applicable closed test, production-access decision, build/policy review and launch approval. A November 19 closed-test start would make December 3 the earliest eligibility point to apply, not a promised launch date. A later start moves the window. |

## Name and positioning

Keep **Puptime**. Proposed store name: **Puptime: Puppy Potty Log**. Preferred domain: **getpuptime.com**; fallback: **usepuptime.com**. Keep `puptime.pages.dev` for beta.

November 12 Verisign checks returned no registration record for [getpuptime.com](https://rdap.verisign.com/com/v1/domain/getpuptime.com) and [usepuptime.com](https://rdap.verisign.com/com/v1/domain/usepuptime.com). This is not registrar availability/price, handle availability or trademark clearance. Recheck conflicts in launch markets before purchase. Do not pursue acquisition of `puptime.com`; consider a rename only for a substantive conflict. **PupCadence** remains an unvalidated rename fallback.

Proposed promise: **A free puppy log for the first weeks at home.** Supporting message: **See when your puppy last went, and how their routine is taking shape.** Validate it with suitable testers. [Doggy Time](https://www.doggytime.app/), [Pup to Date](https://puptodate.com/) and [PupTempo](https://play.google.com/store/apps/details?hl=en&id=com.bilaal5279.puptempo) already cover reminders, widgets, sharing or local logging; avoid unsupported uniqueness claims or an AI/GPS feature race.

## Marketing with little owner involvement

Default spend is zero until nonfounders use the product successfully. Use one destination, a few trainer/class introductions and the existing [store-listing PR #157](https://github.com/patrickchin/puptime/pull/157) package. The owner approved its specific screenshots and roughly 15-second native preview for store/launch media. Reuse that package after candidate accuracy, asset-rights and store checks; do not commission a duplicate demo. This approval does not authorize publishing diagnostics, raw exports or other personal history.

1. If a household trial is chosen, prepare one short invitation and installation/feedback instructions. The previously suggested first five households are optional; do not hold store preparation or manufacture a release gate around that count.
2. Prepare introductions for two or three reward-based trainers or puppy classes. Send only when explicitly authorized. Community invitations require permission under the rules and founder disclosure.
3. Once available, make the website's primary action **Get the Android beta**, with accurate access and feedback instructions. A source-code visit is not an installation. Keep analytics consent separate from beta access.
4. Reuse the approved preview/screenshots in the qualified listing and up to two posts a week. Stage drafts for review; avoid a daily multi-channel owner workload.
5. Improve three existing guides around toilet training, getting started and first nights, connecting them to the beta. Avoid mass content generation.

Read r/puppy101 for customer language, but do not advertise there: its [rules](https://www.reddit.com/r/puppy101/comments/cdz83a/) prohibit self-promotion. Do not post covert recommendations or fabricate testimonials. Defer paid ads, Product Hunt, referral software and elaborate funnels until there is a demonstrated need.

## Measurement and cadence

Keep a private operating brief: decision first, what changed, at most three priorities, exact install verdict, next release gate and the smallest necessary owner action. The existing **Lead Puptime product and release reviews** automation schedules Monday/Thursday reviews at 10:00 Asia/Shanghai. This is scheduled work, not continuous monitoring. Verify execution in Scheduled; local work needs the relevant computer/app available. Report meaningful changes, failures or required owner actions, and avoid creating a duplicate schedule.

Before interpreting optional native telemetry, confirm collection consent, coverage, receipt and sync freshness; see [app telemetry](app-telemetry.md). Anonymous installation/consent periods are not people; widget/headless events and foreground screen time have different coverage. Missing events can mean disabled collection, offline or local-only use, not abandonment. Keep QA fixtures separate and distinguish activity time from sync acceptance.

Track first-log completion, distinct first-week logging dates, quick-log reliability, recovery success, cloud freshness and reasons for stopping. Logging less because training succeeded can be success. Supplement optional telemetry with consented feedback; keep personal evidence private. Use the project lead skill and selected roadmap/GTM/launch/store skills in `.agents/` when relevant, with current official policy and artifact evidence taking precedence. Maintain one ordered backlog.
