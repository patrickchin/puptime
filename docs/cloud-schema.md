# Cloud SQL schema

Puptime currently uses D1 for identity, one SQLite Durable Object per account for
cloud puppy data, and SQLite on the device for offline work. These are separate
databases with separate initialization paths.

| Database | SQL definition | Runner |
| --- | --- | --- |
| D1 `AUTH_DB` | Top-level `server/migrations/*.sql` | Wrangler D1 migrations; Worker tests use `readD1Migrations('server/migrations')` |
| Per-account SQLite | `server/migrations/account/0003-account-store.sql`, then `0004-resource-api.sql` | `AccountStore` imports the SQL as Wrangler Text modules and executes initialization/upgrades inside its constructor's `transactionSync` |
| Device SQLite | `src/local/database.ts`, with event/routine fields in `src/record-sql.ts` | `initializeLocalDatabase`, through the native SQLite connection |

`wrangler d1 migrations apply AUTH_DB --local` applies only the D1 schema. Its
default top-level `*.sql` discovery does not apply the nested account SQL. The
same separation applies to the D1 test helper. Wrangler's `new_sqlite_classes`
migration creates the Durable Object namespace; it does not execute account DDL.

The account store's current schema is version 4. A new account atomically applies
the version-3 typed baseline and the additive version-4 resource API migration.
An existing version-3 account applies only `0004-resource-api.sql`, retaining its
puppies, logs, revisions, enrollment records and operation receipts. Version-4
startup validates the version/tables without replaying DDL. Unsupported or
incomplete databases fail without silently deleting data. The API rollout does
not require a database reset; existing recovered data must remain intact.

## Generated identifiers

New application-owned entities use `prefix_` followed by 32 lowercase hexadecimal
characters. The same value is the stored identifier and public identifier; there
is no second UUID column. The body is opaque and carries no time or sort order.

| Prefix | Entity |
| --- | --- |
| `usr`, `ses`, `acc`, `ver`, `rlm`, `key` | Better Auth user, session, provider-account row, verification row, rate-limit row and API-key row |
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

Custom activities and appearance customizations use stable semantic local IDs:
`custom:training` for the label "Training", and an activity key such as `pee` or
`custom:training` for a customization. These identities cannot be changed by a
resource API patch. This preserves the existing mobile projection contract.

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
for that evidence and the accepted native Apple/Google checks. The ID convention
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
| `api_requests` | REST request fingerprint and original successful result, addressed by a credential-scoped idempotency key |
| `schema_metadata`, `account_state` | Schema version and the existing retired-account fence |

Current event and routine values are real constrained SQL columns. Primary keys
support payload lookup; `records_by_pet_kind(pet_id,kind,deleted)` supports puppy
event counts. `revisions.sequence` supports ordered incremental pulls and export;
`revisions_by_record(record_id,revision DESC)` supports per-record history pages.
Operation/enrollment/API-request primary keys make retries addressable without
scanning logs. The resource API queries current records directly, with
`records_by_scope_sequence(kind,pet_id,deleted,sequence)` for scoped keyset pages,
`record_events_by_at(at,record_id)` for activity-time filters, and
`record_events_by_type_at(type,at,record_id)` for activity/time filters. Device
event queries also have puppy/time and puppy/activity/time indexes in
`src/local/database.ts`. Current-resource pages are not snapshots; revision feeds
remain a separate endpoint. See the [API contract](api.md).

Profile, customization and account-preference record payloads remain
in validated `records.data_json`. History and saved protocol request/results also
remain serialized JSON. These fields are not used to scan current activity
values. The resource API adds no nap/widget behavior. The native
field definitions and explicit account columns must continue to agree; database
tests exercise constraints, round trips, restart and atomic write failures.

`AccountStore.apply` keeps enrollment and idempotency checks, current-record read,
JavaScript reconciliation, sequence allocation, typed payload write, history and
acknowledgment in one synchronous SQLite transaction. WebSockets carry change
hints after commit. REST writes use that same mutation engine, with the current
revision precondition and API-request receipt in the same transaction. A retry
returns the original accepted result before evaluating a now-stale precondition.
Account retirement removes API receipts alongside the other account data. A D1 batch cannot
directly replace the read/reconcile/write callback. See Cloudflare's
[SQLite transaction API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync)
and [Text module rules](https://developers.cloudflare.com/workers/wrangler/configuration/#bundling).

The D1 baseline is `server/migrations/0001-auth.sql`: Better Auth's tables,
local-only email previews, and a small deletion-cleanup fence. Additive migration
`0002-api-keys.sql` adds Better Auth's generated `apikey` table and indexes for
configuration, owner and hashed-key lookup. Its triggers reject creation without
an active owner, prevent reassignment, and remove keys when the identity is
deleted. Raw keys are returned once; their stored values are hashed. Scopes,
expiry and per-key request limits are managed through Better Auth's API-key
plugin; API keys do not become general account sessions.

Apply the new D1 migration before deploying the resource API. Keep the existing
D1 database, Durable Object namespace, bindings and secrets. The account upgrade
runs when each existing object starts; no bulk erasure or re-import is needed.
There are no trial or subscription columns. Explicit device enrollment still
controls uploading local puppy data. See the [development milestone](cloud-development.md)
for the historical baseline checkpoint and [API setup](api.md#local-development-and-deployment)
for the additive rollout commands.

## Optional dog profile photo

Puppy records accept an optional `photo` field containing a JPEG data URI of at most
32,768 characters. Native selection crops to a square and resizes to 256 pixels
(or 128 pixels when necessary to meet the limit). The device stores the URI in
the existing puppy-scoped `pet_settings` table under `puptime.puppyPhoto.v1`; no
SQL migration is needed. Profile changes use the existing atomic revision/outbox
path. `photo: null` in a puppy patch removes the field. Changing a name preserves
the photo, and photo changes preserve the name. The existing byte-aware batcher
keeps profile uploads within the API’s 64 KiB request limit.

Deploy the backend before releasing the photo-enabled client. Clients opt in
with `x-puptime-profile-photos: 1` (browser exports use the `profilePhotos=1` form
field). Sync responses, history and exports omit photos for older clients while
retaining revision identities and cursor order. Photo-only history proposals
become name-preserving no-ops in that legacy representation. Legacy name edits
still preserve the server’s photo; no stored history is rewritten. On the first
upgrade from a client without photo support, a persisted capability checkpoint
restarts any staged baseline or requests the existing resumable full baseline,
so photos already passed by the legacy cursor are received. Pending local edits
and operation identities are retained. Photos use the same private account storage and
revision retention as other profile fields. Activity-only CSV and automatic
recovery backups do not contain photos.
