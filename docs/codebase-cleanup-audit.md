# Codebase cleanup audit

November 11, 2026. Backward compatibility is not required for this cleanup.

The audit covered application entry points, shared screens and domain helpers,
native and browser storage, cloud clients, the Worker and account store, widgets,
verification scripts, dependency declarations, and TypeScript configurations.
Caller searches, an import graph across all platform suffixes, compiler unused
checks, and the existing regression suites informed the removals.

## Changes

| Area | Result |
| --- | --- |
| Profile photo protocol | Removed name-only response projections and capability negotiation from push, pull, history, native exports, and browser exports. Every client receives the current profile schema. |
| Photo upgrade | Removed the one-time metadata checkpoint and baseline restart. Reopening the runtime preserves its cursor, staged enrollment, and pending mutations. |
| Account schema | Replaced the version-3 baseline plus version-4 upgrade with one version-4 definition. Older versions reject without rewriting data. D1 provisioning migrations remain separate. |
| Widget imports | Imports read immutable operation files. Presentation snapshots can no longer resurrect acknowledged or deleted events. Nap completion, puppy scoping, corrupt-file retention, and acknowledgement fencing remain covered. |
| Saved settings | Removed silent recovery of malformed browser JSON into empty/default settings and of unsupported theme/language selections into system preferences. Absent optional settings still initialize normally. Custom-activity reads no longer write derived values, and edits validate retained settings before changing deletion markers. |
| Setup metadata | Removed missing-checkpoint and missing-notification-consent inference, the redundant native AsyncStorage completion marker, and the pre-checkpoint upgrade verification script. Shared-puppy activation now writes the explicit completed checkpoint. |
| Account deletion | Requires the server's current Apple-revocation outcome. Missing or unknown outcomes remain unconfirmed rather than being reported as a successful response. |
| Dead code | Removed the unused activity-combination artwork selector and its test, `supportingIcon` and its unused icon entries, `updateEventTime` aliases, the test-only recovery wrapper, unused imports/destructuring, and the permanently disabled shared-history date-filter branch. |
| Native verification | Separates the intentional full daily-backup read from paginated screen reads and scrolls the editor header into view before closing it. |
| CLI evidence | Removed acceptance of video filenames by the text-only review recorder and updated its runnable check. |
| Compiler checks | Enabled `noUnusedLocals` and `noUnusedParameters` for application and server builds. |

## Explicit states

The live sync subscription now represents `connecting`, `connected`, `waiting`,
and `closed` as a discriminated union. Socket cleanup and retry cancellation are
owned by their corresponding state. A delayed retry must still belong to the
current waiting connection before it can reconnect. Regression checks cover
duplicate close notifications, late socket resolution, disposal, and obsolete
timers after an owner-generation change.

The account controller coordinates authentication, syncing, export, connectivity,
and foreground activity concurrently. Combining those independent operations
into one exclusive state machine would obscure valid concurrency. The local
sync engine already exposes named enrollment, active, and resync phases with
transactional guards. These were retained along with their existing race tests.

## Current behavior retained

Browser/native module variants and browser in-memory activity projections serve
current entry points and previews. They are not old-version aliases. The native
entropy module is selected through the package's conditional import, and spoken
guide scripts remain the source for recording generation and verification.

Enrollment still saves an initial puppy name before a device uploads its first
profile revision. Its revision-zero REST representation therefore remains part
of the current enrollment flow; the misleading legacy label was removed.

Backup checkpoints, SQL locking retries, sync reconciliation, account fences,
runtime cancellation handling, and user-requested local-only setup prevent data
loss or implement current platform behavior. They remain in place.

## Dependency findings

`npm audit` reports 25 advisories in the installed dependency tree: 1 critical,
9 high, 14 moderate, and 1 low. The critical finding is the transitive
`shell-quote` advisory GHSA-pqg4-j6r4-53mv. These findings are outstanding;
this cleanup does not change dependency versions. Several proposed npm fixes
change Expo or widget framework versions, including suggested downgrades, so
they require a separate dependency update with native verification.

## Compatibility consequences

Pre-photo clients, pre-checkpoint setup metadata, version-3 account stores, and
the old browser export form are unsupported. No reset, destructive migration,
or service deployment is performed. Existing supported version-4 account data
continues to reopen without rewriting its rows.

## Verification

- 513 application tests, 10 browser tests, and 136 Worker tests pass.
- Application, iOS, Android, and server TypeScript checks pass with unused-code checks enabled.
- Web and Android exports pass. The iOS JavaScript bundle embeds successfully.
- iOS 26.5 ran the current JavaScript in an existing compatible native host on
  the dedicated `Puptime Native Storage 091c Codebase Audit` simulator. With
  1,000 synthetic logs, history loaded 200 rows; drawer interactions left all
  row counters unchanged, and note editing left the other 199 rows at their
  single initial render. Insights and Settings opened with populated history.
  This used the actual native SQLite SDK and row-render probes, not a native rebuild.
- Chromium rendered the account page with synthetic API responses. Its export
  form contains only `expectedAccount`; Worker tests cover the actual export routes.
- The CLI review-gallery check and verification-script syntax check pass.

Android runtime behavior is assumed to match shared application changes; an
Android simulator was not run. No Android-specific implementation changed.
