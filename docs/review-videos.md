# Review videos

[Open the local iOS video gallery](http://127.0.0.1:8877/). Five root-reviewed current core journeys are available:

| Clip | Demonstrated journey | Scope |
| --- | --- | --- |
| 360 | Full setup, optional local choice, practice, first real log and timed reminder | Public Pages API configured; no owner or queued upload |
| 361 | Actual SDK email-code sign-in with a synthetic address against the local API, retained local log, explicit upload and cold restart | Local HTTP proxy/API; SQL equality excludes OS-timer state |
| 364 | Explicit fresh-device restore and incoming peer edit | Local HTTP proxy/API; private code entry omitted |
| 365 | Original queued log survives offline cold restart and reconnects automatically | Fixed0472307 JS, reused157-file Debug shell, local HTTP proxy8794→8793; no Retry or foreground before SQL proof |
| 366 | Populated history, Cancel and exactly one confirmed restore | Account-free prepared fixture with 1,001 local logs; Node-minted fixture IDs do not establish Hermes generation |

Clips360/361/364/366 use exact frozen `ad54af8` shared core source in a reused qualified Debug shell. Clip365 uses the fixed `0472307` JavaScript in that qualified shell against the local HTTP proxy/API. These are not fresh Release builds. Capture 360 omits only `clearState` after fresh-data proof to retain its separate Metro binding. Original sidecars carry the precise provenance. A later separate UI/Expo timer readback must not be folded into clip 361’s SQL equality claim.

One entry remains pending: actual native Apple/Google SDK post-auth sign-in and restart qualification. The older browser-SDK Google capture363 remains historical. Clip365 retains the original failedad54 operation through the fixed run; the original failure is retained separately. Its automatic-upload SQL proof precedes all UI inspection and includes one accepted original operation, revision1, exact echo, empty outbox and15 unchanged unrelated records.

The former six-entry selection and its two companions remain under **Archive → Historical review**, collapsed by default:

| Review entry | Existing evidence | Scope |
| --- | --- | --- |
| First open | 195; optional companion 260 | Profile, optional account, contextual reminders, first real log. 195 is an earlier cloud-disabled Release build; 260 shows the deployed email request, with private code entry omitted. |
| Everyday use | 188 | Drawer and timed reminder walkthrough after setup; earlier Release build. |
| Google restart | 298 | Genuine deployed session and ready controls after cold restart; private OAuth omitted. |
| Apple restart | 320 | Genuine deployed relay session and ready controls after cold restart; private sign-in omitted. |
| Cloud restore and incoming sync | 263; optional companion 267 | Explicit puppy restore, log and reopen; genuine peer update without refresh. |
| Offline recovery | 07 | Earlier Debug build, isolated local HTTP outage, durable log and reconnect. |

These are historical development captures. They include cloud-unavailable setup, a 14-day trial offer in the Apple/Google restart clips, and older platform-specific copy. They do not establish the current optional-account, explicit-upload, trial-free development contract. Dates, recorded-rerun labels, original build/service scopes, diagnostic notes and results stay visible.

The catalog's `journeys` list contains only supplied, qualified clips. `pending_journeys` lists the remaining native-provider slot without recording references. `historical_journeys` retains the six earlier entries and two companions; other unselected captures and searchable technical checks remain archived. Deep links open their enclosing disclosures automatically. No original media, sidecar, log, screenshot or chapter data was deleted or rewritten.

`scripts/build-review-gallery.py` reads the checked-in `docs/review-gallery-catalog.json`: current/historical selection, descriptions, original review notes and service-evidence links. This replaces the frozen e9 builder plus ordered runtime overrides previously used to publish the gallery. The source builder and catalog reproduce the displayed page from the existing evidence directory; editing the artifact directory's legacy `build-index.py` is unnecessary. New unselected captures go into the archive. Current evidence and remaining development checks are recorded in `docs/cloud-development.md`. `docs/cloud-verification.md` is the historical ledger.

Record actual iOS journeys as acceptance evidence, with the test logs alongside
them. Keep terminal-only checks as searchable text; do not render terminal output
as videos. Give app journeys separate chapters or clips for review.

Use the worktree's dedicated simulator and synthetic data. The repository's
`scripts/record-ios-review.py` wraps an actual test command with `simctl`
recording, preserves its exit status/log, and adds a scope/result caption below
the app. It requires Python with Pillow and ffmpeg/ffprobe. No app dependency is
added. Use a fresh output filename on every run; failed recordings remain
failures. JSON sidecars identify scope, result and chapter timestamps.

```text
python scripts/record-ios-review.py UDID /absolute/path/review.mp4 \
  "Routine edits and deletion" \
  "iOS Debug · local SQLite second writer · synthetic data" -- \
  node scripts/verify-ios-routine-concurrency.mjs UDID
```

Store videos outside the worktree so archiving it cannot remove review evidence.
Link the video index in the acceptance report and embed representative MP4s.
Existing test runs recorded again must be labelled **recorded rerun**. Label
Debug/Release, local/staging, direct SQLite projections and administrative
sessions accurately; recordings do not extend what the test actually proves.

Never record an authentication code, password, token, private callback URL or
real user data. This wrapper is only for journeys that do not show credentials.
Record authentication journeys in separate safe segments, with credential entry
omitted and explicitly labelled. Do not make product footage with generative
video tools. Console-only service checks use `scripts/record-test-review.py OUTPUT.log TITLE
SCOPE -- COMMAND...`. It preserves the actual exit status and writes a `.log`
plus evidence `.json`, without generating a video. Legacy `.mp4` output arguments
also produce text only.

Android remains deferred until the user explicitly resumes it.

The gallery distinguishes complete first-open onboarding (welcome, puppy profile, optional account/cloud, contextual device permissions and first real log) from feature-walkthrough replay. Keep full setup and returning-account restore clips prominent; a tour-only clip must not stand in for onboarding evidence. Theme/language/accessibility runs use the same complete flow, with exact SQL checks for one puppy, no practice activity and no implicit enrollment/upload.

CI-result replays must identify the original run and distinguish reading its retained results from executing tests again. The original PR99 result report178 shows10/11 flows passing; Settings recordings174/175 pass the original flow locally and176 passes its bottom-target centering correction with all visibility/persistence assertions retained. Recording167 is an interrupted status observation, not a test-run conclusion. Qualifying a replacement commit still requires its own complete CI result.

Historical recordings168–183 show data-layer test output, not a native history UI. Expected REDs168/171/179/180 remain labelled as such. Focused181 and full final183 pass;182 stops on type errors after its Node/Workers tests pass. Task183 qualifies317 Node/54 Workers/all types. These historical results retain their original scope; later native history journeys are available in the archive.

Build and serve the local gallery with the standard-library helpers:

```text
python3 scripts/build-review-gallery.py /absolute/path/puptime-review-videos
python3 scripts/serve-review-gallery.py /absolute/path/puptime-review-videos --port 8877
```

Use the range-aware server above rather than `python -m http.server`: partial
responses (`206`, `Content-Range`, `Accept-Ranges: bytes`) let browser video
controls seek before the entire recording downloads. Qualified current app journeys appear
first when available; otherwise the pending state is shown. Other captures and technical logs remain in the collapsed archive, and old terminal-replay metadata is
presented as readable, searchable logs. Existing deep links are preserved.

Run `python3 scripts/check-review-gallery.py` to verify byte ranges, HEAD, error
bounds, text-only recorder status, escaped log rendering, selection/companion placement, collapsed archive structure, provenance and deterministic output.
