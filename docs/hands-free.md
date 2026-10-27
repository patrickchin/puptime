# Hands-free assistant

Open the microphone in the app header or **Hands-free** in the navigation menu. Accept the short data-processing explanation, then type a request or start a voice conversation. Voice uses the existing native speech recognizer and Expo Speech for device spoken replies. A voice conversation resumes listening after a reply; stop it with the stop button. Backgrounding or closing the assistant stops speech and recognition and cancels unfinished model requests. Text remains available when microphone permission is denied.

The first version supports:

- Create pee, poop, meal, potty trip, walk, nap, and custom activity logs, including several activities in one request.
- Interpret explicit past/relative times using the request's current time and IANA timezone.
- Attach a note to a new log or edit the time, end time, or note of an identifiable recent log.
- Open Log, Timeline, Insights, Schedule, Notifications, Puppy care, Pets, Settings, or Account.
- Change **Review before saving** through its switch or an explicit assistant request. New logs and edits follow the setting that was active when the request was made. Navigation and an explicit preference change execute immediately.
- Confirm/cancel pending proposals and undo the last saved request, through buttons or simple spoken commands. Undo rejects intervening record changes rather than overwriting them.

The production journal currently opens one dog. The model is given that profile and must ask when another or an ambiguous dog is named. This does not implement the separate multiple-pet design preview. Questions can use the supplied recent records, with an explicit limitation when that context cannot establish an answer. Full-history analysis, routine editing, exports, notification permission changes, account actions, and destructive actions are not assistant commands in this version. The model must explain unsupported requests.

## Server setup

No model credential belongs in Expo public variables or the mobile app. The existing authenticated backend adds:

- `GET /api/assistant/status`: authenticated `{available: boolean}`.
- `POST /api/assistant/plan`: authenticated bounded request context → validated action proposal. This endpoint does not write puppy records or enable sync.

Configure `OPENAI_API_KEY` as a Worker secret and `OPENAI_MODEL` as the deployment's supported Structured Outputs model identifier. Both are required; there is no hardcoded model default. For a private local Wrangler environment, put them in the existing gitignored `.dev.vars` alongside the normal authentication settings. For staging, use Wrangler's secret workflow for the API key and set the model in that environment's configuration. Deploy only through the reviewed repository workflow. The presence of this code does not establish that the hosted server has these settings or this route deployed.

The implementation uses the [OpenAI Responses API Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), `store: false`, a fixed provider endpoint, a 30-second provider timeout, and a 45-second mobile transport timeout. The server rejects unsupported output and incomplete/refused responses. Provider error bodies and credentials are not returned to the app.

Each account is limited to 10 model requests per UTC minute and 200 per UTC day, shared across sessions using its existing Durable Object. A 429 includes `Retry-After: 60`; the daily allowance returns at the next UTC day. Counters contain no prompts or notes. Authentication, trusted-origin checks, request size limits, and account-deletion checks run before model dispatch.

Only supported action schemas reach the executor. Dog IDs, existing event IDs, timestamps, note lengths, and nap bounds are validated again on the device. A command uses an opaque `cmd_…` identity, and created logs use normal `evt_…` IDs. Logs, edits, the confirmation change, sync changes, and the last-operation receipt commit in one local transaction. The receipt deduplicates an immediate retry; after a later saved request it is replaced. Undo verifies all affected records before restoring/deleting any of them and uses the normal backup guard before removing created logs. The preference and receipt are device-local metadata, not synced account settings.

## Verification

Run the normal typechecks and tests, including `npm run typecheck:ios`, `npm run typecheck:android`, and `npm run test:server`. Focused checks live in `src/assistant.test.ts`, `src/local/assistant.test.ts`, and `server/assistant.test.ts`.

`scripts/assistant-fixture.mjs` is a deterministic, loopback-only HTTP fixture for native UI qualification. It is not a model, has no production entry point, and intentionally bypasses authentication so synthetic UI tests can run without credentials. Real session, origin, provider contract, budgets, and zero-cloud-write behavior are tested separately in the Worker suite. `scripts/seed-assistant-fixture.mjs` prepares 1,000 logs only on devices named `Puptime Hands Free …` or `Puptime_Hands_Free_…`; it refuses ordinary user devices.

For native fixture testing, run the fixture on port 8893 and Metro on a dedicated port with `EXPO_PUBLIC_CLOUD_API_URL=http://127.0.0.1:8893` and `EXPO_PUBLIC_CLOUD_ALLOW_LOCAL=1`. Android also needs both ports forwarded with `adb reverse`. These are development settings only. Rebuild native apps after adding Expo Speech or changing microphone permission descriptions. Save screenshots under `~/Pictures/Screenshots/Codex/puptime-hands-free/`.

Live language interpretation, speech accuracy on physical devices, and provider latency need separate testing with a configured model. Synthetic fixture success does not establish model quality or a production rollout.

### Local qualification, October 28, 2026

- Shared, iOS, Android, and server TypeScript checks pass. App/storage, Worker, and website tests pass; public website and both native JavaScript exports build. Both native Debug applications build with Expo Speech linked.
- On the dedicated iOS 26.5 iPhone simulator, the complete synthetic conversation passes: review two logs, confirm, grouped undo, change confirmation mode through the assistant, save a backdated meal immediately, and open Settings. Direct SQLite inspection ends with 1,001 logs (the original 1,000 plus the meal) and the confirmation preference off.
- Android review and grouped save pass with 1,000 existing logs. Direct SQLite inspection confirms the two new `evt_…` records share their backdated timestamp and only the poop has the supplied note. During typing and review, a temporary React DevTools probe observed 66 assistant commits and zero redraws of 144 mounted history rows. The independent 30-second history timer produced its own redraw. The probe was removed afterward.
- Provider responses in these native runs came from the explicit local fixture. No OpenAI key or model is configured in this workspace, and no live model call or hosted deployment was performed. Physical-device microphone accuracy, spoken replies, background interruptions, and accessibility scale still need device qualification before release.
- The branch incorporates the latest opt-in telemetry work. Assistant screen visits and finite static control IDs follow the existing consent setting; requests, transcripts, notes and puppy identities are excluded, including when extra private fields are supplied to the sanitizer. All 494 app tests pass after integration. A final repeated native flow after this integration was blocked by local simulator/automation startup failures (including the computer-use service); the earlier full iPhone run and Android review/save/performance evidence above remain the native qualification boundary.
