# Review videos

Record new iOS features and meaningful test journeys as part of their acceptance
evidence. Keep the full test logs alongside the recordings. Group repeated unit
cases in a suite recording, and give end-to-end journeys separate chapters or
clips so they can be reviewed individually.

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
video tools. Console-only service checks should show actual captured test output
and the corresponding log, rather than imply that an app screen proves them.

Android remains deferred until the user explicitly resumes it.

The gallery distinguishes complete first-open onboarding (welcome, puppy profile, optional account/cloud, contextual device permissions and first real log) from feature-walkthrough replay. Keep full setup and returning-account restore clips prominent; a tour-only clip must not stand in for onboarding evidence. Theme/language/accessibility runs use the same complete flow, with exact SQL checks for one puppy, no practice activity and no implicit enrollment/upload.

CI-result replays must identify the original run and distinguish reading its retained results from executing tests again. The original PR99 result report178 shows10/11 flows passing; Settings recordings174/175 pass the original flow locally and176 passes its bottom-target centering correction with all visibility/persistence assertions retained. Recording167 is an interrupted status observation, not a test-run conclusion. Qualifying a replacement commit still requires its own complete CI result.

History recordings168–183 currently show data-layer test output, not a native history UI. Expected REDs168/171/179/180 remain labelled as such. Focused181 and full final183 pass;182 stops on type errors after its Node/Workers tests pass. Task183 qualifies317 Node/54 Workers/all types. Native history journeys and deployed qualification follow in the history plan's remaining tasks.
