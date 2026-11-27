# Website app captures

The website preview captures (`today`, `activity`, and `insights-summary`) and
the retained `insights-timeline` and `schedule` references were captured on
November 20, 2026 from
native iOS app source `4a8450dfafc6d2f49313309a1518edf59001fdc2` on a dedicated
iPhone 17 Pro simulator running iOS 26.5. Each PNG is an unedited,
full-resolution 1206 × 2622 native capture in the current light theme.

The journal (the seeder's default `full` rhythm) is wholly artificial: 175 example potty and meal logs for the
fictional puppy Biscuit, covering 14 completed days and seven activities today.
Short example notes and small timing variations are defined directly in
[`scripts/seed-website-screenshots.mjs`](../../scripts/seed-website-screenshots.mjs).
No personal history, CSV, account, export, or live service supplied the data.
The routine uses the app's suggestions from this artificial history.

The capture-only entry point freezes the app clock at November 20, 2026,
13:10 in Asia/Shanghai. The native status bar shows the same time, Wi-Fi,
and full battery. The ordinary app entry point, styling, and components are
unchanged; no fixture or clock override is included in the shipped app.
The native sequence is in
[`scripts/capture-website-screenshots.yaml`](../../scripts/capture-website-screenshots.yaml).
The seeder accepts only a task simulator named
`Puptime Website Screenshots <task>` and refuses an existing database.

The native host is version 1.12.0/build 1 from the trusted main/push
[run 43918521099](https://github.com/patrickchin/puptime/actions/runs/43918521099),
at source `13ddfcc541140596ff5001b60c045fba754ae912`, attempt 1, under the
explicit `compiled-for-testing` policy. Its simulator artifact's SHA-256 is
`2fc0026b631101de4e7f5d203cc658bcef2effb1f9135c6942fd18524a8eed85`.
Native configuration, dependencies, plugins, and source assets matched the app
source above before the new screenshots were installed in this repository.
Current production-mode JavaScript was embedded into a copy of that host with
the capture-only clock, an unreachable loopback cloud origin, and analytics
unconfigured. Native executable code and Info.plist were verified unchanged;
strict deep signatures and the installed JavaScript hash were verified.
The captured JavaScript SHA-256 is
`c976803af855f61abaf7099482cff5a8fd6b8c8210f6f1b3b681f23d0693978f`.
This is media-capture provenance, not release or full end-to-end qualification;
the host run's later onboarding failure remains separate.

These native captures contain the app screen only, without cropping, resizing, recolouring,
or a drawn interface. The website adds its existing phone rim, bezels, side
buttons, camera cutout, home indicator, and shadow in CSS. The widget and
appearance images are older reference captures and are not displayed on the
website. The task simulator was deleted after capture.

## Poop & Eat rhythm captures

The **Find your rhythm** stories show `timeline-poop-eat` (the Timeline's
default Poop & Eat view) and `schedule-poop-eat` (the Routine screen). They were
captured on November 27, 2026 with the same capture-only clock, status bar, and
unedited 1206 × 2622 light-theme framing, from the app source of this branch on
a dedicated iPhone 17 Pro simulator (iOS 26.5) named
`Puptime Website Screenshots web-recapture`, which was deleted afterwards.

Their journal is the seeder's `poop-eat` rhythm: 88 wholly artificial logs for
Biscuit with three meals and three poops a day, no pee breaks, over 14 completed
days and four activities today. The routine is the app's six suggestions from
that history. Nothing is filled in after Today.

```sh
TZ=Asia/Shanghai node scripts/seed-website-screenshots.mjs SIMULATOR_UDID poop-eat
maestro --device SIMULATOR_UDID test scripts/capture-website-screenshots.yaml
```

The native host is version 1.12.0/build 1 from the trusted main/push
[run 45837888056](https://github.com/patrickchin/puptime/actions/runs/45837888056)
at source `15d97c625da192bd55743ecb15d02636c4460212` (native configuration
unchanged since), artifact SHA-256
`3d033fd6a7ec2b737f89575f3860b5d382083efc21b9a6754ed94027f70cfa66`. Production
JavaScript from the generated capture entry, with an unreachable loopback cloud
origin and analytics unconfigured, was embedded into an ad-hoc re-signed copy;
Info.plist was unchanged. The installed JavaScript SHA-256 is
`171d1e527ea4f478f1d8c9cbda8129586ae08dc5aa9b21b33e2da0cd8ab93f25`.

## Illustrative timeline concept

`timeline-routine-concept.png` is the specifically approved **851 × 1848**
illustrative image formerly used in the website's **Spot the potty patterns** story.
The story now shows the unedited native `timeline-poop-eat` capture instead;
the concept is kept here for reference and has no website derivative.
It is a generative raster edit of a Timeline preview, with routine windows,
illustrative activity marks added to empty past days, and automatic missing-log
hints hidden for the preview. The image presents a concept rather than exact
activity history or an unedited current-app capture. App behavior is unchanged.

Its content credentials are preserved. SHA-256:
`4904345d735ba1e20f286229f3df57b01e6de0bee6008adafb00e42185b6c3a1`.
The native captures remain unchanged.

## Website derivatives

The website serves resized WebP copies of these images, the scruffy terrier, and
the potty-break illustration from `assets/web/`. They are generated by
[`scripts/build-web-images.mjs`](../../scripts/build-web-images.mjs) at about 1x
and 2x of each image's largest displayed width; rerun it after changing a source.
The originals here remain the unedited sources for the app, store, and docs.
