# Website operations

The public origin is `https://puptime.pages.dev`. Cloudflare Pages builds `npm run build:web` and publishes `dist-web` from `main`. Submit changes through a PR. The native entry remains `index.ts`; `index.web.ts` uses Expo Router solely for static website routes.

The `.node-version` file pins the shared Pages/CI runtime. The SEO build script uses Node's native TypeScript support; older Pages defaults such as Node 22.16 cannot execute it.

## Search

The build renders the homepage, care library, and all 13 guides to HTML, including article text, headings, source links, titles, descriptions, canonical URLs, Open Graph/Twitter metadata, and JSON-LD. It generates `/sitemap.xml` and `/robots.txt`. Previously shared `/#puppy-care/...` links redirect in the browser to the corresponding clean URL. A top-level `404.html` prevents nonexistent pages from falling back to a successful homepage response. Preview hosts have `X-Robots-Tag: noindex`.

Run `npm run build:web` to validate rendered metadata and headings for every public page; run `npm run test:web` for metadata and telemetry-boundary checks. Deploy previews should be checked at desktop and mobile widths, including direct guide loads, old hash links, search, back navigation, and audio playback.

The Google Search Console URL-prefix property is `https://puptime.pages.dev/`. Its ownership file is committed under `public/`; keep that file deployed so verification remains valid. After deployment, verify ownership and submit `https://puptime.pages.dev/sitemap.xml`. Inspect the homepage and a guide with URL Inspection. Search Console reports indexing and search queries; adding a sitemap does not guarantee indexing or rankings. If the public domain changes, update `src/web/site.ts`, preview-header host patterns, server allowed origins, and the Search Console property together.

## Cloudflare

Web Analytics is already enabled for the Pages project and automatically injects the beacon on deployment. Do not add a second beacon to application code. Cloudflare's Web Analytics dashboard provides traffic, referrers, page load times, and Core Web Vitals. Verify injection in the deployed HTML and incoming data in the dashboard. PostHog's consent control applies to PostHog separately, as explained in the privacy policy.

## PostHog

Use a dedicated Puptime project in the EU cloud. The existing Harpa Pro organization currently permits one project until billing details are added. No Puptime project/token is configured by this change; it must not send Puptime events into Harpa Pro's existing project.

After the Puptime project is available, set `EXPO_PUBLIC_POSTHOG_KEY` to its public `phc_…` browser token and `EXPO_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com` in the Cloudflare Pages **production** build environment, then rebuild. Do not enable real PostHog capture in previews; use an isolated test project when testing ingestion. The browser token is public; personal API keys must never be exposed through `EXPO_PUBLIC_` variables. Review the project's retention, access, and billing limits before enabling production capture.

Optional PostHog analytics load only after consent and respect Do Not Track/Global Privacy Control. The SDK disables autocapture, automatic page/pageleave events, exception capture, session replay, surveys, feature flags, and person profiles. An outbound allowlist removes SDK-enriched URLs, referrers, campaign values, and arbitrary properties. Only these events are accepted:

| Event | Properties | Use |
| --- | --- | --- |
| `website_page_view` | Known public `page` | Guide readership and entry pages |
| `website_cta` | `page`, `destination`: `android_download` or `source` | Page visit → download/source funnel |
| `website_error` | `page`, `error_kind`: `script`, `unhandled_rejection`, or `render` | Failure counts; no messages, stacks, or private contents |

The SDK also sends anonymous IDs and library metadata. It creates no person profiles, and the app does not identify website visitors. Browser failure events are coarse counts, not full stack-trace error monitoring. Native/API diagnostics and Sentry remain separate cloud-rollout work.

Before calling PostHog live, verify both the browser request and the event visible in PostHog Activity. Test a fresh visitor (no SDK request before choosing), decline, allow, withdrawal, reload persistence, blocked storage, provider/network failure, and privacy signals. Confirm event properties omit query strings, fragments, referrers, search input, notes, and raw error contents. Create a dashboard with page views by `page`, download clicks by `page`, visit-to-download conversion, and error counts by `error_kind`. Do not enable session replay.
