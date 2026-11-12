# English App Store presence

Prepared October 27–28 and refreshed November 12, 2026 after rebasing onto
`fb092d8`. These are candidate assets for Puptime 1.12.0, not a published listing
or evidence of Apple approval. The broader localization work is deferred at the
owner's request. During the October preparation, App Store Connect required
sign-in and Apple's
US public lookup returned no record for 6813823575. Neither observation has been
rechecked in this refresh; neither establishes availability in other storefronts.

## Ready to review

| Item | Candidate |
| --- | --- |
| Name | Puptime: Puppy Potty Tracker (28 characters) |
| Subtitle | Meals, routines & reminders (27 characters) |
| Keywords | 92 characters; relevant terms, no repeats from name/subtitle/categories |
| Description | Leads with remembering the last potty break; retains offline, cloud, CSV, and dictation distinctions |
| Promo text | 129 characters; a concrete reason to download |
| Categories | Lifestyle / Utilities, retained because they fit the current product |
| Icon | Existing 1024 × 1024 opaque PNG; retain the paw/clock identity |
| iPhone screenshots | Six opaque 1206 × 2622 PNGs in `fastlane/screenshots/en-US/` |
| iPad screenshots | Six opaque 2064 × 2752 PNGs in the same folder; actual tablet layout |
| App preview | `fastlane/previews/en-US/iPhone-6.3-preview.mp4`, 17.37 seconds, 886 × 1920, 30 fps |
| Poster frame | `fastlane/previews/en-US/poster.jpg`; select 7 seconds in Connect |
| Optional header | `fastlane/creative-assets/en-US/header.png`, 3840 × 1646 |
| Optional search art | `fastlane/creative-assets/en-US/search.png`, 1920 × 1280 |

The first three screenshots show quick logging, weekly patterns, and frequency.
The rest cover routines, editing, and dark mode. Each caption describes the
visible feature. The old widget-only upload asset was removed because it did
not represent the current screen sequence. Current widget footage can be added
after verifying the exact release's extension on a device.

The preview shows a quick log, a 15-minute correction, timeline filtering and
log details, insights, and a routine-window adjustment. Five green touch cues
give viewers 0.6 seconds to locate each control before the press, then release
in a fading ripple. They follow recorded control bounds and native footage.
These are editorial overlays. This candidate predates the native motion changes
described below and has not been replaced with a recording of them. Interaction footage
is slowed selectively, idle waits are removed, and 0.2-second dissolves connect
screens. Results remain visible long enough to read without adding frozen-frame
padding. Numbered step labels slide in and fade out below the status bar at each
screen change, giving the next action context without pausing the footage.
They stay clear of the tap targets. It uses
H.264 High Level 4.0, a 10 Mbps encoder target, yuv420p, and silent 48 kHz stereo
AAC. It works with audio muted. Only local features appear, so it does not
suggest that cloud access is included. An iPad preview is optional and has not
been produced; iPad screenshots are supplied.

The native capture flow passed on dedicated iPhone 17 and iPad Pro 13-inch (M4)
simulators running iOS 26.5. `fastlane/capture-provenance.json` records the source
revision, native host, bundle hash, and data provenance. Each device starts
with the owner’s 338 CSV records from September 11 through October 11, 2026.
Original timestamps, types, durations, app/widget sources, and duplicate
timestamps are preserved. Personal notes are omitted. The CSV remains local
and unchanged. Screenshot capture adds no activities; the video adds and edits
one demonstration activity. Routines are suggested by the app from that history.
The status bar is standardized to 9:41. An ignored capture-only entry point
anchors the app clock at October 11, 13:10 in Asia/Shanghai, so the final recorded
day appears as Today. The release entry point is unchanged.

The native runtime was an existing 1.12.0 simulator host with a fresh production
JavaScript bundle from this worktree. The captures are not a qualification of
the uploaded App Store binary. Reconcile them with that exact build before
submission and retake any changed screens.

## App animations and recording

