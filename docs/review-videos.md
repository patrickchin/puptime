# Review videos

Current review: [local gallery](http://127.0.0.1:8877/) opens on recording195, the uninterrupted first-open Mochi setup through the first real log and timed reminder. Recordings191/194 cover full setup appearance and recovery;188/206 cover drawer, permissions and reminder/accessibility states;198/199 cover populated rendering and owned-data preservation;222 covers the actual OS Reduce Motion drawer variants. Recording209 is the final full regression, and215 is searchable full code-check output. Current evidence and remaining integration gates are recorded in `docs/cloud-verification.md`.

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

History recordings168–183 currently show data-layer test output, not a native history UI. Expected REDs168/171/179/180 remain labelled as such. Focused181 and full final183 pass;182 stops on type errors after its Node/Workers tests pass. Task183 qualifies317 Node/54 Workers/all types. Native history journeys and deployed qualification follow in the history plan's remaining tasks.

Build and serve the local gallery with the standard-library helpers:

```text
python3 scripts/build-review-gallery.py /absolute/path/puptime-review-videos
python3 scripts/serve-review-gallery.py /absolute/path/puptime-review-videos --port 8877
```

Use the range-aware server above rather than `python -m http.server`: partial
responses (`206`, `Content-Range`, `Accept-Ranges: bytes`) let browser video
controls seek before the entire recording downloads. Current app journeys appear
first. Earlier captures remain collapsed, and old terminal-replay metadata is
presented as readable, searchable logs. Existing deep links are preserved.

Run `python3 scripts/check-review-gallery.py` to verify byte ranges, HEAD, error
bounds, text-only recorder status, and escaped log rendering.
