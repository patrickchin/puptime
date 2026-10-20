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

Current local access-slice checks: 373 app tests, 95 actual Workers tests, nine
web tests, default/iOS/server types and the static website build pass. The real
HTTP matrix passes on a freshly initialized development database with two
persistent SQLite clients and 1,000 initial logs: interrupted upload/restore,
disk reopen, duplicate receipts, concurrent edits, owner isolation, ISO session
expiry, retained pending work and convergence to 1,002 logs. Its sessions are
administrative fixtures; this is not native SDK or social-provider acceptance.
The new baseline has not yet been reset/deployed on staging.

The combined shared-native/explicit-SQL branch passes 374 app checks and 97
Workers checks, with default, iOS, Android-static and server types. The focused
browser command `node scripts/verify-web-accounts.mjs --core-accounts` passes
seven reported checks using real local UI email-code authentication and a
populated cloud store. It verifies reload, sign-out, ISO session expiry and
same-owner recovery without automatic puppy upload. It captures screenshots
and no videos. Native qualification and deployed acceptance remain separate.
