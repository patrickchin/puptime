# iOS cloud-account deletion

The account screen verifies the original account before showing the native
destructive confirmation. Deleting the cloud account keeps this iPhone's puppy
profiles, activities, routines, preferences and local revision history. It does
not cancel a subscription.

The client uses the installed Better Auth/Expo SDK for cookies, secure storage,
email verification and the provider browser. A provider initiation is not proof
of completed verification: the client checks the original user, global local
ownership generation and a newly created session. Only already-connected
providers are offered. The server remains authoritative for recent identity
verification and provider-subject ownership.

Before dispatching DELETE, the client saves a status receipt in the typed SQLite
`local_account_deletion` table and durably marks it dispatched. The additive
table opens existing schema4 databases without rewriting their content. An
uncertain result blocks account changes and sync while free local logging
continues. Restart and status checks never resubmit DELETE. A further destructive
request requires identity verification and a new explicit confirmation.

An acknowledged result is saved before secure-credential cleanup. Cleanup
rechecks the original user and global ownership, uses SDK sign-out and verifies
that credentials were cleared. Only then does one fenced SQLite transaction
detach sync and retain a completion notice. A different owner's credentials or
generation are never cleared. The notice survives restart and includes a fixed
Apple Account link when upstream Apple disconnection needs manual attention.

Lifecycle JSON responses have a 64KiB bound and a complete-body deadline,
including after HTTP headers arrive. The original native Response and auth
headers are retained for SDK hooks. A cancelled late OAuth initiation is rejected
before the SDK can open its browser. Human time in an already-open provider
browser is excluded from the initiation deadline.

## Executed checks

- 425 Node tests, base types and iOS types pass on this native slice.
- The lifecycle SDK/controller files include 45 passing checks covering the
  actual installed SDK hook order, cancellation, body deadlines, cold restart,
  new-session proof, explicit confirmation, lost replies, secure-storage failure,
  owner changes, stopped controllers and transport shutdown.
- Nine new SQLite storage cases are included in the 134 passing local tests.
  They cover cross-pet boundaries, failed transactions, persisted receipts,
  acknowledged cleanup and retained local rows.
- Independent review found and fixed cold-restart method discovery, a late
  browser after cancellation and header-only timeouts. Their regressions pass.
- A dedicated iPhone17 simulator has completed real local OTP sign-in,
  trial/enrollment/sync and same-owner email reauthentication against the actual
  local Worker/D1/DO foundation. Verification and confirmation/cancellation
  screens have run. Final deletion/restart and interrupted-response recording
  remain under qualification; no complete native matrix pass is claimed here.

Private evidence pointers are recorded in the task's progress ledger, not
committed with credentials, OTPs, receipts or exported puppy data. Provider and
email entry are excluded from product recordings.

## Remaining gates

The server dependency is the original-owner lifecycle foundation and migration4;
its local integration tests use synthetic provider endpoints, not real Apple or
Google reauthentication/revocation. The native release still needs the complete
local/deployed, standalone, interrupted-response and layout matrix. An enabled
button intermittently failed to receive a selector-based test tap; direct taps
and cancellation work, and that automation-delivery discrepancy is retained as
an unresolved qualification issue rather than described as a product fix.

A pending deletion whose original session has expired or been revoked still
needs a separate, receipt-bound existing-user recovery flow. The current guarded
routes intentionally require a live source session. Ordinary signup is not a
fallback. Receipt retention beyond the current30-day window also needs a defined
recovery policy. Billing, Sentry, distribution and genuine provider service gates
remain part of the wider goal. Android, widgets and nap work remain deferred.
