# Puptime API

The backend already used authenticated HTTP APIs. Its original contract was
designed around the app's offline synchronization: enroll a device, submit
field-level mutations, and read an ordered revision feed. Those routes are
validated, account-isolated APIs, but a CLI had to understand the app's device,
record-identity and revision protocol to perform ordinary CRUD operations.

The resource API exposes those operations directly under `/api/v1`. It uses the
same account stores and mutation engine as mobile sync. A frontend, CLI or AI
tool can list current logs or create a log without reproducing mobile storage
internals. Authentication remains Better Auth; Hono routes and Zod schemas
define the HTTP boundary. A separate MCP adapter is deferred and can call this
API later.

This document describes the implementation contract. Deployment and runtime
acceptance are recorded separately; the presence of this document does not
establish that a particular server already runs it.

## Base URL and discovery

| Environment | Resource API base |
| --- | --- |
| Hosted Puptime development backend | `https://puptime.pages.dev/api/v1` |
| Default local Wrangler service | `http://localhost:8787/api/v1` |

`GET /api/v1/openapi.json` is the public OpenAPI 3.1 document, generated from the
route declarations used for validation. It specifies accepted fields, enums and
responses. Paths in the tables below are relative to `/api/v1`.

The API major version is part of the URL. Preserve existing request and response
meanings within v1; additive optional fields and new routes can remain v1.
Breaking field, permission or response changes require a new major version and
an explicit client transition. The older mobile endpoints remain available while
installed clients use them.

## Authentication and permissions

Send an integration key as `Authorization: Bearer <key>`. Load the value from an
OS credential store into `PUPTIME_API_KEY` for the examples below. Do not put raw
keys in source, command history, URLs, logs, screenshots or shared AI prompts.
There is no unauthenticated data access and no caller-selected account owner.

| Scope | Allows |
| --- | --- |
| `read` | Account summary, puppies, current resources, history and the revision feed |
| `write` | Create, edit, soft-delete and restore resources |
| `export` | Download the complete account NDJSON export |

Scopes are independent: `write` does not imply `read` or `export`. Give a
read-only AI tool only `read`; add other scopes for an explicitly authorized
workflow. An API key cannot create/manage keys or delete the account. Keys have
a default limit of 60 authenticated requests per minute; exceeded limits return
429 with `Retry-After: 60`.

A valid Better Auth cookie session also works. Session requests with an
untrusted browser origin cannot mutate resources. When an Authorization header
is present, it takes precedence: an invalid or insufficient key never falls
back to a more privileged cookie session.

### Integration-key management

