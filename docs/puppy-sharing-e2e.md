# Puppy sharing end-to-end qualification

The runners use disposable `@example.invalid` accounts, genuine email OTP sign-in, isolated local D1 and SQLite Durable Objects, and the production sync protocol. They do not accept a production service target. OTPs and invitation secrets are excluded from public evidence. Seed data is created through the API; user journeys run through the real native or browser UI.

## iOS

Install dependencies, Maestro and Xcode's iOS 26.5 runtime. Boot a dedicated simulator named `Puptime Account Sharing <worktree>` and supply a compatible simulator `.app` built with simulator SecureStore entitlements (`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`). The runner installs the host, embeds current release JavaScript with an isolated HTTPS service URL, and signs the resulting bundle locally. It rejects existing account-owned fixtures before resetting anything.

```sh
npm run test:e2e:sharing:ios -- SIMULATOR_UDID /absolute/path/Puptime.app --replace-synthetic "$HOME/Pictures/Screenshots/Codex/puptime-sharing"
```

Ports 8797 and 8799 must be free. `--replace-synthetic` authorizes resetting this dedicated simulator's synthetic app data and keychain. The runner installs a temporary local fixture CA in that simulator. It leaves synthetic app state available for investigation; reusing a completed fixture requires deliberately erasing that dedicated simulator first. It never erases an arbitrary simulator or replaces an owned fixture automatically.

| Journey | Checks |
| --- | --- |
| Owner invitations | Real native email sign-in and explicit cloud enrollment; household, temporary contributor and view-only invitations; QR availability and native share sheet. |
| Separate recipient | An invitation replaces the open My account sheet through the iOS confirmation; signed-out acceptance requires an account; different SDK account owns its own three-log puppy; accepting a link restores all 501 owner logs and a routine across sync pages. |
| Full journal | Log, timeline, insights and routines open normally; temporary carers cannot edit owner logs or routines; view-only access exposes no logging or editing. |
| Shared writes | Native create/edit reaches the owner's store; recipient's own event IDs, data, ownership and outbox remain exact. |
| Offline recovery | Real HTTPS outage; create/edit persists through two process restarts; reconnect uploads once and drains the outbox; owner converges to 503 logs. |
| Ended access | Owner revocation and temporary expiry block the active journal; cached history and exact unsynced intents survive; My puppy returns to the unchanged personal journal. |
| Render isolation | After the normal functional journeys, a separate diagnostic bundle uses the existing native activity probe; mounted event render counters must stay identical while a local editor draft changes and returns to its original value. |

The diagnostic bundle is identified separately from the normal bundle. This qualifies current JavaScript inside a compatible native host; it does not establish a fresh native build or App Store signing. Android parity is assumed for the shared implementation; Android runtime is not run by this command. Camera QR scanning, external Apple/Google login, physical Home Screen widgets and OS delivery while the app is terminated remain separate device qualification checks.

## Browser care page

```sh
npm run build:web
PUPTIME_PLAYWRIGHT_MODULE=/absolute/path/to/playwright npm run test:e2e:sharing:web
```

Use `PUPTIME_CHROMIUM_EXECUTABLE` if the installed Chromium does not match the selected Playwright package. Ports 8798 and 8898 must be free. Browser dependencies follow the existing web-account runner and are not added to the app's production dependencies.

The browser runner covers anonymous preview, fragment removal and credential cleanup, real OTP acceptance, 61-log pagination, normal scrolling and full-history background coverage, phone layout, household routine management, temporary create/edit with owner-visible attribution, reload, view-only dark mode, claim/retry, revocation, expiry and malformed invitations. It also checks that API URLs contain no invitation secrets and care pages declare noindex/no-referrer without sending telemetry. Local static hosting does not establish deployed response headers; server tests cover API headers, and Pages' production headers remain a deployment check.

Fresh screenshots and `verification.json` go under `~/Pictures/Screenshots/Codex/puptime-sharing-2c13/` by default for the browser run and the supplied iOS output directory. A verification manifest is written only after all assertions pass. Failed attempts are not passing qualification.
