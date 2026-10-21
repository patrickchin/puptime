# Native onboarding design preview

`index.onboarding-preview.tsx` is a separate Expo entry for reviewing the proposed
puppy-name, eat/poop windows, and full schedule screens with real native inputs. The normal `index.ts`
entry and production first-launch flow are unchanged.

The preview keeps its name and schedule drafts in component state. It does not
open account, database, sync, or notification services. Relaunching resets the
drafts. It starts with the existing twelve `STARTER_SCHEDULE` entries plus two
example poop windows, with reminders off. The three meal times also start as
30-minute-before/after windows. These are editable examples, not personalized
recommendations.

After the name screen, an optional step shows only eating and poop windows. It
reuses the window editor from PR #141 (15, 30, 60, or 90 minutes before/after a
central time). Continue and Skip both open the full schedule for review; editing
in either step updates the same local draft. Skipping this first step leaves the
examples available to review; skipping the full schedule discards the draft.

`ScheduleScreen`'s optional `setupHeader` replaces daily progress during setup.
`setupActivities` limits the editor's activity choices and presents the range as
the main time label. The preview passes only the matching entries into this step.
Normal Schedule callers omit these props and retain all activity choices.

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
- Five eating/poop windows before the full fourteen-entry example schedule.
- Edited window widths carry into the full schedule and survive Back navigation.
- No missed/completed indicators during setup.
- Editing and saving an activity works through the existing editor.
- Skipping the schedule reaches the final preview page without saving a routine.

General, iOS, and Android TypeScript checks pass. Domain, native module-parity,
and timeline-format tests pass (26 tests). Android runtime layout has not been
reviewed in this pass.

Red Hat Display and Red Hat Text are bundled as static font weights for consistent
iOS rendering. Their shared SIL Open Font License is in
`assets/fonts/RedHat-OFL.txt`.
