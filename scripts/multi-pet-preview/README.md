# Multiple-pet native design preview

This is an opt-in UI proposal with synthetic, in-memory data. The production entry point does not import it. Do not replace production routing with this preview.

`index.multi-pet-preview.tsx` registers the sample app. Existing Timeline, Insights, Schedule and Learn components are reused with pet-specific sample data. Logging, undo, history filtering, full event editing, confirmed log deletion, a dedicated Pets destination with full-page add/rename forms, routine editing, per-pet timing controls and shared appearance work in memory. Notification delivery, account sync, backups and installed widgets are not connected. The widget screen is an in-app layout proposal. Extra activity buttons create point samples; they do not implement running naps.

## Native bundles

Use a disposable simulator/emulator named for this worktree and a compatible Puptime native host built with this repository's dependencies. Do not install over a personal journal.

```sh
npm ci
npx expo export:embed --entry-file index.multi-pet-preview.tsx --platform ios --dev false --bundle-output output/multi-pet-audit/main.jsbundle --assets-dest output/multi-pet-audit/ios-assets
npx expo export:embed --entry-file index.multi-pet-preview.tsx --platform android --dev false --bundle-output output/multi-pet-audit/index.android.bundle --assets-dest output/multi-pet-audit/android-assets
```

Embed the resulting bundle and assets in the matching disposable native host and sign/install it for the simulator/emulator. These commands bundle JavaScript; they do not build or install a native host. For the audit, an existing compatible native host was reused, with only its JavaScript/assets replaced and the local artifact re-signed. No app-store build or deployment was made.

## Screenshot and interaction flows

```sh
maestro --device DEVICE_ID test scripts/multi-pet-preview/capture.yaml --test-output-dir output/multi-pet-audit/captures
maestro --device DEVICE_ID test scripts/multi-pet-preview/states.yaml --test-output-dir output/multi-pet-audit/states
python3 scripts/multi-pet-preview/capture-android.py emulator-5582
```

The Maestro flows cold-start the preview, so sample changes reset. `states.yaml` covers pet-specific logging/undo, history filtering, duplicate names, adding a third long-name pet with empty history/routine, and renaming. The Android capture script uses native UIAutomator IDs and restores display/text settings after narrow, enlarged-text and landscape captures. It rejects emulators outside this worktree.

## Android row-render check

Bundle `scripts/multi-pet-preview/render-probe.tsx` instead of the normal preview entry and embed/install it in the disposable Android host. The probe distinguishes first mounts from updates to already-mounted rows and writes per-row counters only in the sample app's Documents directory. A root-capable Google APIs emulator image is needed to read that private test file with `su 0`; leave adbd in its normal shell mode.

```sh
node scripts/multi-pet-preview/verify-row-renders.mjs emulator-5582
```

This drives native UIAutomator and ADB, verifies populated history, opens the shared production editor, replaces its note and closes after autosaving. Opening must redraw zero history rows. Autosaving must update only the edited row, preserving every unchanged row's update counter. Expanding long notes may mount different rows as the virtualized window changes; those mounts are reported separately. Delete confirmation and cancellation must redraw no history rows; confirmation removes only the chosen pet's event and keeps the other pet's history visible. Results and a screenshot are written to `output/multi-pet-audit/row-check/`.

The fixture check runs in the existing `npm test` suite and covers combined ordering, filtered ownership and composite identity when different pets share an event ID. It is not a production persistence or sync qualification.

## Navigation integration check

With the preview installed on `Puptime_Multi_Pet_622c` or `Puptime_Navigation_d859`, run:

```sh
node scripts/multi-pet-preview/verify-navigation.mjs DEVICE_ID
```

This checks compact titles, Log/Timeline switching, retained pet selection, CSV controls in Settings, separate sample exports for Maple and Mochi, sample-only import, contextual Back, and unchanged production SQLite files.

## Pets page check

Pet management lives under **Pets** in the main drawer. The Log shortcut and the selector’s Manage pets action open that same page. Add/edit forms use the app header and Back navigation; saving returns to the pet list without changing the selected pet or history filter. Settings contains device and data tools.

With the preview installed on a dedicated emulator:

```sh
python3 scripts/multi-pet-preview/verify-pets-page.py emulator-5596 output/pets-page
```

This exercises menu navigation, blank/duplicate names, rename/save/cancel, adding an empty pet, contextual and Android Back, retained selection, dark mode, 375 dp at 2× text with Save beside the form title, and landscape. It captures fresh screenshots and checks that the production SQLite journal is unchanged.

## Large text

The preview switches from tiles to full-width action rows when enlarged text has less than 300 points of effective horizontal room. Wide tablet/landscape layouts keep the grid. Body text and inputs grow up to 2×, sheet headings up to 1.5×, and decorative branding/initials use their own limits. Large-text history notes are not restricted to two lines. The shared reminder controls and navigation use the same readable body/heading limits.

```sh
xcrun simctl ui DEVICE_ID content_size accessibility-extra-extra-extra-large
maestro --device DEVICE_ID test scripts/multi-pet-preview/large-text.yaml --test-output-dir output/large-text/ios-final
python3 scripts/multi-pet-preview/capture-large-text.py emulator-5582
```

Use the render-probe bundle and set Android `font_scale` to `2.0` before running `verify-row-renders.mjs` for the enlarged-history check. The probe scrolls to the first event, enters a multi-line note and verifies that unchanged rows retain their render counts. Restore the simulator text category after review. The Android capture flow restores its prior text/display settings itself.
