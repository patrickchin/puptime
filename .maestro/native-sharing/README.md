# Native shared-care acceptance (not yet run)

These new flows and `scripts/verify-native-sharing.mjs` are preparation for a
separate test PR. They are not wired into the account runner or a workflow.
No native pass, sharing feature fix, production-provider result or release
readiness follows from the small Node checks.

After the account-evidence PR is frozen, a thin runner adapter can call
`verifyNativeSharing` twice: household and temporary contributor, each with
its own fresh pair of synthetic accounts/devices. Reuse the existing installed
Better Auth SDK, local HTTPS Worker/D1/DO service, native host and evidence
helpers. Do not copy the account runner or introduce another service/client.

Preconditions are made by the real native UI/SDK: A has signed in, explicitly
enabled cloud and synced at least one pee log; B has signed in and has personal
logs but has not enabled personal cloud. Neither fixture has a walk log or an
existing invitation. Both use English and plain synthetic member names/labels.
This module never clears application state, inserts history, edits SecureStore
or seeds a cloud association. No genuine provider identity or owner record is
needed or allowed.

The future adapter contract is:

- `activate(actor)`: stop/suspend the former actor before changing the current
  SDK/session/device binding. Two task-owned simulators retain separate real
  SecureStore identities; only one is active at a time. In particular, B must
  be stopped before transport goes online for A's revocation.
- `owner` and `carer` provide `flow(name, env, {secret})`, `snapshot({care})`,
  `cookie()`, `nativeShareCopy()` and `openURL(url)`. The carer's `accountId`
  comes from the actual native SDK account receipt. Its `attribution` is the
  independently observed member name, or the invitation label when the real
  account name is empty, never a hard-coded guessed actor ID.
- `flow` resolves the named new flows through the existing Maestro wrapper.
  `nativeShareCopy` only reads and clears the clipboard after the authored
  native Share/Copy step. `openURL` quietly opens the native scheme and handles
  any task-local system Open confirmation. Neither may print command arguments.
- `snapshot()` reads the personal database; `snapshot({care:true})` resolves
  the **actual accepted selection** and reads its separate care database. Both
  return the existing `{tables,events,owner,pending}` shape. Read all 14 tables
  in a single transaction, with no side-effectful application API.
- `readOwnerRecords({historyFor})` uses A's observed cookie against the real
  local service and returns `{records,revisions}`. Resolve requested local
  event IDs to their cloud IDs, paginate completely, and read history through
  the existing owner API. Never inject this cookie into B or the native SDK.
- `transport(mode)` reuses the existing controlled outage proxy and waits for
  prior forwarded requests to settle. `wire()` returns immutable cumulative
  `{pushes,accepted,pages}` observer snapshots. Reuse its checked content-
  encoding decoder and zero-parse-error guard; do not change native bytes.
- `protectSecret(value)` registers tokens, copied/deep-link URLs and existing
  auth values for redaction before a command can fail. `fixtureOrigin` is the
  exact HTTPS loopback service origin, never a production host.

All adapters above remain unimplemented/unverified for this module. The shared
care database selection and actor switching especially cannot be inferred from
the existing personal-journal snapshot helper.

Secret phases include invitation creation (its QR encodes the token), Share,
Copy, initial open/accept, revocation and stale-link acceptance. Discard every
driver output for these phases on success **and failure**, including global
Maestro startup logs, commands, screenshots, hierarchies and temporary flow
arguments. Keep the link only in memory and clear the clipboard immediately.
Do not pass it in Maestro environment variables or retain QR screenshots.
Only explicit post-accept history/attribution/access-ended images may be kept.
The future adapter must enforce this policy before any native execution.

Assertions cover exact prior activity and revisions, B's unchanged personal
14-table database, actual queued mutation/result acknowledgements, offline and
post-drain cold restarts, service revision actor plus owner-visible attribution,
and revoked pending work/stale invitation rejection. `assertNativeDrained` is
reused unchanged and currently requires stable local domain/history rows during
drain; any future legitimate server projection change needs a specific observed
expectation, never a blanket table exclusion. Current source may omit readable
attribution from shared-sync writes; retain the failing assertion and reproduce
it before proposing a separate product change.

This does not cover genuine Google/Apple or email delivery, production web link
handoff, OS airplane mode, elapsed temporary-invitation expiry, Android parity,
or a release APK/AAB. A controlled outage and explicit revocation are the scope.