The app already animated the navigation drawer, theme picker, and some account
and sharing presentations. The log and routine editors and timeline details
previously appeared instantly, and changing the main screen swapped content
immediately. A screen recording captures animations that the app actually runs;
the old preview's tap rings, numbered labels, and dissolves were added in editing.

`src/components/Motion.tsx` now supplies a shared sheet presentation for the log
editor, routine editor/suggestions, timeline details, and theme picker. The
sheet slides up over 280 ms and dismisses over 220 ms while a stationary backdrop
fades independently. React Native's native driver runs the motion without
per-frame React renders. The underlying `Modal` portal deliberately uses
`animationType="none"` so its full-screen backdrop does not slide with the sheet.
Dismissal retains the visible form values until the sheet exits. Main screen
changes fade in over 180 ms without adding keyed remounts. System Reduce Motion
disables these effects; the existing drawer uses the same preference hook.
No new animation dependency is needed.

The final iPhone verification used the dedicated task simulator, existing native
host, fresh production JavaScript, and the populated CSV fixture. Log editing,
timeline details, routine editing, keyboard dismissal, and system Reduce Motion
passed. The diagnostic bundle's observers verified that opening/closing the
editor left all 24 loaded event-row render counts unchanged. Three timeline detail
checks left all 19 date labels and 19 tracks unchanged and retained one list
instance; local reports are kept in
`output/app-store/`. All 338 original records and the source CSV remain intact.
Android type checking passed; Android runtime parity is assumed, not verified.
The 510 unit tests, 10 web checks, and store asset validation passed.

Fresh settled screenshots, animation phase frames, and a 7.2-second example are
under `~/Pictures/Screenshots/Codex/puptime-app-store/20261112/native-app-motion-v2/`.
`puptime-native-motion.mp4` contains three trimmed native interactions at normal
speed, without added transitions, labels, tap rings, or motion interpolation.
The earlier `native-app-motion/` experiment is superseded because its backdrop
moved with the sheet. These local examples demonstrate app behavior; they do
not qualify an uploaded release binary or replace the App Store candidate.

Some simulator H.264 recordings have monotonic original presentation timestamps
but incorrect decoder `best_effort_timestamp_time` values, including backward
jumps. `scripts/video_timing.py` now restores the original presentation clock
before the preview editor normalizes frame rate and trims scenes. This preserves
captured motion instead of dropping frames at those jumps. It does not synthesize
animation. Reviewed source cut/tap times must use the original presentation
clock; re-review older cut JSON before using it with the corrected editor. The
committed 17.37-second candidate has not been regenerated with this fix.

For a read-only native animation capture on the seeded task simulator:

```sh
python3 scripts/record-store-preview.py IPHONE_UDID NEW_CAPTURE_DIRECTORY fastlane/app-motion.yaml
```

## Upload and release

1. Complete the existing release gates in `fastlane/README.md` and
   `docs/cloud-verification.md`, including the exact build, review access,
   privacy disclosures, cloud availability, and any purchase behavior. Check
   that every listing claim matches what a new customer can actually use.
2. Sign in to App Store Connect and inspect the existing draft before changing
   it. Confirm its current version, primary language, available countries, app
   price, privacy answers, support details, and existing approved assets.
3. Run `npm run check:app-store`. With the existing API-key environment variables
   configured, `fastlane ios metadata` uploads candidate text and screenshots
   and leaves automatic release off. The metadata lane does **not** upload the
   preview or creative artwork. `overwrite_screenshots` remains false; inspect
   the remote media set and remove superseded images in the draft deliberately
   so an old widget image cannot remain first.
4. In the draft's English Product Page Information, add the preview to the
   matching iPhone display slot. Choose the poster at 7 seconds and check
   processing succeeds. Use Apple's current display labels; the local file's
   `6.3` name describes the capture, not an API display-type identifier.
5. Add the optional header/search images under Header and Search Results.
   These are separate creative assets for iOS/iPadOS 27 and later. Preview their
   crop on iPhone and iPad in Connect; local dimension checks cannot validate
   Apple's placement masks. They do not replace screenshots or the preview.
