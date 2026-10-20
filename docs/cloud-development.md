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

The core shared-native/explicit-SQL change merged in PR #119. It passes 374 app
checks, 97 Workers checks, nine web checks, default/iOS/Android-static/server
types, and a fresh iOS Release build with all 13 standard Maestro flows. The
real local HTTP matrix covers two persistent SQLite clients and 1,000 initial
logs: interrupted upload/restore, disk reopen, duplicate receipts, concurrent
edits, owner isolation, ISO session expiry, retained pending work and convergence
to 1,002 logs. Those sessions are administrative fixtures.

Separate local iOS SDK checks verify signup without upload, explicit enrollment
preserving the original event, cold restart, offline create/edit/delete through
process death, automatic queue drain, duplicate replay and incoming remote edits.
Fresh first-open setup covers profile, signup, cloud enable, the full walkthrough,
reminder deferral and the first cloud log. These checks use an existing Debug
shell and frozen ordinary Metro source; driver-selector failures and observed
coordinate continuations are retained separately. They do not prove a new
provider login on the deployed service or Android behavior. The focused
browser command `node scripts/verify-web-accounts.mjs --core-accounts` passes
seven reported checks using real local UI email-code authentication and a
populated cloud store. It verifies reload, sign-out, ISO session expiry and
same-owner recovery without automatic puppy upload. It captures screenshots
and no videos.

## Deployed development checkpoint — October 20, 2026

The dedicated staging D1 database was explicitly reset and the consolidated
`0001-auth.sql` applied. Its ledger now contains only that baseline;
`cloud_accounts` contains only the owner key and deletion-cleanup state. This
reset concerns authentication data, not a claim that every old Durable Object
was removed.

Merged source `d1ff65b` serves Pages deployment
`5af75424-2dc9-4b7f-999e-dc5251a02f70`. The matching API Worker version is
`c4a3f771-97d5-4b93-8fad-687cd8da07ed`. Main and immutable homepage/account HTML
match, account responses retain no-store/noindex headers, and both Pages API
bindings return the new configuration. Apple, Google and email are configured;
configuration flags alone are not completed provider-sign-in evidence.

The deployed API qualifier passes ownership, immediate development access,
explicit association, duplicate retry, partial batches, automatic merge,
session-row expiry, administrative renewal, private export and cleanup checks.
It uses synthetic signed sessions and sends no provider email.

The direct-Worker persistent-client run passed 1,000-log upload, lost replies,
restart and owner-isolated WebSockets. Its interrupted-restore data assertions
also passed, before a later verification snapshot read failed with a network
error. That failed run is retained; it is not a full-matrix pass. Qualification
through the app's actual Pages API origin passes the full matrix over normal
DNS and HTTPS/WSS: interrupted 1,000-log upload and restore, disk restart,
concurrent merges, pending-work resync, detachment/reassociation, expiry and
renewal, and retirement of both change channels. Final cleanup confirms zero
fixture users, sessions and cloud accounts, with only the fresh migration
baseline remaining. These are administrative-session checks, not SDK or provider
sign-in evidence.

Run `node scripts/verify-cloud-clients.mjs staging` with staging Wrangler access
and `PUPTIME_STAGING_AUTH_SECRET` supplied privately through the environment.
The default origin is `https://puptime.pages.dev`, matching the app. The only
optional origin is `https://puptime-api-staging.p-ch.workers.dev`, selected with
`PUPTIME_STAGING_ORIGIN`. Invalid origins fail before credentials are read or
fixtures are created. This host's ordinary DNS still cannot resolve the Worker
hostname; its direct-Worker check used `node --require ./scripts/staging-dns.cjs
scripts/verify-cloud-clients.mjs staging` without changing hostname or TLS
verification. The scoped DNS helper is unnecessary for the default Pages origin.

Transport failures report only a fixed route name, fetch/JSON phase, elapsed
time, HTTP status and allowlisted error category/code. Credentials, response
bodies and record identifiers are excluded. Request budgets, deliberate lost
replies, semantic assertions and cleanup are unchanged; failures are not hidden
by an added retry layer.
