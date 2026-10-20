# Website operations

The public origin is `https://puptime.pages.dev`. Cloudflare Pages builds `npm run build:web` and publishes `dist-web` from `main`. Submit changes through a PR. The native entry remains `index.ts`; `index.web.ts` uses Expo Router for static marketing and account routes.

## Account management

`/account` is a static, noindex shell; private data loads only in the browser through the installed Better Auth SDK and same-origin `/api/*` Pages service binding. It is excluded from the public sitemap. Do not enable the native `useCloud` hook for this page or reuse its SecureStore/SQLite adapters. Browser authentication stays in HttpOnly cookies, with no tokens in localStorage. A short-lived sessionStorage return intent fences provider linking and same-account reauthentication across redirects; no destructive action resumes automatically after return.

The page supports configured email/Google/Apple sign-in, explicit provider linking, sign-out, browser download of cloud data, and confirmed deletion. It does not activate trials, enroll puppies, log activity, or offer checkout. Billing has no implemented endpoint here. The browser's download manager handles a standard same-origin POST form and streamed NDJSON; a click means started, not successful completion. The server export includes a final completion marker and remains available when sync access expires.

The export form carries the displayed account identifier in its POST body, which the server checks against the actual request-cookie session before opening the stream. A mismatch returns a readable 409 page with a link back to the account and no download. Existing GET exports remain available for native callers.

Authenticated linking and deletion send `x-puptime-account` with the immutable expected user ID. The server compares it with the actual request-cookie session before acting, fencing cross-tab cookie switches; callers without that optional header retain the existing API contract. Deletion requires a session younger than ten minutes and a new confirmation after reauthentication. An unresolved deletion marker is persisted in necessary localStorage before dispatch, keyed by the expected account identifier; blocked storage refuses dispatch. It survives reloads and closed tabs and is cleared only by acknowledged deletion. Preflight errors and refusals preserve any unresolved marker, including one from another tab. A first wrong-cookie refusal can therefore conservatively retain the original-account recovery barrier. A lost acknowledgment remains unconfirmed, including when the account can no longer be read. A still-valid but stale original session can use `/api/account/reauth` for same-user email verification through BetterAuth with signup disabled, then review a new cancellable confirmation. This endpoint disables old-session renewal during its authentication read so the new SDK session cookie is preserved. Uncertainty never launches ordinary signup or provider reauthentication. Missing, expired, or changed sessions remain fenced with a support path.

Run `npm run build:web`, `npm run test:web`, `npm run typecheck`, and `npm run test:server`. The isolated browser acceptance command is `PUPTIME_PLAYWRIGHT_MODULE=/absolute/path/to/playwright PUPTIME_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium node scripts/verify-web-accounts.mjs`. It uses only ports 8798/8898, a fresh temporary Worker/D1/DO, synthetic local OTP inboxes, and task-owned evidence 300–319 under `output/playwright/web-accounts/`. Never point it at live services or reuse a retained native fixture. Private OTP entry is not recorded and fixture credentials are not retained. Browser acceptance includes in-flight deletion reload/closed-tab recovery, cross-account POST export refusal, and uncertain deletion after ten-minute authentication age. External provider navigation is simulated locally; real provider consent/callbacks and live PostHog ingestion remain separate qualification gates. To exercise the installed analytics SDK without live traffic, first build with `EXPO_NO_DOTENV=1 EXPO_PUBLIC_POSTHOG_KEY=phc_synthetic_web_review EXPO_PUBLIC_POSTHOG_HOST=http://127.0.0.1:8898/telemetry npm run build:web`, then add `PUPTIME_EXPECT_TELEMETRY=1` to the acceptance command. This case emulates an ordinary browser navigator because PostHog filters automated browsers, and intercepts every analytics request locally. It verifies no capture before consent, coarse event properties, withdrawal, and Do Not Track. Rebuild without the synthetic variables before any deployment.

The `.node-version` file pins the shared Pages/CI runtime. The SEO build script uses Node's native TypeScript support; older Pages defaults such as Node 22.16 cannot execute it.