6. Check the screenshot sequence and preview in Connect's device preview. Confirm
   the correct locale, tablet display slot, legibility, and absence of duplicates.
   Apple currently lists medium Dynamic Island iPhone and 13-inch iPad as the
   required screenshot sizes. If upload tooling lags behind Apple's display
   types, use Connect's native asset wells instead of resizing a tablet image
   into a phone slot.
7. Submit the verified build and metadata through the existing release process.
   Record the App Review result and release state. An upload or processing
   success alone is not a published release.

The marketing, support, and privacy URLs returned HTTP 200 during preparation.
The privacy and support destinations must still be reviewed as a customer would
use them; a successful HTTP response does not validate their contents.

## Measure and improve after the listing is available

| Work | Concrete next action | Current state |
| --- | --- | --- |
| Baseline | Export the preceding 28 days of impressions, product page views, first-time downloads, and Apple's conversion metric by territory and acquisition source. Record listing/build changes. | Needs Connect access and sufficient traffic |
| Keywords | Compare search-origin downloads and relevant query evidence; change terms in a subsequent version. | Initial intent-based terms prepared; search volumes/ranks unverified |
| Product page optimization | Test one treatment: same screenshots, with versus without this preview. Use Apple's duration estimate and confidence report; keep other material changes stable. | Experiment design prepared; no live test created |
| Custom product page | Draft a potty-training page with shots 1, 2, 3 first, and promo: “Keep potty breaks and meals in one place while you learn your puppy’s routine.” Share its own campaign URL once approved. | Draft brief; needs actual acquisition campaign and Connect setup |
| Ratings | Add the native StoreKit review prompt through the framework's supported integration after established use, at a calm point after a completed action. Honor platform limits, avoid interruption, incentives, and sentiment screening. | Requires app implementation and native verification |
| Review responses | Read actual reviews, triage recurring problems, draft specific replies, and obtain authorization before sending replies. | Needs existing reviews and explicit messaging authorization |
| Featuring | Nominate the verified launch/significant update with the draft below and an actual release date. | Draft prepared; not submitted |
| Accessibility labels | Validate each supported accessibility feature on the exact release before declaring it in Connect. | Separate device/accessibility audit needed |
| In-App Events | Use only for a real time-limited event or substantial launch that qualifies under Apple's rules. | No qualifying event identified |
| Promoted purchases | Add only for implemented, verified products with approved pricing and accurate purchase media. | Existing cloud/purchase release gates remain |
| Paid acquisition | Consider Apple Ads only after conversion and retention can be assessed. | Budget and campaign are unspecified |
| Localization | Use territorial demand to prioritize translated UI, metadata, screenshots, and support. | Deferred; English first |

For the first experiment, use one control and one treatment rather than several
simultaneous variants. Estimate duration with Connect's actual traffic. Apple
allows tests up to 90 days; low traffic may not yield a conclusion. Record the
test ID, traffic allocation, locale, assets, start/end dates, and Apple's reported
confidence. Do not claim a win from a small raw percentage difference.

Featuring nomination draft:

> Puptime helps new puppy owners remember the last potty break and learn a daily
> routine. Owners can log an activity in a tap, compare days on a timeline, and
> choose reminders. Local logging works offline without an account. iPhone and
> iPad layouts, Home Screen quick logging, and dark mode support everyday use.
> This release adds [verified release-specific improvement]. Planned release:
> [confirmed date].

Replace both placeholders from release evidence before submission. Apple asks
for at least two weeks' notice for featuring consideration; selection is
editorial and not guaranteed.

## Reproduce the assets

Use fresh task-owned simulators with the names in the provenance file. Install a
matching native host without launching it, then seed its fresh data container.
The seeder generates the ignored `output/app-store/capture-entry.js` from the
CSV, with an anchor ten minutes after its latest timestamp. Export a production
bundle from that entry into a copy of the host, re-sign it, and install the copy
over the same task-owned app without removing its seeded data. Keep the CSV,
database and capture build outside Git. Never overwrite another simulator's
database. `scripts/seed-app-store.mjs` checks the device name and refuses an
existing database.

