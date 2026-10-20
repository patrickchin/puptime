# Review videos

[Open the local gallery](http://127.0.0.1:8877/). The default view says **Current footage pending** while the updated cloud-development journeys are qualified. It shows no earlier-build videos as current.

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

The catalog's `journeys` list is intentionally empty until qualified current clips are supplied. `historical_journeys` retains the six earlier entries and two companions. The collapsed archive contains all 172 recordings and 191 searchable text checks: eight clips in historical review and 164 other app captures. Deep links open their enclosing disclosures automatically. No media, sidecar, log, screenshot or chapter data was deleted or rewritten.

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
