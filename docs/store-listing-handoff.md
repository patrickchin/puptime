# Store listing source and handoff

Prepared November 15, 2026 against `e7a95c8`. These are reviewable candidate drafts, not saved store settings, an uploaded build or publication authorization. Live console findings belong in the private release brief; omit account identifiers, financial details, screenshots, inboxes and credentials from public files and PRs.

## Concrete metadata

| Field | Apple source | Google Play draft |
| --- | --- | --- |
| Name | **Puptime: Puppy Potty Log** | **Puptime: Puppy Potty Log** |
| Subtitle / short description | **Potty, meals & puppy routines** | **Log potty breaks and meals. Follow your puppy's routine, even offline.** |
| Description | [Fastlane description](../fastlane/metadata/en-US/description.txt), mirrored in [store.config.json](../store.config.json) | Exact `fullDescription` in [listing.json](../store/google-play/en-US/listing.json); currently the same Apple-source draft |
| Promotional text | [Fastlane promotional text](../fastlane/metadata/en-US/promotional_text.txt) | No Apple-style promotional-text field supplied |
| Review instructions | [Review notes](../fastlane/metadata/review_information/notes.txt); private contact/access details must be supplied separately | App-access instructions must be prepared for the qualified Android build; no login or contact details are embedded in the draft |
| Marketing / privacy | Existing Puptime website and [privacy URL](../fastlane/metadata/en-US/privacy_url.txt) | Use the qualified public website/privacy URLs when the app record is prepared |
| Support / deletion | Current source support URL points to public GitHub issues; verify a suitable support destination and private request channel before submission | A monitored public support email and qualified external deletion URL must be supplied before submission; no private inbox is nominated here |

Apple limits the description to 4,000 characters, promotional text to 170 and keywords to 100 bytes. Google limits name/short/full description to 30/80/4,000 characters. These drafts fit those limits; recheck after edits. [Apple field reference](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information), [Google listing fields](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en).

The copy describes local offline logging plus optional cloud activation and default-off usage analytics. It must not be replaced with a blanket “no account, server or analytics” claim. Account-free local use and optional service collection can coexist. Final privacy declarations follow the actual submitted binary and enabled services in the [worksheet](store-readiness.md#app-privacy--data-safety-worksheet), not just the promotional text.

## Pricing direction

The [operating plan](product-operating-plan.md) and website describe free local logging without an account; paid cloud is a later phase with no final price, trial or billing launch approved. The upfront paid-app sequence in [RELEASE_PLAN.md](../RELEASE_PLAN.md) is explicitly historical and must not drive a new listing. Existing GitHub downloads establish neither a store price nor a selected Play pricing model.

**Recommendation for the first store listing: free download with free local logging**, consistent with that direction. Treat this as the prepared store recommendation, not evidence that the owner has made or authorized the Play Console choice. Do not set a price, create a subscription or promise permanently free cloud in this preparation. Once an app has been offered free on Play, it cannot become a paid download under that package; separately qualify any later in-app cloud offer. [Google pricing rules](https://support.google.com/googleplay/android-developer/answer/6334373?hl=en).

Apple's developer agreement covers free distribution; selling an app or offering In-App Purchases requires its Paid Apps Agreement. Keep any paid-route financial setup separate from the current free-download recommendation. Only the Account Holder accepts required Apple agreements. [Apple agreement scope](https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements).

## Source-to-console checklist

1. **Freeze the release facts.** Identify the exact qualified source, artifact, identifier, version/build, service environment, signing and asset-rights receipts. A ready/available older upload is not proof for the new candidate. Do not change app versions or choose a build merely to make a draft match.
2. **Reconcile the text.** Compare the saved name, description, URLs, privacy answers and screenshots with these files and the selected binary. Replace obsolete local-only/no-analytics claims. Reuse PR #157's specifically owner-approved media after accuracy and soundtrack-rights checks; that permission does not extend to diagnostics or other history.
3. **Give reviewers working access.** Account-free logging does not exempt optional account features from review. Supply current private contact details and a dedicated durable review account/access procedure through the store. Prove passwordless delivery is usable during review; do not invent static passwords or share the owner's provider credentials. Include access to cloud/deletion features actually submitted. [Apple review access](https://developer.apple.com/help/app-review/before-submitting-for-review/complete-review/).
4. **Verify release controls.** The Fastlane lanes request `automatic_release=false`. Check the saved console option separately and select manual release during a separately authorized console update. Submission and public release remain distinct authorizations. [Apple release options](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option).
5. **Establish the Play app and track deliberately.** A repository package or accessible developer account is not an app record, uploaded AAB, production-access grant or signing acceptance. App creation includes declarations/terms and needs its own authorization. Confirm actual account/app eligibility; if Google's new-personal-account rule applies, complete at least 12 continuously opted-in testers for 14 days and apply for production access. Internal testing is optional. The suggested five-household product trial is separate and optional. [Play setup](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en), [conditional testing rule](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).
6. **Record acceptance privately.** Keep a dated before/after checklist with the selected artifact, final declarations, qualified support/deletion destinations, reviewer access and actual console result. Source merges, metadata uploads, review submission and public availability are separate outcomes. Stop at the precise missing gate instead of claiming the checklist is complete.

This PR preparation performs no console changes, agreement acceptance, app creation, build, upload or publication. The [store checklist](store-readiness.md) retains signing, final IPA/AAB, Android-specific configuration, delivered-email/deletion and support-intake gates independently of any optional product trial.