```sh
TZ=Asia/Shanghai node scripts/seed-app-store.mjs IPHONE_UDID /path/to/owner-activity.csv
TZ=Asia/Shanghai node scripts/seed-app-store.mjs IPAD_UDID /path/to/owner-activity.csv
maestro --device IPHONE_UDID test fastlane/capture.yaml --test-output-dir "$HOME/Pictures/Screenshots/Codex/puptime-app-store/new-iphone-stills"
python3 scripts/record-store-preview.py IPHONE_UDID "$HOME/Pictures/Screenshots/Codex/puptime-app-store/new-iphone"
maestro --device IPAD_UDID test fastlane/capture.yaml --test-output-dir "$HOME/Pictures/Screenshots/Codex/puptime-app-store/new-ipad"
python3 scripts/edit-store-preview.py "$HOME/Pictures/Screenshots/Codex/puptime-app-store/new-iphone/recording.json"
```

Python asset scripts require Pillow; video scripts also require ffmpeg/ffprobe.
For screenshot composition, collect one run's `takeScreenshot` directory beneath
each `CAPTURE_ROOT/iphone/` and `CAPTURE_ROOT/ipad/`, then run:

```sh
python3 scripts/render-store-screenshots.py CAPTURE_ROOT
npm run check:app-store
```

The renderer writes upload files and their SHA-256 manifest to `fastlane/`, and
a contact sheet beside the source captures. Inspect every image and the final
video after generation. The editor verifies each settled screen before its
outgoing dissolve against the captured UI; review the action and transitions
visually too.
For a tighter edit, add `reviewed_cuts` to the local recording JSON: an ordered
list of `{screen, raw_start, raw_end}` objects matching the six scene names in
the editor. Use actual native footage ranges that omit loading and drawer waits.
A cut may also specify `raw` to use a separately retaken native scene. The final
scene ranges and recording names are recorded in the committed `edit.json`.
Use `segments: [{raw_start, raw_end, speed}, ...]` to remove idle intervals and
slow actual interactions; speed must be greater than zero and at most one.
Add `taps` to each reviewed cut for visible interactions: a list of
`{raw_at, x, y, control}` objects. Time is in source-video seconds; coordinates
are pixels in the 886 × 1920 export. Use the recorder's control bounds and review
the corresponding native frames to align each pulse. Omit taps removed by the
edit. The editor maps taps through the source segments and dissolves, renders
1.2-second aim/press/release cues, and records their final timings in `edit.json`.
The editor also animates a short numbered label for each scene and records its
title, timing, and sequence in `step_labels`. The seven-second poster is clear
of touch indicators.
Original captures for this pass remain under
`~/Pictures/Screenshots/Codex/puptime-app-store/`. The current native video source and timing JSON are in the `20261112/preview/`
subdirectory; the retaken ending is in `20261112/routine-ending-v3/`. The earlier
CSV-based media is retained in `real-history/`. Earlier synthetic captures remain local historical evidence and
are superseded by this CSV-based set.

## Later localization

Follow the user's preferred app/device language with an explicit in-app choice.
Storefront country controls commerce and availability and is not a reliable
language preference. A language and a formatting locale are separate choices.
Localization also covers date/time formats, time zones, number formats, plural
rules, long text, right-to-left layout, search vocabulary, screenshots, support,
and regional availability/pricing. Prioritize languages using actual market
demand, then verify the whole experience. No locale-selection code changes are
included in this asset pass.

## Apple sources checked October 27, 2026

- [Search and keywords](https://developer.apple.com/app-store/search/)
- [Product page](https://developer.apple.com/app-store/product-page/)
- [Asset best practices](https://developer.apple.com/app-store/asset-best-practices/)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [App previews](https://developer.apple.com/app-store/app-previews/)
- [Preview specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications/)
- [Creative assets](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications)
- [Product page optimization](https://developer.apple.com/app-store/product-page-optimization/)
- [Custom product pages](https://developer.apple.com/app-store/custom-product-pages/)
- [Ratings and reviews](https://developer.apple.com/app-store/ratings-and-reviews/)
- [Featuring](https://developer.apple.com/app-store/getting-featured/)
