# Puppy sharing

Owners open **Puppy → Share puppy** or choose sharing during onboarding. Sharing requires cloud sync. Local-only logging remains available.

| Access | Account | Puppy permissions | Duration |
|---|---|---|---|
| Household member | Normal Puptime account | Full history, logging and routines | Until removed |
| Temporary carer | Normal Puptime account | Full history and routines; add logs and correct their own, or view only | Chosen date within 30 days |

Send an invitation using the native share sheet or scan its QR code. One account claims each invitation; the same account can retry acceptance. Recipients can accept in the app or on the private care page, then open the puppy in Puptime. Onboarding includes **Already invited?** and an optional owner sharing step.

Shared puppies open the same native app screens as the owner's journal: logging, timeline, routines, insights, notifications, settings and widgets. Each puppy/account pair has its own local SQLite database and uses the existing resumable sync engine and offline outbox. Selecting another puppy remounts the journal and binds its callbacks to that database. The recipient's own puppy and preferences remain separate. Foreground sync checks for changes every 15 seconds and on resume. Owner WebSocket channels are never exposed to members.

Personal appearance, widget choices, notification preferences and temporary carers' routine reminder toggles remain local. Guests cannot rename a puppy, change access, edit another person's logs, or manage shared routines. Server authorization is authoritative. A stored deadline also blocks local writes after expiry. Revocation is discovered when online; an offline device cannot learn a new revocation until it reconnects. Unsynced work is retained when service access ends.

Widget operations carry their original puppy scope and remain queued until that puppy is selected and its SQLite commit succeeds. Temporary routine reminders use dated requests ending before access expires. The OS notification limit bounds how far a large routine can be scheduled; the app replenishes requests when opened.

## Deployment and security

Apply `server/migrations/0003-puppy-sharing.sql` before deploying the Worker and website, then release the native client. This migration is new in this PR and requires no per-account schema changes. Never replace existing auth/account databases.

Application IDs use `shr_` grants, `inv_` invitation secrets and `csr_` request identities. Secrets are URL fragments and POST bodies, never API URL parameters. Only SHA-256 hashes are saved. Normal Better Auth sessions identify every recipient; there is no anonymous guest credential mechanism.

Shared native requests carry an expected member account and grant ID. Only account summary, enrollment, pull/push, record history and photo reads support shared scope. Each reads the authorized puppy alone. Account preferences, exports, integration keys and account management remain the member's own. The owner Durable Object rechecks membership, expiry, revocation and deletion state before each shared operation. Immutable revision actors enforce authorship even if a client spoofs its device ID. Existing revision reconciliation and idempotency protect offline retries.

Private `/care` has no analytics, is excluded from the sitemap, and sends no-store/no-referrer/noindex headers.

## Verification

Server tests exercise normal account acceptance, claim/retry, complete history, owner isolation, scoped native sync, spoofed authorship, view-only access, expiry, revocation and account deletion. SQLite tests check offline writes, rollback of unauthorized changes and personal preference isolation. Widget tests cover scope changes without lost or misattributed operations. Scheduler tests check deadlines with the app closed.