## Search

The build renders the homepage, care library, and all 13 guides to HTML, including article text, headings, source links, titles, descriptions, canonical URLs, Open Graph/Twitter metadata, and JSON-LD. It generates `/sitemap.xml` and `/robots.txt`. Previously shared `/#puppy-care/...` links redirect in the browser to the corresponding clean URL. A top-level `404.html` prevents nonexistent pages from falling back to a successful homepage response. Preview hosts have `X-Robots-Tag: noindex`.

Run `npm run build:web` to validate rendered metadata and headings for every public page; run `npm run test:web` for metadata and telemetry-boundary checks. Deploy previews should be checked at desktop and mobile widths, including direct guide loads, old hash links, search, back navigation, and audio playback.

The Google Search Console URL-prefix property is `https://puptime.pages.dev/`. Its ownership file is committed under `public/`; keep that file deployed so verification remains valid. After deployment, verify ownership and submit `https://puptime.pages.dev/sitemap.xml`. Inspect the homepage and a guide with URL Inspection. Search Console reports indexing and search queries; adding a sitemap does not guarantee indexing or rankings. If the public domain changes, update `src/web/site.ts`, preview-header host patterns, server allowed origins, and the Search Console property together.

## Cloudflare

Web Analytics is already enabled for the Pages project and automatically injects the beacon on deployment. Do not add a second beacon to application code. Cloudflare's Web Analytics dashboard provides traffic, referrers, page load times, and Core Web Vitals. Verify injection in the deployed HTML and incoming data in the dashboard. PostHog's consent control applies to PostHog separately, as explained in the privacy policy.

## PostHog

The dedicated **Puptime** organization uses EU Cloud project **312576** (Default project). Do not reuse project 308052 in Harpa Pro. Keep synthetic tests on the local collector; bounded genuine browser acceptance uses only the dedicated Puptime project.

Cloudflare Pages **production** has `EXPO_PUBLIC_POSTHOG_KEY` set to this project’s public `phc_…` browser token and `EXPO_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`. Changes take effect on the next build, so verify the deployed bundle before claiming activation. Do not enable real PostHog capture in previews; use the local collector below for synthetic events. The browser token is public; personal API keys must never be exposed through `EXPO_PUBLIC_` variables. Review the project's retention, access, and billing limits before enabling production capture.

Optional PostHog analytics load only after consent and respect Do Not Track/Global Privacy Control. The SDK disables autocapture, automatic page/pageleave events, exception capture, session replay, surveys, feature flags, and person profiles. An outbound allowlist removes all full URLs (including canonical URLs), referrers, campaign values, and arbitrary properties. `$geoip_disable: true` requests no server GeoIP enrichment. Consent defaults to off inside the SDK as well as the website. Withdrawal resets the device ID before opting out, because the installed SDK’s `reset()` clears its own consent state. SDK persistence is disabled while opted out. Batching and beacon transport are disabled; each consent period owns an abortable fetch signal that also prevents its failed requests from retrying over the network after withdrawal. Fetch omits credentials and referrers. Only these events are accepted:

| Event | Properties | Use |
| --- | --- | --- |
| `website_page_view` | Known public or account `page` | Guide readership and entry pages |
| `website_cta` | `page`, `destination`: `source` (legacy `android_download` remains accepted) | Source clicks; legacy download events remain readable |
| `website_error` | `page`, `error_kind`: `script`, `unhandled_rejection`, or `render` | Failure counts; no messages, stacks, or private contents |
| `website_account` | `page`: `/account`, allowlisted `action` and `result` | Coarse sign-in/link/export/deletion outcomes, with no account identity |

