# Native account verification

Use the real iOS app and native BetterAuth SDK with the ephemeral local HTTPS service. The service runs the repository's BetterAuth, D1, Durable Object, SQLite and R2 implementations. It creates disposable identities and synthetic history; it does not inject a session into the app.

The ordinary pull-request workflow retains its full build and test path. Manual account runs can execute independently of the standard UI suite, reusing a successful main build whose native inputs match the selected source ref. Archive digests, native signatures, bundle identity and native-input checks fail closed.

## Compiled hosts are test inputs, not release qualification

The default `native_host_policy=full-suite-success` still requires a completed,
successful main/push iOS workflow. There is no automatic fallback when that run
fails. The explicit `compiled-for-testing` policy admits only a trusted main/push
run whose actual native compile and early test-host upload steps both succeeded
in the selected run attempt. This permits more isolated tests to run while the
full suite is pending or red; those suite results remain visible and required
for release qualification.

The producer uploads the same single simulator ZIP with its existing seven-day
retention immediately after successful compile/ZIP validation. Consumer checks
retain exact native-input equality, artifact nonexpiry/whole digest, deep strict
signatures, arm64 and fingerprints/signature verification of every embedded
Mach-O. The upload must be unique and its timestamps must fall inside this
attempt's successful upload step (a one-second envelope accounts for observed
GitHub timestamp precision). Duplicate or stale artifacts fail closed; no
artifact overwrite or deletion is introduced. The consumer rechecks run attempt,
source and artifact metadata after download, before creating a simulator.

Use the additional policy only deliberately:

```sh
gh workflow run ios-simulator.yml --ref <reviewed-test-source-ref> \
  -f suite=accounts -f account_case=<one-case> \
  -f native_host_run_id=<compiled-main-ios-run> \
  -f native_host_policy=compiled-for-testing
```

`native-provenance.json` records the admission policy, actual observed full-run
status/conclusion and selected attempt, alongside native hashes. Its
`releaseQualified` is always false: a passing isolated test or a compiled
simulator host is not a release certificate. Full standard/conversational,
SQLite-fault, SDK, deletion and final candidate/provider/store gates remain
separate requirements. Read the observation timestamp rather than treating an
in-progress snapshot as the workflow's eventual result.

The iOS Maestro **driver startup** bound is 300 seconds after a measured 180-second
startup expiry occurred just before the driver's HTTP server became available.
Application assertions, flow/command/overall deadlines, Android and private
authentication handoff timers are unchanged. Original-runtime verification honors
a supplied driver bound instead of forcing 180 seconds.

## Case selection

| Manual case | Evidence |
| --- | --- |
| `baseline` | Guest logging, native sign-in, explicit enrollment, signed-in logging, logout, same-account combine and a genuinely new-device restore of every original event. The restore preflight inspects all 14 tables and shared journal, widget timeline and backup history. The final restart checks event bodies and pending work. |
| `comparison` | Same-name and different-name histories, both cancellation paths, distinct puppy identities and explicit combination without duplicate or rewritten events. |
| `offline` | HTTP and WebSocket outage, pending writes across restart, exact native acknowledgement/drain, committed response loss and identical replay, pending logout cancellation, online logout and fully disconnected logout/rejoin. |
| `isolation` | Actual server session expiry, another native account's queue fence, no attempted enrollment/push, cancellation/restart, explicit logout and return to the original account. |
| `photos` | Real UIKit selection/crop and decoded JPEG, upload failures, exact transmitted bytes, corrupt-download rejection and byte-exact recovery on a fresh device. |
| `deletion` | Pending-delete cancellation, pre-commit failure and explicit retry, accepted deletion with a lost response, continued local logging and the unresolved safety barrier across restart. |
| `font-notices` | Before sign-in,12 guest logs supply light/dark glyph screenshots and real Settings search→local font/icon notice sheet→scroll/close/back checks. Each notice view preserves all14 tables; only deliberate theme-selection writes are allowed outside those snapshots, and the original projected preferences/history must be restored through UI. Screenshot readability needs independent visual review. No credential entry, enrollment or cloud roundtrip is exercised. |
| `rich` | Real native Settings saves dark appearance, Spanish,15-minute reminder lead and walk widget actions. User-created meal and labeled custom-type routines have edited native-wheel times and enabled reminders; the meal retains its60-minute window. Exact production-projected cloud records, routine IDs/bodies, the custom-label definition and populated log notes must survive same-account logout/rejoin and a genuinely fresh-device restore, while device-only notification/quiet-status choices remain local. Final restart checks all14 tables and unchanged cloud records. |
| `upgrade` | The separately pinned original-archive guest runtime replacement described below. |

`all` selects all eight cases, including both `rich` and `font-notices`, excluding `upgrade`. Splitting pre-authentication notice UI from rich account preservation does not waive either case. A prepared case is not a passing result: each requires its own actual successful execution receipt from its recorded source and matching host; notice readability also requires the four captured images to be reviewed.

```sh
gh workflow run ios-simulator.yml --ref <tested-source-ref> \
  -f suite=accounts -f account_case=all \
  -f native_host_run_id=<successful-main-ios-run>
```

