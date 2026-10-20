# iOS receipt-bound deletion recovery

This slice builds on the reviewed server recovery API (PR #110) and native
account deletion (PR #109). A saved operation can now resume after its original
SDK session expires or is revoked. The server still verifies only its original
existing owner through the verified mailbox or already-linked provider subject.
The native client does not fall back to ordinary signup, provider linking or a
receipt-free deletion request.

## Behavior

A saved intent checks status before requesting any identity proof. `deleted`
uses the existing dispatched/acknowledged cleanup, preserving all local puppy
history. `pending` and `not-started` can show verification. `unknown` stays
unconfirmed, with a status check and local logging available; it cannot verify,
authorize deletion, acknowledge success or detach an owner automatically.

A live original session retains its existing reauthentication flow. Without a
source session, the existing verification card offers configured Apple/Google
buttons and owned email proof. Receipt-only APIs disclose no mailbox or linked
provider list; the card uses generic original-method guidance and no email.
A wrong or unlinked identity fails generically on the server.

The lifecycle facade uses the same Better Auth/Expo instance and secure cookies.
Email start/verify/cancel send the receipt only in owned POST bodies; social
recovery merges it into SDK fetch options with its separate recovery header.
The SDK owns all OAuth, browser, OTP and session behavior. A complete bounded
response must include `recoveryIntentId` before native cookie/browser success
hooks; late cancellation can refuse the browser with the existing started-false
gate. Requests have no automatic retries, bounded complete-body deadlines and a
64-KiB UTF-8 response cap. The human browser interaction is outside the starter
network deadline.

Proof completion reads the actual SDK session and matches the saved original UID,
new session ID when a prior one is known, setup epoch and global local owner /
generation. The same fences are checked before confirmed dispatch. A proof,
startup refresh, callback or status result cannot issue DELETE. Every retry
requires a new explicit deletion confirmation. Cancellation preserves dispatched
proof and cannot pretend to cancel an already committed deletion.

Started server proof remains usable while its original user exists. The client
therefore reuses its durable pending receipt even when the original local
`expiresAt` is past; it does not request a sixth receipt when all five server
slots already represent started work. Receipt changes and owner changes during
dispatch fail closed. Prepared references that have become unknown are not
silently replaced through ordinary signup or deletion.

## Repeatable checks

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/cloud/account-deletion-controller.test.ts src/cloud/account-lifecycle.test.ts
npm test
npm run test:server
npm run test:web
npm run typecheck
npm run typecheck:ios
npm run typecheck:server
```

Controller checks use the actual on-disk SQLite runtime, two populated puppies,
local revisions and pending sync tables. They cover missing source credentials,
email/social proof, status-first completion, explicit confirmation, aged started
proof without further preparation, wrong UID/receipt/global owner, absent or
unchanged session, generation change, network/disposal, late cancellation,
restarts and generic proof failures. Content/outbox preservation is asserted.
SDK checks run the production lifecycle facade through installed Better Fetch
hooks, including POST-only body merging, no inherited retries, preserved original
response/cookie hooks and stalled-body deadlines. The Workers Expo test also
passes that production facade through the installed Expo client/server SDK,
actual Hono routes and local D1, with ISO-expired and revoked source sessions,
synthetic signed Google replies and owned email proof. Only the native platform
and provider network are modeled there.

## Remaining acceptance gates

No native simulator, installed app, real email/provider, active backend, deployed
migration or service configuration is changed by this source slice. Fresh iOS
Release screenshots/video and populated-history acceptance, including cancelled
native browser returns and secure-storage faults, remain a dedicated parent
verification task. The current card/layout/theme, accessibility labels and OTP
paste/autofill are reused; the new recovery and unknown states still need that
visual and assistive-technology pass before completion is claimed.

Completed status lasts 30 days from completion. A much later offline device may
receive `unknown` after the original user is gone, and an unused expired or
rotated preparation can also be unknown. This slice does not claim unlimited
offline completion recovery. It preserves the unresolved local intent/history
and does not invent automatic unlink/cleanup or treat missing proof as success.
A longer-lived minimal completion tombstone or explicit unresolved local-only
continuation is a separate product/retention policy gate.