The exact shared property boundary is `page`, `$pathname` (both known route paths or `/404`), `$process_person_profile: false`, `$geoip_disable: true`, and SDK-generated string values for `distinct_id`, `$device_id`, `$session_id`, `$window_id`, `$lib`, `$lib_version`, and `token`. Event-specific properties are limited to the values above. The SDK/provider delivery metadata includes event time/UUID, sent-at and ingestion timestamps. Received events also have service metadata such as team ID and propertyless person mode. The public `token` is the project ingestion token; it is never a personal API credential. Network requests still expose connection information to the provider. The SDK also sends anonymous IDs and library metadata. It creates no person profiles, and the app does not identify website visitors. Browser failure events are coarse counts, not full stack-trace error monitoring. Native/API diagnostics and Sentry remain separate cloud-rollout work.

Before calling PostHog live, verify both the browser request and the event visible in PostHog Activity. Test a fresh visitor (no SDK request before choosing), decline, allow, withdrawal, reload persistence, blocked storage, provider/network failure, and privacy signals. Confirm event properties omit query strings, fragments, referrers, search input, notes, and raw error contents. Create the small dashboard described below. Do not enable session replay.

### Repeatable privacy acceptance

Build only for this local check (do not deploy this output):

```sh
EXPO_NO_DOTENV=1 EXPO_PUBLIC_POSTHOG_KEY=phc_synthetic_web_review EXPO_PUBLIC_POSTHOG_HOST=http://127.0.0.1:8897/telemetry npm run build:web
PUPTIME_PLAYWRIGHT_MODULE=/absolute/path/to/playwright PUPTIME_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium node scripts/verify-web-telemetry.mjs
```

The second command serves only the existing static build on localhost:8897 and intercepts SDK collection locally. It has no backend, credentials, provider navigation or account mutations; it aborts all external requests. It covers decline/reload, opt-in page/error requests and exact property keys, identity removal on withdrawal, reconsent with a new ID, pending-delivery and failed-request withdrawal, DNT/GPC overriding stored consent, blocked storage and collector failure. Results go to `output/playwright/web-telemetry/verification.json`. This is installed-SDK behavior, **not** proof of hosted ingestion. The existing account acceptance script separately covers coarse account outcomes against its isolated local backend.

Rebuild with `EXPO_NO_DOTENV=1 npm run build:web` afterward. With no production key this must remain disabled. Before enabling hosted capture, inspect the exact deployed bundle and record its Pages deployment ID, commit, bundle hash and settings; rollback means removing the production key and rebuilding the reviewed source, or rolling back to the recorded prior deployment. Never deploy a synthetic token or localhost collector.

### Small PostHog dashboard

