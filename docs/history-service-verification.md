# History service qualification

`scripts/verify-cloud-history.mjs` adds the history-specific service matrix from
Task5 of the iOS log-history plan. It is runnable qualification, not a statement
that a particular deployment or app build has passed. Record the environment,
exact service version, exit status and evidence path after each actual run.

Run sequentially with the existing isolated local Worker already running:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-cloud-history.mjs local
```

Run against the fixed staging HTTPS origin with authenticated Wrangler and
`PUPTIME_STAGING_AUTH_SECRET` privately supplied through the existing Keychain
injection (never paste its value into a command, log or recording):

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-cloud-history.mjs staging
```

The local run reads the existing private backend state at
`/tmp/puptime-native-cloud-state.json`. The script creates its own two synthetic
administrative identities and separate persistent SQLite files. It does not
reuse a native simulator's saved owner, alter deployment/configuration, enable a
paid service, or contact a delivery provider. Its fixture sessions are not proof
of email, Apple or Google sign-in; actual provider gates remain separate.

The script checks:

- The production SDK accepts actual encoded history responses, validates all
  five revision reasons, fetches exactly50 latest versions and uses an exclusive
  older cursor that stays stable after a newer accepted write. A second owner
  sees no versions, anonymous access is rejected, and an already cancelled
  request dispatches nothing.
- A fresh independent SQLite client initially has the current baseline only.
  Selecting a cloud-only older version creates one current-revision restore
  intent. Pending, stale local and stale remote confirmations preserve every
  SQLite table. A committed-but-lost HTTP reply and disk reopen retry the exact
  operation without another server revision, then a second client converges.
- Deletion restoration preserves identity, source, custom label and the sticky
  estimate marker without recreating the removed custom quick action. A stale
  server restore conflicts without adding a version.
- Expiry blocks new server history reads while already retained local versions
  remain restorable, queued work remains pending, and authenticated export
  contains the oldest and latest accepted cloud history.
- Normal account retirement revokes fixture sessions. Authoritative D1 queries
  verify zero remaining fixture user/session/provider-account/cloud-account
  rows. Raw HTTP bodies, cookies, auth secrets and Wrangler output are never
  emitted. Temporary administrative SQL is mode0600 and scrubbed after each
  call. Successful runs remove synthetic SQLite files; failed runs retain only
  local synthetic SQLite plus owner identifiers for recovery, never tokens.

Keep the existing broader matrix rather than duplicating its WebSocket tests:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-cloud-clients.mjs local
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/verify-cloud-clients.mjs staging
npm run test:server
```

`verify-cloud-clients` covers actual authenticated WSS cursor-only messages,
owner isolation, normal retirement closing sockets,1000-event upload/restore,
interrupted baselines, independent field merge, reconnect/restart and expiry
export. `server/account-routes.test.ts` uses the actual local Better Auth email
OTP path and Workers storage for authenticated merge/deletion/restoration
history. Neither replaces the current installed iOS history journeys, immutable
Release, appearance/render checks or real external provider acceptance.

Do not record the administrative session setup or private command environment.
Review videos should show actual app journeys; terminal results belong in the
text evidence gallery. No service execution was performed while authoring this
qualifier; root qualification remains required.

## Actual qualification on October 19

Records225(local) and226(deployed staging) pass the complete HTTP matrix on the
reviewed3304 foundation, including an actual current server snapshot no-op and
no-write rejection of contradictory immutable data/revision ordering. Both
finish normal account retirement with authoritative zero fixture rows and
revoked sessions. The server source deployment remains
`bff50626-a5ab-42be-adbe-23f86bd85325`; no deployment or paid resource was changed.

The host's ordinary staging DNS still returns ENOTFOUND. Staging qualification
uses the existing process-local `--require ./scripts/staging-dns.cjs` lookup,
retaining the hostname and normal TLS certificate validation. This is labelled
in226 and does not establish ordinary-DNS or public-provider acceptance.

Earlier210(local) and221(staging) pass the matrix before adding the final
immutable-mirror service cases.211/216 stopped on a qualifier parsing error:
remote Wrangler `--file` uses the import API and emits upload progress even with
`--json`, returning import metadata rather than SELECT rows. Private writes now
discard that output; credential-free aggregate reads use `--command`. Both
abandoned exact fixtures were retired normally and their authoritative counts
returned to zero. Failed logs remain failed. Native history UI, appearance,
owned-client and final standalone release qualification remain separate gates.
