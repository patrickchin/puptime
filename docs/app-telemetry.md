# Native product telemetry

The iOS/Android app uses the official `posthog-react-native` SDK with explicit events and a final outbound property allowlist. Website telemetry keeps its existing separate consent and vocabulary. Native telemetry is off until a user enables Settings → Help & privacy → Usage analytics. No account is required. There is no session replay, text inspection, coordinate capture, user identification, feature flag evaluation or person profile creation.

## Questions and events

| Question | Event / analysis |
| --- | --- |
| Which pages get used most? | `app_screen_view`, broken down by `screen`; compare total visits and unique anonymous IDs. `resumed=true` marks a foreground return, so filter it out for navigation-only visits. |
| Where do people spend time? | Sum `app_screen_time.duration_ms` by `screen`; divide by 60,000 for minutes. Use only these increments for total time, since navigation dwell overlaps them. |
| Which pages are switched between? | `app_navigation`, broken down by `from_screen` and `to_screen`. `duration_ms` is the accumulated foreground dwell before leaving. Low dwell and frequent reversals help identify navigation friction. |
| What controls get used or held? | `app_press`, broken down by `control`; inspect median/p95 `press_duration_ms`. Pointer presses include duration; accessibility activation without a touch includes the action without a fabricated duration. Cancelled touches/scrolls are excluded. |
| What gets logged? | `app_log_action`, broken down by `action`, `activity_type`, `result`. Use successful `create` for newly recorded logs; edits, imports, nap completions and undo are separate so autosave does not inflate creation counts. |
| Are users adding their own log types? | `app_log_action` with `action=custom_activity_create`. Custom usage is aggregated as `activity_type=custom`; labels and note contents are excluded. |
| Are users returning? | `app_foreground`, unique anonymous IDs and session IDs. IDs represent installations, not people or accounts. |

Create a private PostHog dashboard named **Puptime app usage**, using the last 7 or 30 days and filtering `schema_version=1` and `platform` as needed. Add the seven views above. For path analysis, choose `app_screen_view` and its `screen` property. For the core page ranking, exclude `startup`, pickers, editors and other overlays; keep them for interaction analysis. Opening the drawer leaves the current page active until a destination appears, so page-to-page transitions retain their source instead of routing every pair through a navigation screen. The explicit transition event is useful for an ordered transition table without inferring paths from timestamp ordering.

Example HogQL transition query (run in the configured PostHog project):

```sql
SELECT properties.from_screen AS from_screen,
       properties.to_screen AS to_screen,
       count() AS transitions,
       avg(toFloat(properties.duration_ms)) / 1000 AS average_dwell_seconds
FROM events
WHERE event = 'app_navigation' AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY from_screen, to_screen
ORDER BY transitions DESC
```

Interpretation limits: opt-in users are a sample, not the whole user base. Foreground time includes reading/idle time while the screen remains visible; it is not proof of attention. Fifteen-second checkpoints reduce lost time on process termination. Background periods are excluded. Editor/history/guide/widget/backup overlays have separate timing. Native OS sheets and controls without an explicit event are outside capture. Press duration is a touch measurement, not network latency. Widgets/headless tasks, cloud reconciliation, CSV replay and backup restoration do not masquerade as fresh in-app log creations. Custom labels cannot be ranked by meaning because they are never collected.

## Configuration and delivery

Set `EXPO_PUBLIC_APP_POSTHOG_KEY` to a public project token in the **native production build environment**, and `EXPO_PUBLIC_APP_POSTHOG_HOST=https://eu.i.posthog.com`. This can use the existing Puptime project, with `app_*` events kept separate from `website_*`. Never expose a personal API key. The Android APK workflow reads the same-named GitHub repository variables on its release build step; leave them unset for analytics-free builds. Configure the variables in the EAS production environment for iOS builds. Missing key means no SDK initialization or network collection; the setting explains that this build has no analytics. Keep real keys out of preview/test builds. Public env values are embedded at build time, so existing installs need a new binary/update before they can emit these events.

The SDK queues at most 200 events in memory, flushes every 15 seconds or 20 events, and flushes on backgrounding. It retries a failed batch once. The memory queue intentionally trades some delivery during process death for simple withdrawal with no persisted private event backlog. The anonymous ID and choice are stored separately in AsyncStorage. Revocation immediately gates capture and transport, aborts requests, drains discarded batches locally, and retires the SDK instance. Reconsent creates a fresh `ano_…` ID. Transport permits only the configured batch endpoint; remote configuration cannot expand collection.

Before activating production, verify the selected project's EU region, access, retention and existing free usage limits, update Apple App Privacy/Google Play Data Safety disclosures for optional product interaction/usage data and anonymous device identifiers, and confirm a consented release-build event actually appears in PostHog. Requesting `$geoip_disable` in an SDK is not evidence of provider-side retention/region settings. No live dashboard, production key, billing setting or store submission is changed by this PR. Existing website analytics remain as documented in [Website operations](website-operations.md).

## Verification

`npm test` includes deterministic timing, overlay, privacy-boundary and installed native SDK transport checks. The SDK check runs with mocked platform/storage and a local fetch implementation, including compressed batches; it does not claim device or hosted ingestion evidence.

For real Android acceptance, use the task-owned `Puptime_Telemetry_b36b` AVD, a current debuggable APK, and the existing `scripts/native-activity-probe/metro.config.cjs` as the temporary root Metro config. Build/embed with synthetic values only:

```sh
EXPO_NO_DOTENV=1 EXPO_PUBLIC_APP_POSTHOG_KEY=phc_synthetic_app_telemetry EXPO_PUBLIC_APP_POSTHOG_HOST=http://127.0.0.1:8896 EXPO_PUBLIC_CLOUD_API_URL=http://127.0.0.1:8896 npx expo export:embed --entry-file index.ts --platform android --dev false --bundle-output android/app/src/main/assets/index.android.bundle --assets-dest android/app/src/main/res
# Assemble/install that Debug host on the dedicated emulator, then:
node scripts/verify-app-telemetry.mjs emulator-5576 --seed
```

`--seed` replaces **only this disposable emulator's Puptime data** with a 1,000-log synthetic fixture. The script owns localhost port 8896, records actual SDK request bodies, checks no collection before consent/after withdrawal, verifies press duration and bidirectional navigation, checks log create/edit outcomes and private-text exclusion, and asserts unchanged history rows do not redraw when opening/editing a log. Results go to `output/app-telemetry/verification.json`; screenshots go to `~/Pictures/Screenshots/Codex/puptime-telemetry/`. This is local Android acceptance, not hosted PostHog ingestion or an iOS device qualification. Remove the temporary root Metro config and rebuild without synthetic values before any release.

Verified locally on 2026-10-27: all 481 app tests, 9 website tests and 130 server tests passed, along with default/iOS/Android/server typechecks, the website build, iOS bundle export and an Android Debug build. Dedicated Android acceptance received 47 raw synthetic receipts (32 unique event UUIDs; retried batches preserve their UUIDs) and passed consent/withdrawal, press duration, bidirectional navigation, log create/update, and private-content exclusion checks. Opening an editor redrew no history rows; saving its time change redrew exactly one row. Timeline details preserved date rows and unchanged day tracks. Hosted ingestion and iOS runtime behavior remain release qualification work.