These routes require a signed-in Better Auth session, never an API key:

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/api-keys?limit=20&offset=0` | Metadata page: `{ "items": [], "total": 0, "limit": 20, "offset": 0 }` |
| `POST` | `/api-keys` | Create a key; 201 with `{ "apiKey": { ...metadata }, "key": "<returned once>" }` |
| `DELETE` | `/api-keys/{keyId}` | Revoke an owned key; 204 without a body |

Creation requires a session created less than ten minutes ago. Its JSON body is:

```json
{ "name": "My CLI", "scopes": ["read", "write"], "expiresInDays": 90 }
```

`name` is 1–80 characters; scopes must be nonempty and unique. Expiry defaults to
90 days and accepts 1–365 days. Store the returned secret in the client's OS
credential store before discarding the response. List and revoke never return
the secret or its hash. Metadata includes `id`, `name`, `start` (a short display
prefix), `scopes`, `createdAt`, `expiresAt` and `lastUsedAt`. These credential
metadata dates are ISO-8601 strings; resource timestamps below are milliseconds.
List accepts `limit` 1–100 and `offset` 0–1,000,000.

Key management is exempt from the resource-write idempotency/ETag headers below.
The direct Better Auth `/api/auth/api-key/*` HTTP management routes are disabled
so they cannot bypass this policy. This change provides the HTTP management
contract; it does not add an API-key settings screen or a packaged CLI.

## Resource routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/account` | `{ "user": { "id", "email", "name" }, "pets": [{ "id", "name", "eventCount" }] }` |
| `GET`, `POST` | `/puppies` | List or create puppies |
| `GET`, `PATCH` | `/puppies/{puppyId}` | Read or rename a puppy |
| `GET` | `/puppies/{puppyId}/history` | Puppy profile history |
| `GET`, `POST` | `/puppies/{puppyId}/logs` | List or create current activity logs |
| `GET`, `PATCH`, `DELETE` | `/puppies/{puppyId}/logs/{id}` | Read, edit or soft-delete a log |
| `GET`, `POST` | `/puppies/{puppyId}/routines` | List or create routine entries |
| `GET`, `PATCH`, `DELETE` | `/puppies/{puppyId}/routines/{id}` | Read, edit or soft-delete a routine |
| `GET`, `POST` | `/puppies/{puppyId}/custom-activities` | List or create custom activity labels |
| `GET`, `PATCH`, `DELETE` | `/puppies/{puppyId}/custom-activities/{id}` | Read, edit or soft-delete a label |
| `GET`, `POST` | `/puppies/{puppyId}/customizations` | List or create activity appearance overrides |
| `GET`, `PATCH`, `DELETE` | `/puppies/{puppyId}/customizations/{id}` | Read, edit or soft-delete an override |
| `GET`, `POST`, `PATCH` | `/preferences` | Read, create once, or edit account preferences |
| `GET` | `/preferences/history` | Account preference history |
| `GET` | `/changes?after=0&limit=50` | Ordered changes, including deletions |
| `GET` | `/export` | Complete account export as streaming NDJSON |

Every log, routine, custom-activity and customization detail path also has
`GET .../{id}/history` and `POST .../{id}/restore`. There is no puppy deletion,
puppy restore, preference deletion or preference restore route. Account deletion
remains a separate session-only lifecycle operation in the existing API.

JSON creation bodies contain resource fields, without `id`, `puppyId`, revision
or other server metadata. Unknown fields are rejected. New puppies, logs and
routines receive opaque prefixed IDs such as `pet_…`, `evt_…` and `rtn_…`.
Imported existing log IDs remain addressable; URL-encode any ID used in a path.

| Resource | Creation fields |
| --- | --- |
| Puppy | `name` (required, 1–256 characters) |
| Log | `type`, `at`, `source` required; optional `note`, `customLabel`, `estimated`, `endedAt` |
| Routine | `type`, `minutes` required; optional `customLabel`, `reminder`, `toleranceMinutes` |
| Custom activity | `label` required, 1–40 characters |
| Customization | `activityKey` required; optional `name`, `emoji`, `color` |
| Preferences | One or more supported preference fields below |

Log types are `pee`, `poop`, `meal`, `pottyTrip`, `walk`, `nap` and `custom`.
`custom` logs/routines need a `customLabel`. Historical nap fields remain
supported by the shared protocol; this API does not introduce new nap behavior.
`source` is `app` or `widget`; integrations use `app`. Notes allow up to 16,384
characters. `at`, optional `endedAt`, `updatedAt` and history `acceptedAt` are
integer Unix milliseconds. Routine `minutes` is a local minute of day (0–1439),
not a timestamp; tolerance is 0–1440 minutes. Appearance `color` is an index 0–6;
the allowed emoji enum is in OpenAPI.

Custom activity IDs are semantic: label `Training` has ID `custom:training`.
Customization IDs equal `activityKey`, for example `pee` or `custom:training`.
Patches cannot change the activity's identity; create a separate activity for a
different semantic label/key. Account preference ID is always `preferences`,
and its `puppyId` is null. Supported preference fields are `theme`, `language`,
`widgetActions`, `reminderLeadMinutes`, `widgetConfirmations`,
`pottyAfterPeeEnabled`, `pottyAfterPeeDelayMinutes`, `pottyAfterMealEnabled` and
`pottyAfterMealDelayMinutes`; OpenAPI defines their accepted values. These are
desired settings. An OS permission grant, device token or scheduled notification
is local to a device and is not granted by changing a preference.

### JSON responses and listing

A log response is flattened rather than wrapped in the mobile protocol:

```json
{
  "id": "evt_0123456789abcdef0123456789abcdef",
  "puppyId": "pet_0123456789abcdef0123456789abcdef",
  "type": "pee",
  "at": 1792548000000,
  "source": "app",
  "note": "After breakfast",
  "revision": 1,
  "updatedAt": 1792548000100,
  "deleted": false
}
```

Other resource responses have their own fields and the same metadata. An older
enrolled puppy without a saved profile revision is exposed at revision 0; its
first profile edit creates revision 1 without rewriting existing history.

Collections return `{ "data": [ ...resources ], "nextCursor": 123 }`, or
`"nextCursor": null` on the last page. `limit` defaults to 50 (1–100). Pass the
returned cursor as `after` on the next request with the same filters. Current
records are ordered by their latest change sequence, not activity time; puppy
pages use stable insertion order. Cursors are opaque in meaning even though
their wire value is an integer. They are not snapshots: concurrent edits can
move a record to a later page, so deduplicate IDs if collecting a changing list.
Use the complete export when a fixed account snapshot is needed.

Log lists additionally accept `since` (inclusive), `until` (exclusive), both
Unix milliseconds, and `type`. If both bounds are supplied, `since < until` is
required. They query the current typed SQL values, not every historical revision.
All ordinary collection/detail reads exclude soft-deleted records.

## Safe writes, revisions and recovery

All resource `POST`, `PATCH` and `DELETE` requests require `Idempotency-Key`: an
8–128-character value using letters, numbers, `.`, `_`, `:` or `-`. Choose a new
random value for each intended write and retain it before sending the request.
Successful creation returns 201, `Location` and `ETag`; other writes return 200
and `ETag`. Reuse the same credential, key, target, body and precondition when
retrying a lost response. The server returns the original accepted result,
including its original revision, without applying another mutation. This replay
still works after later edits. Reusing a successful key for different content
or a different operation returns 409. Keys are scoped to the credential: a new
session or API key has a different idempotency namespace.

Read a detail resource to obtain its quoted `ETag`, for example `"3"`. Supply
that value in `If-Match` for `PATCH`, `DELETE` and restore. Missing required
headers return 428; a changed revision returns 412. On 412, read the new current
record and deliberately reconcile before sending a new operation/key. A
successful old request replay is returned before the current-revision check.

`PATCH` accepts field-level changes, not a complete replacement. Nullable fields
are declared explicitly in OpenAPI: for example `{ "note": null }` clears a
note, and customization `{ "name": null }` clears the display-name override.
Do not assume every optional field accepts null. Existing sync reconciliation
rules remain shared: saved estimates remain estimated, and an invalid nap time
edit preserves the previous valid timing; inspect the response/history for the
accepted result.

`DELETE` records a tombstone and retains the saved data/history. Detail GET then
returns 404; history remains available. History returns up to 50 revisions,
newest first:

```json
{
  "data": [
    { "revision": 2, "acceptedAt": 1792548000200, "intent": "delete",
      "reason": "deleted", "before": { "...": "previous resource" },
      "after": { "...": "saved resource with deleted=true" } }
  ],
  "nextCursor": null
}
```

For another history page, pass `beforeRevision=<nextCursor>`. A full 50-row page
may return a cursor followed by an empty final page. To undo deletion, use
`POST .../{id}/restore` with the deleted revision from history in `If-Match`, a
new `Idempotency-Key`, and no body. It restores the saved deleted data as a new
revision. It does not overwrite with an arbitrary historical version. A changed
deleted revision returns 412; attempting to restore an active record returns
409. Creating a record with an existing semantic ID, including a deleted one,
returns 409; use restore when appropriate.

## Curl examples

The examples assume `PUPTIME_API_KEY` is already populated privately. Resource
IDs below are placeholders; copy the IDs returned by your account's own API.

```sh
export PUPTIME_API_BASE='https://puptime.pages.dev/api/v1'

curl --fail-with-body "$PUPTIME_API_BASE/puppies" \
  -H "Authorization: Bearer $PUPTIME_API_KEY"

curl --fail-with-body --get "$PUPTIME_API_BASE/puppies/$PUPTIME_PUPPY_ID/logs" \
  -H "Authorization: Bearer $PUPTIME_API_KEY" \
  --data-urlencode 'since=1792540800000' \
  --data-urlencode 'type=pee' --data-urlencode 'limit=50'
```

Create a log. Persist the chosen request key in your client before sending; the
example generates one in memory for this shell session:

```sh
PUPTIME_REQUEST_ID="log_$(node -p 'crypto.randomUUID()')"
curl --fail-with-body -i -X POST \
  "$PUPTIME_API_BASE/puppies/$PUPTIME_PUPPY_ID/logs" \
  -H "Authorization: Bearer $PUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $PUPTIME_REQUEST_ID" \
  --data '{"type":"pee","at":1792548000000,"source":"app","note":"After breakfast"}'
```

Read a log to inspect its current ETag, then edit it. `"1"` below is an example;
use the ETag from your read. Retrying this exact patch uses the same request key.

```sh
curl --fail-with-body -i \
  "$PUPTIME_API_BASE/puppies/$PUPTIME_PUPPY_ID/logs/$PUPTIME_LOG_ID" \
  -H "Authorization: Bearer $PUPTIME_API_KEY"

PUPTIME_EDIT_ID="edit_$(node -p 'crypto.randomUUID()')"
curl --fail-with-body -i -X PATCH \
  "$PUPTIME_API_BASE/puppies/$PUPTIME_PUPPY_ID/logs/$PUPTIME_LOG_ID" \
  -H "Authorization: Bearer $PUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $PUPTIME_EDIT_ID" -H 'If-Match: "1"' \
  --data '{"note":"After breakfast and a short walk"}'
```

## Changes, export and errors

`GET /changes` returns `{ "changes": [ ...cloudRecords ], "cursor": 123,
"hasMore": false }`. This is the ordered mobile revision feed, including
tombstones; a record can appear multiple times. A cloud record contains `id`
(the internal scoped protocol ID), `petId`, `kind`, `data`, `revision`,
`sequence`, `deleted` and `updatedAt`. It differs from the flattened resource
response. Continue with `after=<cursor>` while `hasMore` is true. A cursor ahead
of this account returns 409 `resync_required`; restart at `after=0`.

`GET /export` requires `export` scope and streams `application/x-ndjson`: a
manifest, immutable revision lines, then `{ "type": "complete", "cursor": N }`.
The history boundary is captured when export starts. Treat a missing complete
marker, parse failure or interrupted stream as a failed export. The export can
contain private notes; choose its destination accordingly. This is the account
archive format, not the activity-only CSV format.

Versioned errors use one shape, with the same request ID in `X-Request-Id`:

```json
{ "error": { "code": "precondition_failed", "message": "Resource has changed. Fetch its current revision and retry.", "requestId": "req_..." } }
```

| Status | Meaning / client action |
| --- | --- |
| 400 | Invalid fields, identity, filters or headers; correct the request |
| 401 | Missing/invalid/expired/revoked credential, or fresh session required |
| 403 | Insufficient scope, untrusted browser origin or cloud access unavailable |
| 404 | Resource/path absent from this account, including deleted detail reads |
| 409 | Conflicting create, reused idempotency key, invalid restore or resync cursor |
| 410 | Account deletion is in progress |
| 412 | Revision changed; fetch and reconcile before a new write |
| 413 | Request body exceeds 64 KiB |
| 428 | Required idempotency or revision precondition header missing |
| 429 | Request limit exceeded; respect `Retry-After` when supplied |
| 503 | Temporary failure; retry the exact write with its existing key |

Use `error.code` for decisions and `requestId` for investigation. Do not retry a
failed write by minting a fresh key unless intentionally creating a new operation.
Data responses use `Cache-Control: no-store`.

## Relationship to the app

The server's typed SQL records, revision history, operation receipts and account
ownership remain authoritative for cloud data. Resource writes commit through
the same engine as mobile writes and notify connected mobile clients after
commit. They become ordinary incoming sync changes. A REST write does not
directly replace a phone's SQLite database or grant OS permissions.

The app still saves offline first, maintains its ordered outbox and explicitly
associates/uploads/restores local data. Signing in alone does not upload local
logs. A client must reconnect and sync to receive API-created logs. Local-only
profiles remain local. Both APIs share storage; this rollout neither wipes the
server database nor migrates/deletes device data.

The existing `/api/cloud/enroll`, `/api/sync/push`, `/api/sync/pull`,
`/api/sync/changes`, `/api/records/{id}/history`, `/api/account` and
`/api/account/export` routes retain their mobile session contracts. They do not
accept integration keys as a shortcut. Better Auth's existing `/api/auth/*`
identity routes remain outside the v1 resource version.

## Local development and deployment

Use the repository's Node version and install dependencies with `npm ci`.
For an isolated local API, create the gitignored `.dev.vars` if it does not
already exist; preserve any existing environment configuration. Minimal local
values are:

```dotenv
ENVIRONMENT=local
AUTH_BASE_URL=http://localhost:8787
WEB_ORIGINS=http://localhost:8787
AUTH_SECRET=local-development-only-secret-at-least-32-characters
```

Use a randomly generated secret for any non-disposable environment. Never put
hosted secrets in this example or enable local email-preview mode on a server.
Then initialize local D1 and run Wrangler:

```sh
npx wrangler d1 migrations apply AUTH_DB --local
npm run dev:server
```

Default Wrangler listens on port 8787. The local API uses a separate local D1
database and local Durable Object state under `.wrangler/`; the account store
initializes/upgrades its SQL on first access. In local mode, email codes are
available only in the local `local_email_previews` table through Wrangler D1
queries; there is no public preview endpoint. Use the normal Better Auth email
sign-in flow, then the session-only key endpoint to provision a local integration.
Apple/Google require their own configured provider credentials; they are not
needed to start a local email-based fixture.

For the existing hosted development environment, apply the additive D1 migration
before deploying the Worker:

```sh
npx wrangler d1 migrations apply AUTH_DB --remote --env staging
npx wrangler deploy --env staging
```

These deployment commands change the hosted environment and belong to the
reviewed deployment workflow. Keep the existing D1 database, namespace, bindings
and secrets. `0002-api-keys.sql` adds the key table/triggers; account schema 4 is
an additive constructor upgrade from schema 3, retaining all current logs,
revisions and retry receipts. Do not reset or re-import existing accounts.
Wrangler's D1 migration command does not run the nested account SQL files.
See the [schema map](cloud-schema.md) for both migration runners. Verify the
contract locally and against isolated hosted fixtures before claiming runtime
acceptance; use [the development ledger](cloud-development.md) for dated evidence.

`npm run test:server` covers the Worker, SQL storage, auth and resource contracts.
`npm run test:api:http` runs the same public-HTTP smoke flow locally or against
the hosted service: discovery, scoped keys, create/retry/edit/stale rejection,
SQL filtering, mobile sync interoperability, delete/restore/history, export,
revocation and cleanup. Supply `PUPTIME_API_URL` and a fresh fixture session in
`PUPTIME_API_TEST_COOKIE` privately. It refuses personal accounts: the owner must
be an empty `api-qualification-…@example.invalid` test account. The fixture is
deleted through the normal account API after the test. Provision hosted fixture
sessions through trusted test administration; no test-auth bypass is deployed.
