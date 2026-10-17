# Cloud implementation verification

This is an evidence ledger, not a declaration that cloud features have shipped. The app remains local-only until the native UI and persistence phases land.

## Environment and cost boundaries

- Cloudflare account's Workers plans dashboard showed **Free / $0 / Current plan** on October 17, 2026. No upgrade selected. CLI billing-subscription read returned 403; its Worker settings read alone was not used as proof of a free tier.
- Created dedicated **puptime-auth-staging** D1 database on that Free account, restricted to EU jurisdiction. No other product's database was reused. The staging account Durable Object namespace also selects EU jurisdiction; local tests use local storage.
- Staging API address: https://puptime-api-staging.p-ch.workers.dev (deployed; synthetic authenticated API journeys verified below). It is a provider hostname, not the final dedicated Puptime domain. Do not use harpapro.com for sender/public host.
- Staging and production must use separate identity databases/namespaces and secrets. No production database or paid catalog has been configured. Prices remain provisional and catalog-driven.
- The default local binding has a placeholder database ID and cannot be used as production configuration. Local email previews are database-only and require ENVIRONMENT=local. Never set that value on a deployed environment.

## Verified locally

- Node app/domain checks and client/server typechecks pass; exact totals and commands are recorded in the phase execution ledger.
- Actual Workers SQLite and D1 integration tests cover transactional rollback after a post-write failure, durable/idempotent operations, account/pet isolation, enrollment confirmation, device association, concurrent edits, immutable history pagination, full bounded exports, expiry and trial activation.
- Standard Better Auth flows cover hashed OTP storage, wrong/expired/reused codes, origin checks, session creation/sign-out, own-account responses without credentials, recent-auth deletion, retryable deletion state, session revocation, complete cloud retirement, and old-device resurrection prevention.
- Two-pet storage fixtures prove that the one-puppy UI release is not a one-pet database/device constraint. Nap-log changes are deferred; existing controls and history remain intact, and no inferred completion is introduced.
- Worker bundle dry-run passes. Fresh Android/iOS/web exports pass with the new dependencies; native runtime builds and acceptance remain in the native-integration phase.
- Vendor warning: standardwebhooks' published sourcemap references missing source files during test transformation. No test failures or unhandled runtime errors are suppressed.

## Verified deployed staging

- Applied both D1 migrations remotely and deployed the reviewed server source on October 17, 2026. Source deployment version: `9e5afbc6-b863-408b-b2b8-24e413e6faef`; subsequent secret-only deployment configured the staging auth secret. D1 reports EEUR. No paid resource upgrade or live billing.
- `scripts/verify-cloud-staging.mjs` exercises real HTTPS health/configuration, anonymous/unknown routes, unavailable email failure, actual Better Auth session validation, ownership, explicit trial/enrollment, confirmation before attaching another device, duplicate operation retries, partial failures, automatic independent-field merging, future-cursor recovery, expiry, complete history export, deletion confirmation/recent-auth checks, revoked sessions, and rejected old-device writes.
- Sessions are seeded administratively into the isolated staging D1 and signed using the installed identity library's cookie utility. This verifies deployed authentication/session checking and downstream services, **not** email delivery, Apple, or Google sign-in. Fixtures are deleted through the normal account lifecycle; no test-code endpoint or auth bypass is deployed.
- Run with authenticated staging Wrangler access and `PUPTIME_STAGING_AUTH_SECRET` supplied privately: `node scripts/verify-cloud-staging.mjs`. The secret is stored in macOS Keychain service `com.puptime.cloudflare-auth-staging`, account `puptime`; never print it or put it in a command argument/log. Temporary administrative SQL files are mode 0600 and removed at exit.
- This machine's configured DNS returned no staging address while public Cloudflare DNS returned valid A records. Verification used a process-local hostname lookup from that public DNS, retaining the staging hostname and TLS certificate validation. System DNS settings were not changed.
- Fresh whole-branch review found overlapping-email-suffix verification cleanup. The regression reproduced the cross-account deletion, then passed with exact allowlisted Better Auth OTP identifiers. Full checks: **42 Workers runtime tests, 111 Node tests, both typechecks, Android/iOS/web exports**. The existing optional self-hosted simulator CI job is separate from native acceptance.

## Account lifecycle behavior

Authentication alone does not activate a trial or attach local puppy data. Trial activation and pet enrollment are explicit authenticated actions. A returning account's puppy name/history summary is shown before combining; different-puppy recovery must preserve the local copy.

Cloud cancellation/expiry stops ongoing sync, retaining cloud data and authenticated manual export. An export is versioned NDJSON with a manifest, complete revision records, and a final completion marker, bounded to the sequence captured at export start. Import/recovery must reject a missing completion marker rather than treat a partial download as complete.

Account deletion requires explicit confirmation and recent authentication. The official identity library performs identity/session deletion, with a before-delete hook first marking cloud access as deleting and atomically retiring cloud contents. A failed attempt remains retryable; success is not acknowledged until these operations complete. The account object retains only non-content schema/retirement metadata to block old clients, not puppy history or names. Provider-managed backup expiry must be documented against the actual service settings before public release.

## Remaining release gates

- [x] Apply staging migrations, deploy, and verify real HTTPS happy/edge API journeys with isolated synthetic fixtures.
- [ ] Native transactional migration, widget acknowledgement, and cloud UI/runtime checks on dedicated iOS/Android devices.
- [ ] Dedicated domain and real verified email sender/inbox delivery; local previews do not prove SMTP delivery.
- [ ] Real Apple/Google provider configuration and native callback/recovery checks.
- [ ] Stripe/native billing events and resulting entitlement verified; sandbox evidence reported separately from any approved live transaction.
- [ ] Sentry release error/crash ingestion, symbols/source maps, redaction and alerts; telemetry ingestion/control tests.
- [ ] Desktop/mobile marketing and account-management browser journeys, screenshots, and accurate coordinated policy/store publication.
- [ ] Backup restoration, rollback and populated Android UI performance checks.
- [ ] Production deployment and distributed app acceptance matrix, including documented unexecuted provider/store/physical-device checks.

Do not tick a gate based on credentials being configured, a mock returning success, or a different environment passing. No live charges or paid resource upgrades are authorized by the current free-tier boundary.
