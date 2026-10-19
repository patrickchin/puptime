# Review videos

Start in the [local gallery](http://127.0.0.1:8877/) with live account setup
260, confirmed returning-puppy restoration and first log 263, and incoming sync
without refresh 267. Private code entry is omitted. Google clips 275/276 show
its configured native handoff and safe cancellation; they do not claim a
completed Google sign-in. Text checks 273/277 verify configuration and unchanged
local data. Clip 279 views both optional Connect controls on the retained live
account with three logs and Up to date. Text checks 278/291/292 verify both
configured provider starts and unchanged account data before launch and after
viewing; 293 validates the private Apple signing material without exposing it.
These records do not claim a completed provider sign-in. Failed check 290 retains
the corrected OS-container-path assumption as diagnostic evidence.

Later record 298 now qualifies a completed real Google sign-in through the
installed SDK and deployed service. Private provider interaction was not
recorded. The standalone cold restart waits for both cloud choices to be enabled;
294 preserves all 13 data tables, with only the account-to-cloud setup checkpoint
changing, 295 reads one genuine Google user/session from deployed D1, and 299
compares all 14 tables to the signed-in baseline. No trial, enrollment, upload or
linking occurs. The weaker 296 presence-only capture remains previous evidence
with its transient loading frame acknowledged.

Apple record 320 now passes the same enabled-controls cold restart after genuine
Sign in with Apple and approved Hide My Email. Its private provider phase is
omitted. Checks 321/322 preserve local data before and after restart; deployed D1
readback 323 verifies two distinct real Apple/Google users and sessions, including
the Apple relay identity, with zero trial/cloud accounts and no implicit linking.

Web recordings 306/309/310/313/314/315 cover local account layouts, lost deletion
replies, explicit deletion, in-flight reload, recovery and changed-owner export
refusal. Their synthetic local accounts omit private code entry. The displayed
Google-connected export fixture is seeded locally, not completed Google login.
The full 16-case browser matrix predates the final two bounded fixes; 316 and 319
retain the focused stale-tab and mature-cookie regressions. Record 317 verifies
the frozen source/build/media hashes and links the reviewed desktop, phone,
dark-mode and marketing screenshots. It retains the source manifest's final
83 Workers/8 web tests, all types and build results without rerunning them.
PR104 at `650e73d` is awaiting CI/review; this evidence makes no live web
deployment, provider delivery or telemetry-ingestion claim.

History clips 280/283 cover real SDK cloud paging and stale confirmation on the
preserved local-backed account. The saved offline restoration in 284 is verified
without replay in `284-owned-history-saved-restore-verified`. Earlier partial
failures remain diagnostic captures. Small standalone appearance is qualified across the three 285 captures; 288
verifies the preserved completed account. The later confirmation scroll correction has a real maximum-text RED and
three-language GREEN in 285-confirmation-scroll-context-*; the owned Debug
observer separately preserves all tables and 199 other row render counts.
Integrated standalone local history and all 13 configured flows now pass in 289.
The final spoken-row-label correction has its own actual native RED→GREEN in 288;
the full suite remains explicitly scoped to its preceding c0c9 build.
Broader service and release gates remain in `docs/cloud-verification.md`.

Record actual iOS journeys as acceptance evidence, with the test logs alongside
them. Keep terminal-only checks as searchable text; do not render terminal output
as videos. Give app journeys separate chapters or clips for review.

Use the worktree's dedicated simulator and synthetic data. The repository's
`scripts/record-ios-review.py` wraps an actual test command with `simctl`
recording, preserves its exit status/log, and adds a scope/result caption below
the app. It requires Python with Pillow and ffmpeg/ffprobe. On this host the bundled
Python is `/Users/patchin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`;
the system Python lacks Pillow. No app dependency is added. Use a fresh output filename on every run; failed recordings remain
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

History records168–183 retain the data-layer test output. Expected REDs168/171/179/180 remain labelled as such;181 and183 pass, while182 retains its type failure after successful Node/Workers tests.183 qualifies317 Node/54 Workers/all types. Native recording224 now passes the child Debug local matrix: exact editor draft before entry, bounded version paging, confirmation Cancel, stale/write failures with retry, one explicit restoration and deleted-log recovery.225/226 pass the separate local/deployed HTTP matrix with synthetic administrative identities; neither establishes public provider delivery or distributed Release acceptance.

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

The completed-installation qualifier now also prepares a read-only local history
check on the preserved SDK-owned1002-event fixture:

```text
MAESTRO_BIN=/absolute/path/to/maestro node scripts/verify-ios-first-launch-upgrade.mjs D931F2F5-783B-431E-A7B2-AD89A1882600 /absolute/path/Release-iphonesimulator/Puptime.app
```

It never resets or seeds the installation. Before any app action it verifies
the exact 1,002-event fixture, current typed schema, owner and empty outbox, then
hash-verifies a private full DB/WAL/SHM backup. It installs
the supplied default standalone, reaches Settings through the actual drawer,
checks completed setup/replay, and derives a Recent changes entry and local
version from bounded SQL pages. A differing available version opens confirmation
then Cancel; an identical current version returns through Back. It never requests
cloud versions or commits a restoration. Every application table, owner/outbox/
cursor and the actual remote event count must remain unchanged, including after
a failed history interaction. Record `288-owned-update-history-verified` now
passes on bundle4176 with every one of the 14 tables and actual remote count of
1,002 unchanged. This fixture's available selected version is identical, so Back
is verified rather than Cancel; other history journeys cover Cancel. The first
288 tap failure remains diagnostic with identical before/after SQL snapshots.

The small signed standalone passes all six appearance cases across three 285
captures: standard English/light and Spanish/dark in the first, standard Chinese
in the second, and all three maximum-text cases in the final successful capture.
The earlier wrapper failures remain failures: one driver could not bind before
UI actions, and one settled-card tap needed correction. Each read-only journey
compares all tables; language changes use the real picker, preserve prior rows
and retain their genuine preference audit revisions. The original theme,
language and system appearance/text size are restored. Integrated standalone
local acceptance now passes 289 on bundle `c0c9c656…`, including the actual CI
runner on a newly created simulator. Its inspected screenshots and 14 chapters
cover draft/save, paging/Cancel, stale and failed writes, one explicit restoration
and deleted-log recovery. Record `289-history-default-standalone-regression-final`
passes all 13 configured flows in 13m8s, including complete first-open setup,
practice/replay and the qualified notification preference. Its 13 seek chapters
use actual command timestamps. Earlier 11/13 and 12/13 runs retain their failures;
settled profile/step-guarded walkthrough helpers fix only missed test taps.

The child was safely restacked onto merged PR103 (`5d306f`); all 36 pending files
and the committed history patch were preserved exactly. Integrated code checks
pass 348 Node/77 Workers tests and all types. The fresh signed default bundle is
`c0c9c656d3cdb6cf23f314a83a80b8d1d1853da75b269b88f70e7d9d3d79a296`
(5,530,442 bytes), with no qualification hooks or local endpoint. The history
component is byte-identical to the earlier maximum-text/owned-row qualification.
The human intentionally deleted the older D931/C712/small/6B simulators. No old
UUID was recreated. Prior 288 in-place upgrade evidence remains historical to
bundle4176. The final candidate has independent backup-restored qualification:
`288-backup-restored-owned-history-verified` copies the untouched raw DB/WAL/SHM
into a fresh task fixture, then verifies 1,002 logs and all 14 tables through
read-only Recent changes, local version selection and Back. The original three
raw hashes remain exact. It does not restore an SDK session or claim an original-
device in-place upgrade. Its failed initial Settings tap remains diagnostic; the
same fixture passes the settled retry without recopying or reseeding.

Whole-slice product review found a spoken-label omission: date/change details
suppressed the visible event name and note. Actual c0c9 native hierarchy reproduces
that RED. The shared row now reuses its visible localized event/custom label and
note in the accessibility label, with no layout/storage/navigation change. The
replacement signed default bundle is
`f0a8356ccb7902e62d1e30b11f3534dcd3220aa19fa67480545f9a16366a9d93`
(5,530,514 bytes). Base/iOS types and
`288-history-accessibility-label-green-verified` pass actual Recent changes and
local-version label assertions, detail/Back and all-table preservation on the
same 1,002-log fixture. Text record288-history-accessibility-observed retains the
exact native labels. The preceding c0c9 app is fully preserved; its full13/local
results are not relabelled as reruns on f0a8. A stale CoreSimulator bundle-path
preflight failure remains diagnostic; bounded read-only resolution passed before
the successful launch.

The reusable backup qualifier refuses existing data by default. An explicit
`PUPTIME_HISTORY_BACKUP_RESUME` may name a prior private evidence directory only
when its before/after tables equal the raw snapshot, original manifest matches
and its retained Maestro log pins the same new fixture UUID. It never recopies
data in resume mode. `PUPTIME_HISTORY_ACCESSIBILITY=1` also checks spoken event
and note labels on a retained version. The original exact-D931 verifier guard
remains unchanged. Exact-head PR CI and integration still follow this milestone.
