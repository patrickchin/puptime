# Cloud SQL schema

Puptime currently uses D1 for identity, one SQLite Durable Object per account for
cloud puppy data, and SQLite on the device for offline work. These are separate
databases with separate initialization paths.

| Database | SQL definition | Runner |
| --- | --- | --- |
| D1 `AUTH_DB` | Top-level `server/migrations/*.sql` | Wrangler D1 migrations; Worker tests use `readD1Migrations('server/migrations')` |
| Per-account SQLite | `server/migrations/account/0003-account-store.sql` | `AccountStore` imports the SQL as a Wrangler Text module and executes it inside its constructor's `transactionSync` |
| Device SQLite | `src/local/database.ts`, with event/routine fields in `src/record-sql.ts` | `initializeLocalDatabase`, through the native SQLite connection |

`wrangler d1 migrations apply AUTH_DB --local` applies only the D1 schema. Its
default top-level `*.sql` discovery does not apply the nested account SQL. The
same separation applies to the D1 test helper. Wrangler's `new_sqlite_classes`
migration creates the Durable Object namespace; it does not execute account DDL.

The account SQL file is the complete current version-3 baseline, extracted from
the existing constructor. It is not an incremental conversion or a requirement
to preserve older development layouts. A new account creates it atomically;
repeat startup validates the version/tables without replaying the DDL. An
unsupported or incomplete database fails without silently deleting data. Any
future development reset must be explicit and limited to Puptime-owned fixtures.

## Generated identifiers

New application-owned entities use `prefix_` followed by 32 lowercase hexadecimal
characters. The same value is the stored identifier and public identifier; there
is no second UUID column. The body is opaque and carries no time or sort order.

| Prefix | Entity |
| --- | --- |
| `usr`, `ses`, `acc`, `ver`, `rlm` | Better Auth user, session, provider-account row, verification row and rate-limit row |
| `prv` | Local development email preview |
| `pet`, `dev` | Puppy and persisted installation/device |
| `evt`, `rtn`, `rem` | Logged activity, user-created routine and custom timed OS reminder |
| `op`, `gen` | Sync/enrollment operation and local sync-owner generation |

JavaScript generators use standard Web Crypto in browsers, Node and Workers.
Hermes uses the installed public `expo-modules-core/src/uuid` native v4 primitive
through the package's `react-native` import condition. Removing the UUID encoding
separators gives a 32-character body with 122 random bits; it does not change the
underlying entropy. Existing device SQL generators use SQLite `randomblob(16)`
with the same body format and 128 random bits. Neither path falls back to clocks
or `Math.random`, and neither silently changes an already persisted operation ID
after a collision or a lost acknowledgment. Database constraints remain `TEXT`;
this convention requires no schema migration or database reset.

New routine/reminder drafts retain their ID across failed saves. Learned routine
previews keep deterministic suggestion keys, then mint `rtn_` IDs on acceptance;
the attempted proposal and its IDs stay together when retrying. Starter routines,
derived estimates, preference keys and recurring notification identifiers remain
stable semantic keys. CSV imports retain their validated original event IDs.
The deferred iOS widget extension still uses its existing timestamp/type pending
IDs; it has a separate runtime and is not covered by the app entropy adapter.

`records.id` and mirrored `record_id` values are protocol identities, not random
entity IDs: puppy records use the puppy ID; puppy-scoped records encode the
deterministic `[kind, petId, localId]` tuple; account preferences use the fixed
`["accountPreferences"]` key. That scoping permits imported IDs to repeat across
puppies or record kinds without collisions. Composite SQL keys and revision
sequence integers likewise keep their relational/ordering meaning. Provider
subjects (`account.accountId`), session tokens, OAuth state and OTP values remain
owned by their respective authentication SDKs/providers.

Node persistence, real Better Auth adapter and Metro/bundle checks cover the ID
paths. Frozen source `814db2dd` also passed actual Hermes creation, editing,
explicit SDK enrollment/upload and authenticated cold restart: the same puppy,
device, event, generation and accepted operation IDs persisted, with no pending
work. Native routine SQL failure preserved the open draft and every table;
one retry saved one prefixed routine. Actual-component tests separately prove
the unexposed failed draft's exact ID stays equal on retry. The OS reminder's
`rem_` identifier also survived restart.

Those original native checks reused a compatible Debug shell and the local
development service; they do not establish a fresh build or Android runtime.
The ID source later passed fresh iOS Release CI and actual native email-code
sign-in, explicit upload and cold restart against the deployed development API.
See the [current development checkpoint](cloud-development.md#current-verified-checkpoint--october-20-2026)
for that evidence and the pending native Apple/Google checks. The ID convention
required no schema reset.

## Account tables and queries

The account owner is determined by the authenticated Better Auth user and the
corresponding Durable Object ID, not a client-supplied owner column. Every puppy
has a stable `pets.id`. Records and enrolled devices reference that ID, so the
schema already represents multiple puppies even while setup presents one.

| Tables | Stored data and access |
| --- | --- |
| `pets`, `enrolled_devices` | Initial puppy name, creation time and explicit device/puppy association; device/puppy composite primary key |
| `records` | Record ID, puppy, kind, revision, account change sequence, deletion marker and update time |
| `record_events` | Typed activity, timestamp, optional label/note, source and estimate fields, plus existing timing fields; foreign key to `records` with cascade |
| `record_routines` | Typed activity/label, minute of day, reminder intent and tolerance; foreign key to `records` with cascade |
| `revisions` | Ordered immutable accepted history, including merge reason, proposal and before/after snapshots |
| `operations`, `enrollments` | Saved request/result pairs for duplicate-safe retry and rejection of reused operation IDs with different content |
| `schema_metadata`, `account_state` | Schema version and the existing retired-account fence |

Current event and routine values are real constrained SQL columns. Primary keys
support payload lookup; `records_by_pet_kind(pet_id,kind,deleted)` supports puppy
event counts. `revisions.sequence` supports ordered incremental pulls and export;
`revisions_by_record(record_id,revision DESC)` supports per-record history pages.
Operation/enrollment primary keys make retries addressable without scanning logs.
There is no server activity-feed/time-range query yet; add indexes for the actual
query when that endpoint exists. Device event queries already have puppy/time
and puppy/activity/time indexes in `src/local/database.ts`.

Profile, customization and account-preference record payloads currently remain
in validated `records.data_json`. History and saved protocol request/results also
remain serialized JSON. Extracting this baseline does not claim those fields are
normalized, change the wire protocol, or add new nap/widget behavior. The native
field definitions and explicit account columns must continue to agree; database
tests exercise constraints, round trips, restart and atomic write failures.

`AccountStore.apply` keeps enrollment and idempotency checks, current-record read,
JavaScript reconciliation, sequence allocation, typed payload write, history and
acknowledgment in one synchronous SQLite transaction. WebSockets carry change
hints after commit. This extraction preserves that boundary; a D1 batch cannot
directly replace the read/reconcile/write callback. See Cloudflare's
[SQLite transaction API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync)
and [Text module rules](https://developers.cloudflare.com/workers/wrangler/configuration/#bundling).

The fresh D1 baseline is `server/migrations/0001-auth.sql`: Better Auth's tables,
local-only email previews, and a small deletion-cleanup fence. It has no trial
or subscription columns. Authenticated development accounts have cloud access;
explicit device enrollment still controls uploading local puppy data. See the
[development milestone](cloud-development.md) for the reset and acceptance
boundary. The account SQL introduces no authentication or migration framework.
