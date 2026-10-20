# Cloud development milestone

This milestone implements optional accounts and working offline sync. Payments,
trials, publication and advanced account-recovery workflows are deferred.
Implement native functionality for both platforms; verify native behavior on
iOS. Android static type checks do not establish Android runtime acceptance.

## Account and upload boundary

Local logging needs no account. Apple, Google and email-code sign-in use Better
Auth and its official Expo adapter. Signing in loads the account summary but
does not associate the local puppy or queue its history for upload. The person
explicitly enables cloud sync, confirms an existing puppy before combining
histories, or restores that puppy during fresh setup.

Authenticated development accounts can sync and export immediately; there is
no subscription record, trial timer or `/api/cloud/trial` endpoint. The public
configuration contains only `protocolVersion` and configured `providers`.
`account.cloud` contains only `canSync` and `canExport`. These are access flags,
not an indication that a device has enrolled or uploaded anything.

The tracked `.env` contains only the public development API address, so ordinary
Expo and simulator Release builds include account access. Server/provider
credentials remain Worker secrets. For local Debug testing, override the address
and `EXPO_PUBLIC_CLOUD_ALLOW_LOCAL=1` in `.env.local`; HTTP stays forbidden in
Release. No production/store release is implied by this development endpoint.

Local creates, edits and deletes save first in SQLite. An enrolled device
retains its ordered outbox across interruption and retries with the same
operation IDs. The server reconciles edits and commits the result, immutable
revision, cursor and operation receipt atomically. A reconnect drains retained
work; a revoked or expired session requires sign-in again. Cloud data and local
logs remain independent of that session's lifetime.

## SQL ownership

| Database | Responsibility |
| --- | --- |
| D1 `AUTH_DB` | Better Auth users, sessions, provider credentials, verification and rate limits; one small app table fences deletion cleanup |
| Per-account SQLite Durable Object | Puppies, enrolled devices, constrained current event/routine fields, ordered revision history and duplicate-safe operation receipts |
| Native SQLite | Puppies, typed logs/routines, preferences, local history, upload outbox and cloud checkpoints |

Top-level `server/migrations/0001-auth.sql` is the fresh D1 baseline. Account
data uses a separate per-account database; applying D1 migrations does not
initialize that database. Its constructor initializes its own schema within a
synchronous transaction. See [the schema map](cloud-schema.md) for the explicit
account SQL and query indexes.

Stable puppy IDs and puppy foreign keys make ownership support multiple
puppies. The first UI presents one. Events and routines use SQL columns rather
than JSON payloads. Small preference/profile payloads and immutable protocol
snapshots remain validated JSON; they are not used to scan the activity feed.
Do not describe this as an entirely normalized schema.

Better Auth owns identity/session deletion. The app's existing before-delete
hook retires the associated puppy store and fences provider credentials during
cleanup. It does not add deletion receipts, custom recovery identities or a
second authentication system.

## Development reset and acceptance

There are no released users. This consolidated baseline intentionally replaces
the old development migration chain. An existing D1 database that already
applied the old `0001` cannot be updated by applying it again: reset only the
dedicated Puptime development database, then apply the baseline before deploying
the new contract. Do not apply the changed file over an existing migration
ledger or reuse another product's database. No deployed reset is implied by a
passing local test.

Qualify the same account/log/sync contract against a fresh local service and the
deployed development service. Cover optional sign-in with existing local logs,
explicit upload, a confirmed second device, offline edits and restart,
duplicate retries, concurrent edits, session expiry/re-authentication and owner
isolation. Review videos should show about six representative journeys; keep
technical test output as text. Never record credentials or verification codes.

Historical verification ledgers describe earlier code and environments. Their
trial, migration-preservation and release gates do not define this milestone.

## Current verified checkpoint — October 20, 2026

