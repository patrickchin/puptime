# Original-owner deletion recovery: server boundary

A saved deletion receipt can select its original existing owner after the source
session expires or is revoked. It cannot authenticate, link an identity, create an
account or authorize deletion. The installed Better Auth/Expo SDK verifies the
mailbox or already-linked provider and issues a fresh session. Native recovery
integration and real email/provider acceptance remain a separate slice.

The existing `account-deletion` social mode still requires its original live
source session. This additional flow uses a separate typed intent table with no
source-session foreign key. It captures the receipt hash, original UID, method,
verified mailbox or exact account-row/provider subject, and a short expiry.
OAuth state contains only the trusted opaque binding; the raw receipt stays in
POST bodies and is removed before the request reaches the SDK.

## Public contract

All starts, verification and cancellation require `x-puptime-account` containing
the durable original UID. Requests use a trusted app/web origin. A currently
valid session for another UID is rejected, including at the provider callback.
The new routes return `Cache-Control: no-store` and accept no receipt query field.

| Operation | Request | Result |
| --- | --- | --- |
| Status first | Existing `POST /api/account/deletion/status`, `{receipt}` | `deleted` needs local cleanup only; `unknown` stays unconfirmed. |
| Social recovery | Installed `signIn.social({provider,callbackURL,errorCallbackURL}, {headers:{'x-puptime-reauth':'account-deletion-recovery','x-puptime-account':originalUID},body:{receipt}})` | Normal SDK URL/cookies plus `recoveryIntentId`. Initial URL is not proof of completed authentication. |
| Email start | `POST /api/account/recovery/email/start`, `{receipt}` | `{success:true,recoveryIntentId}`. The server derives the original verified mailbox; no address or provider list is returned. |
| Email verify | `POST /api/account/recovery/email/verify`, `{receipt,intentId,otp}` | Original SDK sign-in response and cookies for the original UID. |
| Cancel | `POST /api/account/recovery/cancel`, `{receipt,intentId}` | Idempotent `{success:true}`; invalidates only the matching receipt/owner intent. No source session is required. |

Social callbacks are fixed to `puptime://account` or the canonical web origin's
`/account`; optional error callbacks have the same allowlist. Direct ID tokens,
extra scopes, replacement email/profile fields and `additionalData` are rejected.
After proof, the client must refresh the actual SDK session, match the original
UID and its local ownership generation, and ask for a **new explicit deletion
confirmation**. None of these operations calls DELETE or resumes cloud sync.
The existing confirmed DELETE still requires a recent actual session.

Unavailable receipts/users/links, wrong identities and failed verification use
generic `recovery_unavailable` errors. SDK failures during provider callbacks
return its standard authentication error redirect without an identity payload.
Throttling returns 429 with a bounded `Retry-After` value. Thirty recovery requests
per IP/minute apply before lookup; email sends additionally have the installed
SDK's three-per-IP/minute ceiling, one per owner/receipt/minute, and five starts
per owner/receipt/ten minutes. Active intents are capped at five per owner/receipt.
Verification is additionally limited to ten per owner/receipt/five minutes and
the SDK's three OTP attempts. Owned counter keys contain hashes, never addresses,
provider subjects or raw receipts. A three-column typed SQL table provides atomic
fixed-window counters. The SDK globally prunes its own limiter table at its
shorter HTTP window; its real cleanup must not reset these longer owner bounds.

## Admission and retention

The SDK owns state cookies, authorization proxy, PKCE, provider token exchange,
OTP hashing/verification, secure cookies and session issuance. Public validation
hooks accept only original-UID sign-in through the captured linked subject.
Recovery disables signup, account linking, token refresh writes and profile
overrides. Scoped SDK database hooks also forbid user/account mutation and
unverified-mailbox promotion. Apple without an email may use only the verified
original mailbox selected by its exact captured subject.

Immediately before SDK session insertion, one D1 DELETE-and-return consumes the
still-valid intent while rechecking the receipt, existing verified user and
captured identity. Cancellation, concurrent proof, expiry, receipt/user/link
removal and completed deletion therefore cannot admit a replacement session.
If SDK session insertion subsequently fails, the consumed intent is not reused;
a new bounded recovery attempt is required. Missing/cancelled OAuth intent
indexes cannot fall through into normal signup/sign-in because every auth
instance rejects an unmatched trusted recovery marker.

Unused prepared receipts expire after 30 days. Started `deleting`/`cloud-retired`
proofs remain usable while their original user exists, including beyond 30 days;
unrelated preparation cleanup and capped renewal cannot erase them. Existing
five-receipt bounds remain: only unused, lease-free prepared references rotate.
All of an owner's saved proofs move atomically with identity removal into the
permanent two-column `account_deletion_completions` table. Only the receipt hash
and actual Apple outcome remain; the owner ID and active receipt rows are removed.
There is no completion TTL. A saved dispatched receipt can confirm completion
after any offline interval while that proof remains stored. Unissued, rotated,
expired unused and already-purged proofs stay `unknown`. No retention rule
authenticates, retries deletion or recreates an identity. Migration 0006 must be
applied before deploying this completion boundary.

## Repeatable checks and limits

```
npm run test:server
npm run typecheck:server
npm run test:web
```

Tests use the actual Hono routes, installed SDK, local D1/AccountStore and signed
synthetic provider replies. The installed Expo client test includes real receipt
body merging, authorization proxy/state-cookie transfer and new secure cookies
without a source session. Only native platform/browser surfaces are modeled.
HTTP/SQL checks cover wrong/new/deleted identities, exact Apple subject fallback,
ISO/numeric expiry, no-source email proof, SDK promotion prevention, cancellation,
replay, concurrent callbacks/OTP, admission-time SQL races, failed session insert,
generic errors, send bounds, actual SDK limiter pruning, long-offline pending
retention, permanent anonymous completion and atomic marker/removal rollback.
The SDK-pruning regression failed with the shared
table (200 instead of 429 after two minutes) and passes with isolated counters.

No live provider, email sender, deployed migration, native client/UI, simulator,
retained account or service configuration is changed by this server slice.
