# Native onboarding design preview

`index.onboarding-preview.tsx` is a separate Expo entry for reviewing the proposed
puppy-name and schedule screens with real native inputs. The normal `index.ts`
entry and production first-launch flow are unchanged.

The preview keeps its name and schedule drafts in component state. It does not
open account, database, sync, or notification services. Relaunching resets the
drafts. It starts with the existing twelve `STARTER_SCHEDULE` entries, with
reminders off, and reuses `ScheduleScreen` for editing. Its optional `setupHeader`
replaces the daily-progress presentation while setting up a routine.

## Running on iOS

Use a simulator dedicated to this branch, and a native host built from the
project's current Expo SDK. Export the preview bundle into a copy of that host:

```sh
node node_modules/expo/bin/cli export:embed \
  --entry-file index.onboarding-preview.tsx --platform ios --dev false \
  --bytecode --max-workers 2 \
  --bundle-output build/onboarding-native/Puptime.app/main.jsbundle \
  --assets-dest build/onboarding-native/Puptime.app
codesign --force --deep --sign - build/onboarding-native/Puptime.app
```

Install that copy on the dedicated simulator with `xcrun simctl install`, then
launch `com.patrickchin.puptime`. Do not overwrite the production build artifact.
The preview can also be bundled with `--platform android` for a matching Android
development host.

## Verification

Verified on the iPhone 17 simulator named **Puptime 2f17 Onboarding Keyboard**:

- One visible name prompt, with a separate accessible input name.
- Native software keyboard; input, Continue, and Skip remain visible.
- Continue works with the keyboard open and preserves the entered name.
- Twelve editable starter times; no missed/completed indicators during setup.
- Editing and saving an activity works through the existing editor.
- Skipping the schedule reaches the final preview page without saving a routine.

General, iOS, and Android TypeScript checks pass. Domain and native module-parity
tests pass (21 tests). Android runtime layout has not been reviewed in this pass.

Red Hat Display and Red Hat Text are bundled as static font weights for consistent
iOS rendering. Their shared SIL Open Font License is in
`assets/fonts/RedHat-OFL.txt`.