Baseline main `ad54af8` includes the shared-native/explicit-SQL work, prefixed entity IDs,
shared log history and the historical-footage gallery update. Its
[source checks](https://github.com/patrickchin/puptime/actions/runs/39429174179)
passed: 386 Node tests, nine web tests, 98 Workers tests, default/iOS/server
types, the web build and both native JavaScript exports. A separate Android
static type check passed on that frozen source; none of these checks establishes
Android runtime behavior.

The ID source `814db2dd` and history source `4a56d789` each passed a fresh iOS
Release build and the standard Maestro suite in their respective
[ID run](https://github.com/patrickchin/puptime/actions/runs/39413545899) and
[history run](https://github.com/patrickchin/puptime/actions/runs/39419151941).
The [combined main native run](https://github.com/patrickchin/puptime/actions/runs/39429174087)
also completed successfully, including its Release build and Maestro step.
Thirteen flows were selected in source; the retained evidence does not include
parsed JUnit counts. The subsequent
[native Apple run](https://github.com/patrickchin/puptime/actions/runs/39443848026)
passed its Release build and Maestro step and completed successfully. These
automated suites do not establish genuine provider authentication.

The public API Worker version is `4fe8d9e9-5ef1-4f54-bd2f-9ee745353bc5`, with
server tree `c054dad3590f80bab84d92693b5473dcefa95f0a` from reviewed source
`151c6f2`. It accepts the configured Apple Services ID and Puptime's native
bundle audience through Better Auth's built-in verifier and requires a nonce
for Apple ID-token sign-in/linking. Deployment preserved the existing D1 and
Durable Object bindings, data and secrets. The actual Pages API origin returned
its configured providers and rejected anonymous account/export requests.
The local service on port 8793 retains the earlier `ad54af8` source and its
existing persistence; local email/sync demonstrations use a task-owned proxy.

| Actual SDK journey | Verified scope |
| --- | --- |
| Public browser email | A real delivered code completed sign-in, reload retained the session and sign-out worked. The account had no saved puppy and nothing was uploaded. |
| Public browser Google | Sign-in completed through the existing Google provider session, account navigation retained it and sign-out worked. No new scope grant or puppy upload occurred. |
| Public browser Apple | The SDK reached Apple's authorization page; authentication has not completed. |
| iOS Release email | The fresh `814db2dd` CI app used a real delivered code and the official native SDK against the public Pages API, without Metro, a local API override or session injection. Sign-in preserved every local SQL table without association or upload. Explicit enable then uploaded the original event once; all 15 initial operations were acknowledged with zero pending. Authenticated cold restart preserved every SQL table and did not duplicate that event. |
| iOS Google, earlier browser flow | Release `814db2dd` completed the official SDK's browser provider flow against Pages. Sign-in preserved SQL without uploading; explicit enable uploaded both original events once, and authenticated cold restart preserved SQL. This does not qualify the replacement native Google SDK. |
| iOS native Apple | Fresh local Release `151c6f2` used the official Expo Apple system sheet and private password confirmation against Pages. Quiet cancellation preserved all 14 SQL tables. Genuine sign-in preserved domain data without association or upload; only the expected setup-step marker advanced. Explicit restore hydrated the existing puppy and 14 cloud records without outbound mutations. One new native log then uploaded once with revision 1 and an exact remote echo. Authenticated and recorded cold restarts preserved all 14 SQL tables, with zero pending. |
| iOS native Google | Fresh integrated local Release `a1bb417` completed genuine sign-in through the official Google iOS SDK and its secure system browser against Pages. Quiet cancellation and sign-in preserved all 14 SQL tables without association or upload. Explicit same-puppy confirmation and enable kept both original event IDs at revision 1 and all 16 cloud bodies unchanged, without extra mutations. Authenticated and recorded cold restarts preserved all 14 tables. |
| Local iOS email and restore | Current `ad54af8` in a qualified Debug shell completed SDK email-code sign-in using a synthetic local address, explicit upload, restart, second-device restore and passive incoming-edit convergence. This local code preview is separate from real Resend delivery. |
| Local iOS history | A separate account-free fixture with 1,001 events and 61 target revisions preserved every SQL table on Cancel. Confirmed restore added one target revision while 1,000 unrelated events and other domain/sync tables stayed exact. |
| Local iOS automatic recovery | An actual `ad54af8` cold-start outage left an operation pending after the service returned. Fixed source `0472307` retained that exact event/operation across another closed-proxy cold restart, then uploaded it automatically once with revision 1 and an exact remote echo. No Retry, foreground action or lifecycle change occurred between restoring the proxy and the SQL proof; the outbox drained and unrelated data stayed unchanged. This used the compatible Debug shell and local service. |

Configuration flags and authorization-page handoffs are not completed sign-in
evidence. Current first-open, local email/upload/restart, restore/incoming-edit
and populated-history clips have been recorded; see [review videos](review-videos.md)
for their source and environment limits. Short native Apple and Google restart
clips and the offline-recovery clip are also recorded; the final gallery cohort
and obsolete-media cleanup are being assembled. Private provider authentication
is omitted from footage. Earlier footage stays labelled historical until it is
retired. Android runtime, product web work, payments and publication remain
deferred.

## Earlier qualification and deployment checkpoints

The core change in PR #119 passed its own source checks, fresh iOS Release build
and all 13 standard Maestro flows. Its local HTTP matrix used two persistent
SQLite clients and 1,000 initial logs to cover interrupted upload/restore,
restart, duplicate receipts, concurrent edits, owner isolation and session
renewal. Those sessions were administrative fixtures.

Separate local iOS SDK checks covered signup without upload, explicit enrollment
preserving the original event, cold restart, offline create/edit/delete through
process death, automatic queue drain, duplicate replay and incoming remote
edits. Fresh first-open setup covered profile, signup, cloud enable, the full
walkthrough, reminder deferral and the first cloud log. Those checks reused a
compatible Debug shell and frozen ordinary Metro source. Retained selector
failures and observed coordinate continuations do not become selector passes.
The local browser core-account qualifier separately covered real email-code
sign-in, reload, sign-out, session expiry and same-owner recovery without
automatic upload. These earlier runs do not qualify the combined main native
build or native provider sign-in against the deployed service.

At the initial staging checkpoint, the dedicated D1 database was explicitly
reset and `0001-auth.sql` applied. The migration ledger then contained only that
baseline. The `cloud_accounts` table contains only the owner key and
deletion-cleanup state; the reset did not establish that every old Durable
Object was removed.

That initial checkpoint verified source `d1ff65b`, Pages deployment
`5af75424-2dc9-4b7f-999e-dc5251a02f70` and API Worker version
`c4a3f771-97d5-4b93-8fad-687cd8da07ed`. Main and immutable homepage/account HTML
matched, account responses retained no-store/noindex headers, and both Pages
API bindings returned the new configuration. These deployment IDs describe
that earlier checkpoint, not the current API Worker or a new main frontend
deployment.

The deployed API qualifier passed ownership, immediate development access,
explicit association, duplicate retry, partial batches, automatic merge,
session-row expiry, administrative renewal, private export and cleanup checks.
It used synthetic signed sessions and sent no provider email.

The direct-Worker persistent-client run passed 1,000-log upload, lost replies,
restart and owner-isolated WebSockets. Its interrupted-restore data assertions
also passed, before a later verification snapshot read failed with a network
error. That failed run is retained; it is not a full-matrix pass. Qualification
through the app's actual Pages API origin passed the full matrix over normal
DNS and HTTPS/WSS: interrupted 1,000-log upload and restore, disk restart,
concurrent merges, pending-work resync, detachment/reassociation, expiry and
renewal, and retirement of both change channels. Cleanup confirmed zero fixture
users, sessions and cloud accounts at that run's end. Real SDK test accounts
were created afterwards, so this is not a current empty-database assertion.
These were administrative-session checks, separate from the current SDK proof.

## Repeating the deployed client qualifier

Run `node scripts/verify-cloud-clients.mjs staging` with staging Wrangler access
and `PUPTIME_STAGING_AUTH_SECRET` supplied privately through the environment.
The default origin is `https://puptime.pages.dev`, matching the app. The only
optional origin is `https://puptime-api-staging.p-ch.workers.dev`, selected with
`PUPTIME_STAGING_ORIGIN`. Invalid origins fail before credentials are read or
fixtures are created. During the earlier direct-Worker check this host could
not resolve the Worker hostname through ordinary DNS. That check used the
scoped DNS helper without changing hostname or TLS verification. To select that
origin on the current verifier:

```sh
PUPTIME_STAGING_ORIGIN=https://puptime-api-staging.p-ch.workers.dev node --require ./scripts/staging-dns.cjs scripts/verify-cloud-clients.mjs staging
```

The scoped DNS helper is unnecessary for the default Pages origin.

Transport failures report only a fixed route name, fetch/JSON phase, elapsed
time, HTTP status and allowlisted error category/code. Credentials, response
bodies and record identifiers are excluded. Request budgets, deliberate lost
replies, semantic assertions and cleanup are unchanged; failures are not hidden
by an added retry layer.
