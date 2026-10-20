# iOS cloud export verification

The current [cloud development milestone](cloud-development.md) removes trial
gating. Historical recordings below retain their original source scope; rerun
the updated harness against the new baseline before claiming current acceptance.

The account screen exports the complete cloud revision history independently of
device sync status. It uses the installed Better Auth SDK, a guarded same-origin
POST, streamed validation, a private temporary Expo File and the native share
sheet. Export does not enroll the local puppy, upload pending changes or alter
local history. Activity CSV remains a separate action in Insights.

The controller serializes export with account actions, pauses sync transport,
and checks the original account and local generation before sharing. Cancel,
Back, swipe dismissal and screen unmount abort queued or active downloads.
Download errors appear beside Export; authentication and ownership failures
retain their account-level handling. Dismissing a share sheet confirms only
that the sheet closed, not delivery to a destination.

The server captures one snapshot inside the account Durable Object and streams
one stored revision per pull through one RPC. Every pull checks retirement and
contiguous sequence order. Later writes remain outside the snapshot. The client
rejects malformed, truncated, out-of-order or trailing data before presentation;
partial-line memory is bounded at one MiB. Temporary files are removed after
failure or dismissal, with orphan cleanup on client initialization.

Code checks pass 371 app tests, 97 Workers tests, nine web tests and base, iOS and
server types. The actual local Workers runtime exports 100,000 revisions /
76,611,192 bytes in one RPC, with a maximum 772-byte chunk. The same check verifies
snapshot isolation, Unicode, concurrent writes and interruption by retirement.

Recording330 verifies a genuine local native SDK sign-in (unrecorded), an expired
trial and 1,001 independently created Unicode cloud revisions. Five native files
match their exact HTTP responses. Truncation, Cancel, account-sheet swipe and a
60-second stalled-body timeout each preserve all 14 local tables, clear private
temporary files and permit a successful retry. It uses signed Debug with default
Metro and an isolated local backend. The later focused feedback recording covers
the final inline-error placement; recording330 retains its original source scope.

Repeat on a fresh task-named simulator starting with
`Puptime Native Storage ae0c cloud-export`. Install the dependency-matched Debug
app and use the default Metro configuration with
`EXPO_PUBLIC_CLOUD_API_URL=http://127.0.0.1:8899`,
`EXPO_PUBLIC_CLOUD_ALLOW_LOCAL=1` and `EXPO_NO_DOTENV=1`.

```sh
node scripts/verify-ios-cloud-export.mjs serve
# In another terminal, with the same private local service still running:
node scripts/verify-ios-cloud-export.mjs request "$PUPTIME_TEST_DEVICE" --private-auth
node scripts/verify-ios-cloud-export.mjs verify "$PUPTIME_TEST_DEVICE" --private-auth
node scripts/verify-ios-cloud-export.mjs seed
node scripts/verify-ios-cloud-export.mjs acceptance "$PUPTIME_TEST_DEVICE"
```

The harness owns ports8799/8899 and disposable local persistence. Authentication
phases refuse recording and remove their raw private artifacts. Post-auth checks
retain screenshots and text evidence. Use `--record` only when replacing a
curated review journey; reruns preserve the existing fixture and failures.
It never resets a simulator,
replaces native SQLite or targets a live service.

Deployed timing, distributed standalone Release/physical-device acceptance,
native enrolled/pending account-switch cases and real provider recovery remain
separate gates. The signed HTTPS Release build alone does not qualify those
journeys. No retained human account or paid service is changed by this harness.