The saved [Puptime website dashboard](https://eu.posthog.com/project/312576/dashboard/1038801) contains four insights with a seven-day range and daily intervals. Public sharing is off. The organization has one owner and no pending invites; no additional access was granted. Object-level permissions require a paid add-on and were not enabled.

| Tile | Query | Decision |
| --- | --- | --- |
| Readership | `website_page_view` total, breakdown `page` | Which guides are read? |
| Source conversion | Funnel: `website_page_view` → `website_cta` with `destination=source`, same anonymous browser, 1-hour window | Do visits lead to source-code interest? Opt-in visitors only; do not interpret as all-traffic conversion. |
| Account outcomes | `website_account` total, breakdown `action` and `result` | Which account actions fail or are cancelled? Export `started` means dispatch, not download completion. |
| Browser failures | `website_error` total, breakdown `error_kind` | Are coarse failure counts increasing? No raw error contents or stacks. |

Do not add user identification, raw event exports, person profiles, replay, AI integrations or a public dashboard. Inspect organization members/project access, EU region, retention, payment-method absence, and free usage cap in the service before setting the build key. PostHog’s [published free tier](https://posthog.com/pricing) currently lists one project, one-year retention and 1 million product-analytics events/month; the actual dedicated organization’s state must still be checked. Do not attach a card, upgrade or accept overage. A service-side ingestion transformation/access check remains necessary because SDK settings alone do not prove project-wide privacy configuration.

### Production activation — October 20, 2026

PR [117](https://github.com/patrickchin/puptime/pull/117) merged the consent hardening at `3c9fceaa55c0d592a8c39bfb47a58f44c21e659b`. After setting the dedicated production variables, the reviewed source was rebuilt as Pages deployment `fa5f6a78-440a-4e08-b9a9-5df24c548523`. Both its immutable URL and `https://puptime.pages.dev` served `index-a2fad4494700b7e63e154fae0b7ecf89.js`, SHA-256 `b3b870aa08b6e50bb3b11e729cfb3dd0d7a63845298f508affd4919288b026a6`, with the dedicated public token, EU collector and hardened transport settings. Later copy-only builds change that bundle hash.

The bounded genuine Chrome incognito journey confirmed no PostHog requests before consent or after decline/reload; opting in produced accepted `POST https://eu.i.posthog.com/e/` requests with no cookies or referrer. Home, a guide, the source link and anonymous Google sign-in start produced actual `website_page_view`, `website_cta` and `website_account` receipts in PostHog Activity. Provider authentication was abandoned before entering credentials; no account was created. Withdrawal and reload again produced no PostHog requests. Firefox Private Browsing sent `Sec-GPC: 1`; the website kept analytics off and disabled Allow, with no PostHog request.

The received account event contained only anonymous SDK IDs/library data, the known `/account` path, `action=sign_in`, `result=started`, privacy flags and delivery metadata. It had `person_mode=propertyless`, no full URL/referrer, account/provider identity, IP/location enrichment or raw error contents. The Persons list showed **0**. Real dashboard data appeared after ingestion delay: guide/page readership, account actions, and one anonymous browser completing the source funnel. This small acceptance sample is not representative traffic or a meaningful conversion rate. The browser-failure tile correctly has no received errors; synthetic failures were tested only locally.

Cloudflare Web Analytics receipt is separately proven in the Puptime-only dashboard: last 24 hours (GMT+8), exclude bots, **1 page view / 1 visit**, page load time **1,079 ms** at the earlier check. It reported insufficient data for detailed charts; do not interpret that sample as representative performance.

The isolated installed-SDK check passed nine scenarios with `posthog-js` 1.438.12, including no cookie/referrer headers, withdrawal of pending and failed requests, and DNT/GPC overriding stored consent. Only the local `/telemetry/e/` collector was used. Web unit checks (9), TypeScript and the 15-page static build passed. DNT, blocked storage, failed delivery and synthetic browser-error cases are local regression evidence; the live checks above are separate service-receipt evidence.

Rollback without a source change: remove the production `EXPO_PUBLIC_POSTHOG_KEY` and rebuild the reviewed source. Alternatively, Pages deployment `e9bb7faf-4d0b-4dc1-9438-a4c0d8e31ea3` contains the same hardened source before the key was present and is the recorded analytics-off rollback artifact. Keep previews free of real analytics configuration.

### Dedicated service configuration — October 20, 2026

The Puptime organization’s free-plan UI confirms **1 project**, **1-year event retention**, and a **1 million product-analytics event monthly billing limit**, equal to its free allocation. The service still offers “add your credit card”; no card, paid plan, add-on or overage was enabled.

The following settings were verified in this organization/project before production ingestion:

- Third-party AI services off; internal AI training off; Desktop beta terms not accepted.
- Client IP discard on. The default GeoIP transformation is paused; no active transformations or configured destinations forward/enrich the events.
- Web autocapture, web-vitals autocapture, dead-click capture, session replay, console capture, network recording and exception autocapture off. Replay header/body/canvas capture are also off.
- Person last-seen tracking off. The website uses `person_profiles: never` and `$process_person_profile: false` for every accepted event.
- Production has only the two public PostHog build variables above; the preview environment has neither variable. The existing API service binding was not changed.

Saved insight IDs: readership `QTguqrZu`, failures `gfbhDWeZ`, account outcomes `ZEtYIZ5x`, and source conversion `twGTZUGC`. The account tile separates results into series and breaks down by action; the funnel uses a one-hour sequential conversion window. Empty charts or onboarding sample data are not hosted-ingestion proof.
