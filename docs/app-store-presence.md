# English App Store presence

Prepared October 27, 2026. These are candidate assets for Puptime 1.12.0, not a
published listing or evidence of Apple approval. The broader localization work
is deferred at the owner's request. App Store Connect requires sign-in in the
available browser. Apple's US public lookup returned no record for 6813823575;
that does not establish availability in other storefronts.

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
| App preview | `fastlane/previews/en-US/iPhone-6.3-preview.mp4`, 27 seconds, 886 × 1920, 30 fps |
| Poster frame | `fastlane/previews/en-US/poster.jpg`; select 5 seconds in Connect |
| Optional header | `fastlane/creative-assets/en-US/header.png`, 3840 × 1646 |
| Optional search art | `fastlane/creative-assets/en-US/search.png`, 1920 × 1280 |

The first three screenshots show quick logging, weekly patterns, and frequency.
The rest cover routines, editing, and dark mode. Each caption describes the
visible feature. The old widget-only upload asset was removed because it did
not represent the current screen sequence. Current widget footage can be added
after verifying the exact release's extension on a device.

The preview shows a real tap to log, then real navigation through Timeline,
Insights, Routine, and Edit log. Holds use the last recorded frame. It uses
H.264 High Level 4.0, a 10 Mbps encoder target, yuv420p, and silent 48 kHz stereo
AAC. It works with audio muted. Only local features appear, so it does not
suggest that cloud access is included. An iPad preview is optional and has not
been produced; iPad screenshots are supplied.

The native capture flow passed on dedicated iPhone 17 and iPad Pro 13-inch (M4)
simulators running iOS 26.5. `fastlane/capture-provenance.json` records the source
revision, native host, production bundle hash, and fixture details. Each device
started with 273 generated activities over 21 days. The capture flow adds one
activity per run. Customer data and accounts are not involved. The status bar
is standardized to 9:41; the app clock is unchanged.

The native runtime was an existing 1.12.0 simulator host with a fresh production
JavaScript bundle from this worktree. The captures are not a qualification of
the uploaded App Store binary. Reconcile them with that exact build before
submission and retake any changed screens.

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
   matching iPhone display slot. Choose the poster at 5 seconds and check
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

Use fresh task-owned simulators with the names in the provenance file, install
a matching native host, and export the current production bundle into a copy
of that host before re-signing and installing it. Keep that build outside Git.
Never overwrite another simulator's database. `scripts/seed-app-store.mjs`
checks the device name and refuses an existing database.

```sh
TZ=Asia/Shanghai node scripts/seed-app-store.mjs IPHONE_UDID
TZ=Asia/Shanghai node scripts/seed-app-store.mjs IPAD_UDID
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
video after generation. The editor verifies that each exported scene ends on
the corresponding captured UI; review the action and transitions visually too.
Original captures for this pass remain under
`~/Pictures/Screenshots/Codex/puptime-app-store/`. The first recording's raw MOV
and timing JSON also remain in the worktree's ignored `output/app-store/`.

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