Use the exact source ref recorded in the receipt. A later source with changed native configuration, plugins, dependencies or assets requires a matching newly qualified host. Do not remove those guards to reuse an older app.

Local execution uses the same wrapper and a task-owned iOS simulator:

```sh
GITHUB_REPOSITORY=patrickchin/puptime \
PUPTIME_NATIVE_HOST_RUN_ID=<successful-main-ios-run> \
PUPTIME_ACCOUNT_SCENARIO=baseline \
PUPTIME_NATIVE_HOST_ARCHIVE=<absolute-verified-artifact-zip> \
node scripts/run-hosted-ios-account-case.mjs
```

The optional archive path replaces only acquisition; metadata, digest, signature and native-input validation still run. The wrapper owns simulator creation and cleanup. Keep its output directory fresh between executions.

## Original guest runtime replacement

`verify-ios-runtime-upgrade.mjs` pins two actual original archived apps, including the older PR build's compiled checkout tree. Inspection and execution have separate receipts:

```sh
node scripts/verify-ios-runtime-upgrade.mjs --inspect-only <fresh-receipt-directory>
node scripts/verify-ios-runtime-upgrade.mjs --replace-synthetic <fresh-receipt-directory>
```

Inspection writes `stage: archive-inspection` and `upgradeExecuted: false`. Only successful execution writes `stage: runtime-replacement` and `upgradeExecuted: true`.

Execution creates history, a UIKit-selected photo, a puppy name and nondefault appearance/language/reminder/widget choices in the older original app. It installs the newer original app without uninstalling or replacing either embedded JavaScript bundle, then checks exact tables, saved files, photo bytes, widget state and real cold restarts. The only permitted widget changes are the two documented palette fields.

Both original archives report version 1.12.0/build 1. This proves runtime replacement, not a numeric store update. Their GitHub artifact expiry remains a boundary; retain or rotate an explicitly qualified baseline for later batches.

## Enrolled runtime replacement

This separate local case rebuilds each exact historical source only for the same temporary HTTPS origin, using its corresponding original native host. It preserves native `__text` sections and architectures, the main embedded entitlements and Info.plist while recording the changed JavaScript and ad-hoc signatures.

Prepare fresh private inputs first. The archive cache must contain the completed, digest-verified `older-artifact.zip` and `newer-artifact.zip` originals:

```sh
PUPTIME_RUNTIME_ARTIFACT_CACHE=<absolute-private-cache> \
node scripts/verify-ios-runtime-upgrade.mjs --prepare-enrolled <absolute-new-private-directory>
```

Preparation creates a private manifest and source/host inputs. It cannot install an app, export JavaScript or qualify an upgrade. Its receipt says `stage: controlled-origin-enrolled-preparation` and `upgradeExecuted: false`.

```sh
GITHUB_REPOSITORY=patrickchin/puptime \
PUPTIME_NATIVE_HOST_RUN_ID=<matching-successful-main-ios-run> \
PUPTIME_NATIVE_HOST_ARCHIVE=<absolute-verified-artifact-zip> \
PUPTIME_ENROLLED_RUNTIME_INPUTS=<private-directory>/enrolled-inputs.json \
PUPTIME_ACCOUNT_SCENARIO=enrolled-upgrade \
node scripts/run-hosted-ios-account-case.mjs
```

The older native app runs first, creates and enrolls 12 logs through its actual SDK, then leaves three real offline operations pending. The newer runtime installs without uninstall, reset or reauthentication. Every table and pending payload must survive offline installation/opening; the actual newer SDK must use the original account, drain three exact acknowledgements and retain all 15 cloud events at revision 1. Final cold restart checks all 14 tables and remote events.

A pass uses `stage: controlled-origin-enrolled-runtime-replacement`, `upgradeExecuted: true`, `originModified: true` and `originalInstalledBytes: false`. This case currently uses the local wrapper; it is not a new hosted workflow selection.

## Evidence and release boundaries

Receipts distinguish inspected archives, prepared bundles and executed scenarios. Keep exact source/tree, original/native/bundled hashes, actual platform and relevant source changes together. Session credentials, cookies, OTPs and private keys stay outside uploaded receipts. Prepared source/host manifests remain private. Bounded screenshots may show synthetic names, counts and generated `example.invalid` identities; never substitute an owner’s account. Failure UI diagnostics contain only allowlisted readiness flags and finite route/status categories. Before deleting private Maestro files, the producer projects one unambiguous leaf command into `fixture-command-state.json`: fixed command kind, allowlisted static target ID (or null), numeric sequence and actual `FAILED` or `RUNNING` metadata status. A process timeout never turns `RUNNING` into `FAILED`; missing, malformed or ambiguous command evidence is `UNKNOWN`. No text, input, evaluated command, raw error, stack, trace or path enters this receipt. Existing hosted receipt retention is three days.

Controlled proxy outages do not establish OS airplane-mode behavior. Native email SDK tests do not establish Google/Apple OAuth or production-service qualification. Historical runtime evidence does not qualify a later audio/configuration/asset cut, signing transition or store artifact. Rich preference/custom-routine cloud restoration needs its own executed `rich` receipt; native caregiver sharing remains a separate case. Consult the [operating plan](product-operating-plan.md) for the remaining release gates.
