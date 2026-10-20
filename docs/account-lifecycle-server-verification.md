# Original-owner account lifecycle server boundary

This is a server foundation. Native deletion controls, durable local deletion
intent, real provider reauthentication, deployment and distributed tests remain
release gates. Local records are not part of these server operations.

Apply migration0004 after0003 **before** deploying this server. It adds typed SQL
intent and receipt tables; it does not rewrite authentication dates or relax the
credential fence in0003. No new dependency or provider redirect URL is needed.

## Provider reauthentication

Use the existing SDK `signIn.social` call with these per-request headers:

```
x-puptime-reauth: account-deletion
x-puptime-account: <original account id>
```

The request still goes to `/api/auth/sign-in/social`, so the installed Expo
client manages its initial cookies, authorization proxy, native browser and
callback cookies. Use the normal provider, callbackURL and errorCallbackURL
fields. Direct ID tokens, signup requests and extra scopes are rejected in this
mode. The server requires an existing session and an already-linked provider;
it derives the owner and source session from the SDK, not those headers alone.

The server attaches a trusted Better Auth OAuth context and indexes the returned
opaque state by its hash in its own table. The shared callback chooses a separate
auth instance that skips provider credential updates, then independently checks
the SDK-verified context and exact linked provider subject against the original
owner. Missing, expired, cancelled and consumed intents cannot fall through into
normal signup. The source session must still exist and be unexpired. A single
atomic SQL consume fences concurrent callbacks and revocation during the flow.

For Apple callbacks without an email, the public profile mapper can retrieve
only the existing email belonging to that exact linked Apple subject and owner.
It never creates a placeholder email. Normal sign-in, explicit linking and
normal provider token updates retain their existing behavior.

Successful starter responses retain SDK cookies and `url`/`redirect`, adding only
`reauthIntentId`. Intents expire after ten minutes; at most five can remain active
per owner. POST `/api/account/reauth/cancel` with `{ "intentId": "…" }` and the
expected-owner header cancels a flow. Native code must still preserve its original
owner/generation and must not accept an old browser result after switching owners.
The starter SDK result alone does not prove browser completion: refresh the actual
session and verify the original owner before continuing. Preparation independently
requires recent authentication, so cancellation cannot turn a stale session fresh.

## Preparing and confirming deletion

1. With fresh authentication and the expected-owner header, POST
   `/api/account/deletion/prepare` with `{}`. Save its `receipt` and original owner
   durably **before** dispatching deletion. Abort if local persistence fails.
2. Ask for a separate destructive confirmation. DELETE `/api/account` with
   `{ "confirm": true, "receipt": "…" }`, the actual session and expected-owner
   header. A receipt alone can never authenticate or authorize this operation.
3. On a lost response or restart, POST `/api/account/deletion/status` with
   `{ "receipt": "…" }`. This status-only request needs no surviving account
   session. `deleted` acknowledges deletion and reports the actual Apple outcome;
   `pending` requires recovery and another explicit confirmation; `not-started`
   reports a prepared operation. `unknown` never means success. Do not resend
   DELETE, create an account or enroll a puppy automatically.

Receipts contain 32 random bytes, appear only in request/response bodies, and are
stored as hashes server-side. Unused preparations expire after thirty days;
started proofs retain their owner binding while that user exists, and completed
status remains for thirty days from completion. At most five usable receipts are
retained per owner. A fresh authenticated preparation can
replace the oldest unstarted, lease-free preparation when full, so lost responses
cannot consume every slot. Replacement and insertion share one atomic transaction.
A replaced unstarted receipt reports `unknown` and cannot confirm deletion; save
the newly prepared receipt before a new explicit confirmation. Started proofs and
their leases are never displaced to free capacity. If all five have started, use
an existing saved receipt with fresh authentication for the confirmed retry;
preparation remains bounded. This provider mode still requires a live source
session. The separate [receipt-bound recovery server contract](account-recovery-server-verification.md)
supports original-owner proof without one; its native integration and real
provider/email acceptance remain separate gates. Status receipts can confirm a
completed deletion without authentication.
The bounded non-content receipt row deliberately has
no user foreign key so a successful user deletion cannot erase its status proof.
It retains no email, provider subject, credential, raw receipt or OAuth state.

The same deletion boundary serves existing web callers using `{ "confirm": true }`.
They keep the existing JSON response and SDK clearing cookies. Existing callers
need to adopt preparation to recover a lost successful response via a receipt.

## Atomic cleanup and honest failure states

A per-owner lease serializes confirmed attempts, including legacy web calls.
Retirement marks the account deleting, revokes Apple when possible, retires the
AccountStore and removes owned OTPs. Only then does the receipt record
`cloud-retired` and its Apple outcome.

The SDK's D1 deletion otherwise removes sessions, accounts and user sequentially;
its D1 adapter cannot wrap interactive transactions. This owned route instead
uses one native user DELETE with the existing FK cascades, in a D1 batch with
receipt completion. A child-delete or receipt-commit error rolls back all auth
cleanup together, preserving the original provider link and session for guarded
reauthentication and an explicit retry. Cloud retirement already happened and
does not roll back. Public SDK `signOut` handles signed cookie expiry after the
cascade; its user-deletion endpoints remain disabled.

If acknowledgement fails after commit, the receipt still confirms completion
after the user and sessions disappear. Pending or active-lease attempts never
automatically retry. A crashed lease expires after one minute; another confirmed
request must still prove a fresh actual session and the original owner.

This SQL boundary matches the current configuration: D1, no secondary auth store,
cookie cache disabled, and Expo/emailOTP plugins. Adding deletion database hooks,
related tables or secondary caches requires integrating their cleanup explicitly.

## Checks

```
npm run test:server
npm run typecheck:server
npm run test:web
```

The focused account-reauth tests exercise real HTTP routing, Better Auth, local D1
and the actual AccountStore. They cover original/wrong/new/deleted owners, linked
subjects, state/context forgery, expiry, cancellation, replay, forced concurrent
callbacks, source-session changes, receipt bounds and lease races, lost responses,
FK rollback, receipt-commit rollback and unrelated-owner preservation. Credential
values are hashed before equality assertions so failures cannot print them.

The Expo test runs the installed client plugin, modeling only native platform
surfaces, secure storage and browser handoff. The actual proxy and callback run
through the Worker and D1, including fresh session and cookie transfer/clearing.
Provider token endpoints return synthetic signed identities. This is not a live
Apple/Google/native sign-in or a real provider-revocation qualification.

Better Auth stores normal D1 dates as ISO text. Shared SQL checks explicitly
normalize ISO dates and older numeric milliseconds, including live socket expiry;
SQLite's raw text/number comparison is not used as an expiration check. Tests
cover actual SDK ISO storage, expired/future dates and numeric compatibility.

References: [Better Auth user lifecycle](https://better-auth.com/docs/concepts/users-accounts),
[D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).
