# Guest history at sign-in

Sign-in preserves local history. Upload starts only after explicit **Enable cloud
sync** or confirmed **Combine**, including when the account already has a dog.

`src/cloud/guest-sync.test.ts` adds 19 scenarios to the ordinary `npm test` run.
They use the production controller, sync runner, storage and API schemas, an
on-disk SQLite database, and an in-process cloud replica. Authentication is
simulated in this suite. Assertions compare complete local and remote event
values rather than only counts or the displayed sync status.

Coverage includes:

- Continue without an account, finish setup, record offline history, restart,
  then email/Apple/Google sign-in and explicit Enable/Combine.
- Every log type, widget entries, Unicode notes, custom labels, open and finished
  naps, offline edits/deletions, and history spanning upload and download pages.
- Existing cloud history and overlapping IDs, confirmation guards, and refusal
  to use first-launch Restore over existing guest logs.
- Lost enrollment/upload replies, interrupted baseline pages, SQLite transaction
  failure, exact retry IDs/payloads after reopening the database, and no duplicate
  upload after a completed restart.
- New logs and edits during the baseline/upload, backgrounding or disconnection
  in flight, denied access, and cancelled/failed authentication.

The tests also pass against release tag `v1.11.35` (`d3b2911`). Temporarily
disabling the initial guest upload queue makes the new-account journey fail on
missing remote events; the production implementation was restored afterward.

## Native iOS verifier

`scripts/verify-ios-guest-sync.mjs` drives the five `ios-guest-*.yaml` flows and
the existing cold-start account flow. It requires a disposable simulator named
`Puptime Native Storage … guest-log-sync` and a private harness directory whose
name begins `puptime-guest-`. The verifier resets only that simulator's app and
keychain. Use a fresh local Worker with `ENVIRONMENT=local`, a loopback
`AUTH_BASE_URL`, a private `.dev.vars`, and its own `state/` persistence directory.
Apply the D1 migrations before starting the Worker with that directory's
`wrangler.json`. Install an app with matching native dependencies and the same
local API origin; Debug builds require `EXPO_PUBLIC_CLOUD_ALLOW_LOCAL=1`.

```sh
node scripts/verify-ios-guest-sync.mjs SIMULATOR_UDID /tmp/puptime-guest-YOUR_HARNESS
```

The verifier completes the guest route, then suspends only the owned local Worker
while the app makes three real quick logs. With the app stopped, it adds 114
synthetic records through production storage to exercise paged history. It then
resumes the service, signs in through the official native SDK using private
local OTP previews, and explicitly enables sync. A second fresh guest profile
signs into the same account and confirms Combine. Each scenario checks the
unchanged pre-sync history, every native and actual HTTP service event, an empty
outbox, the displayed count, and a cold restart. OTP traces are discarded or
redacted; retained screenshots show only post-login synthetic account data.

This checks local native integration, not inbox delivery, social-provider UI,
or the distributed Android APK. The reported loss in APK 1.11.35 remains
unreproduced; passing tests do not establish its cause or claim a fix.

## Recorded verification, 2026-10-21

- Current branch: all 466 app tests and 103 server tests pass; base, iOS and
  Android typechecks pass. The new 19 scenarios also pass on `v1.11.35` source.
- Fresh Debug iOS build from `v1.11.35` source, official native email SDK, and
  isolated local Worker pass on iPhone 17 / iOS 26.5, dedicated simulator
  `Puptime Native Storage d1fb guest-log-sync`.
- Enable: 117 guest events remain identical through sign-in, upload and cold
  restart; actual service events match every field and the outbox is empty.
- Combine: another 117 guest events merge with the existing 117 cloud events;
  all 234 local and service events match and survive cold restart, with no
  pending operations.
- Early harness attempts failed before sign-in because of native-shell/signing
  setup and a quick-action selector. The final fresh signed build and corrected
  flows pass both scenarios; those setup failures are not sync results.
