# Free Android beta handoff

Prepared November 25, 2026. This is a concrete preparation package for Play **internal testing**. It does not claim an app record, accepted declaration, uploaded AAB, qualified provider session or release. Keep console evidence, identities, access instructions and artifact receipts private. Public production needs its separate approval.

## App record and listing

Use the existing package `com.patrickchin.puptime`, default language English (United States), category Lifestyle, and the free-download recommendation in the [listing handoff](store-listing-handoff.md). Do not create a new package to work around signing. The exact title, short description and full description are already prepared in [the Google Play listing](../store/google-play/en-US/listing.json).

Reuse only the specifically approved PR #157 screenshots and preview after checking that they depict the accepted app, and checking the soundtrack rights. The website's design concept is not a screenshot of the app. A new demo, domain, paid account-management tool or narration purchase is unnecessary.

PR #157's captured screenshot/preview package is for iPhone and iPad; it does not establish Android capture or current-candidate accuracy. Do not relabel it as measured Android media. Initial internal testing can start before full app setup and may show a temporary name/listing before the first review. Prepare the listing now, but do not make new promotional media a prerequisite where the actual console does not require it. [Google internal-test guidance](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).

The console handoff needs a monitored support email, the verified privacy-policy URL, the qualified external account-deletion URL, actual target countries and the accurate audience/content-rating answers. Do not put private contact addresses, reviewer credentials or QA identities into this document. The Account Holder supplies or confirms legal identity, required terms/declarations and signing-key authority. Do not accept terms through automation.

## Prepared Data Safety choices

Use the [existing data-path worksheet](store-readiness.md#app-privacy--data-safety-worksheet) and the submitted artifact's actual service configuration. An app active exclusively on the internal track is exempt from the public Data Safety section; prepare these answers now for closed/open/production entry instead of inventing an internal-track blocker. [Google guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en).

| Candidate data path | Prepared answer to reconcile in the console |
| --- | --- |
| Optional account | Email address, name and provider user ID; optional; app functionality/account management. Verify actual enabled providers and returned fields. |
| Explicit cloud sync | User-generated notes/activity/routines/preferences and optional dog profile photo; optional; app functionality. Do not describe pet content as automatically outside user-data declarations. |
| Opt-in analytics | App interactions and installation/session identifiers; optional; analytics. Include finite handled-operation diagnostics if the candidate contains them. Default-off does not mean no collection. |
| Dictation | Review audio/ephemeral and service-provider treatment against the actual Android recognizer. Puptime does not retain the recording; dictated notes follow the local/cloud choice. Do not guess an exemption. |
| User-shared support reports | Local export is not automatic developer collection. Verify the chosen private intake, actual receipt and retention before declaring support/diagnostic collection. |

Declare encryption in transit only after verifying the artifact's HTTPS endpoints. Do not claim end-to-end encryption. Review collection versus sharing against each provider arrangement. Verify the final Android manifest's actual permissions, including microphone, notifications and exact alarms; source configuration is not a measured manifest.

## Reviewer and service acceptance script

Prepare this as a private, user-assisted run on a disposable QA identity. Credentials and email codes are entered privately by the user. A public capability GET is safe preparation; it is not delivered-email, provider or deletion acceptance. Do not send a code, create/link an account or delete anything automatically to populate a receipt.

1. Install the exact accepted Play-delivered candidate using the qualified update route. Complete setup with local use, log an entry offline, restart and confirm it remains.
2. Open My account. Test each sign-in method actually offered by this Android build: browser OAuth for Google/Apple where enabled, and delivered email OTP. Preserve the system browser/SDK route; do not inject cookies or fabricate a static OTP password.
3. With a newly admitted disposable tester, verify the authenticated account's actual `canSync`/`canExport` response and the visible enable-cloud action. Record any beta cohort or operator grant required by the deployed service; provider capability flags do not establish this access. Current source grants authenticated development access to non-deleting accounts without a subscription or per-account beta-grant operation, but this is not deployed-service acceptance. Keep history local until explicitly enabling cloud access. Use synthetic history to verify comparison/cancellation, correct account and puppy, upload acknowledgement, offline replay, sign-out/recombine and restart. Do not use a personal account's history as the fixture.
4. Use a separate disposable identity for destructive checks. Confirm native deletion requires fresh verification and explicit confirmation, deletes associated cloud history/photos/authentication, preserves device-local logs, and reports any manual Apple step honestly.
5. From a browser without requiring the app, open `https://puptime.pages.dev/delete-account`, verify the disposable existing account through its controlled inbox, review the account, cancel once, then explicitly confirm deletion on a separately authorized run. Verify no unintended account is created and no automatic retry/recreation follows an interrupted response.
6. Supply a durable private reviewer-access procedure for the actual review window. An expiring code in review notes, a local email preview, an owner account or a disabled-authentication shortcut is unsuitable.

Existing users retain their cloud access and export. Do not globally disable cloud, remove account creation or change provider flags to avoid these checks. The [private support/lost-access acceptance](store-readiness.md#remaining-hosted-and-operator-gates) remains an operator gate until its monitored destination is confirmed.

## Tester instructions to fill after track acceptance

The private tester invitation needs the accepted Play opt-in link, allowed tester group, version/build, supported devices and one verified private feedback destination. Keep these concrete values pending until the console supplies them; do not publish a placeholder installation link.

Suggested tester text: “Join the Puptime Android internal test using the approved Play link, install or update through Play, then complete setup and log a few ordinary activities. Local logging is free and works without an account. Cloud access is optional where enabled; no payment details are requested for this beta. Keep a backup before an update. If saving or access fails, preserve the installation and report the version, action and visible error privately. Do not uninstall or clear storage to troubleshoot.”

Check actual account eligibility for internal testing. The 12-testers/14-days rule is a conditional **production-access** requirement for newer personal accounts, not a universal prerequisite to this internal beta. Record an applicable closed-test start only when opted-in testing actually begins. No household recruitment quota or publication date is established here.

## Concrete final-artifact checks

The provisional source/test identity is version **1.13.0**, Android version code **1013000**, and iOS test build **3**. Check actual Play version-code occupancy before freezing or uploading the candidate. These committed fields do not establish an available build, signing authority or store acceptance; do not substitute an unrecorded generated version override.

The Android lead qualifies the exact APK/AAB, signer/update route, package/version, manifest, native libraries/16 KB compatibility, production endpoints and absence of fixtures. Run the existing restricted-audio scanner against **both** archives. The source recording registry is empty; no purchase or regeneration is required.

The font/icon payload and view are described in [Android font notices](android-font-notices.md). Its receipt deliberately does not claim complete software-library coverage. Resolve actual bundled Metro and release Gradle component LICENSE/NOTICE obligations before the final beta build; retain exact provenance and packaged-byte receipts. Historical iOS attribution work and all of PR #220's tooling are not prerequisites to identifying the Android components that actually ship.

The remaining owner handoff is one bounded session: verify console/app eligibility and signing authority, confirm the private support destination, enter approved QA credentials/codes for the prepared service checks, then approve the concrete upload/track action once the exact artifact and declarations are reviewable. Agreement acceptance and public release remain separate explicit owner actions.
