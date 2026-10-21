# Native onboarding design preview

`index.onboarding-preview.tsx` is a separate Expo entry for reviewing onboarding
with real native inputs. The normal `index.ts` entry and production first-launch
flow are unchanged. Answers and routine drafts stay in component state; the
preview does not open account, database, sync, or notification services.

## Conversational routine setup

Ask one thing per page. A response advances the conversation; time questions
acknowledge the previous answer. Use the entered puppy name. Keep the full editor
behind an optional link at the end rather than requiring it during setup.

1. Ask the puppy's name once, then their approximate age (or skip).
2. Explain the usual meal count for the chosen age, then ask about their actual
   feeding routine. The owner can choose one to four meals or leave this unset.
3. Ask for one meal time per screen, using the existing native time selector.
   Back preserves times. The last answer creates the meal draft.
4. Ask whether the owner knows their puppy's poop routine. Unknown means no poop
   entries are created; offer to look for a pattern from logs later.
5. For a known post-meal pattern, ask about the owner's observed delay, then build
   daily windows from the chosen meal times. These are observations, not a
   predicted digestion delay or an instruction to wait before taking a puppy out.
6. For known clock times, ask how many usual windows, then one time per page.
   These start with 30 minutes either side and remain editable later.
7. Review the meal and poop plan. The primary action keeps only those entries.
   The optional full schedule also offers the existing starter pee/nap examples;
   adopting that full plan requires its separate action.

All reminders start off. Skipping a meal/poop section removes its draft entries.
Returning to a meal-count choice preserves times when the count is unchanged;
choosing a different count starts with editable example times for that count.
There are no arbitrary default poop entries when the owner is unsure.

`ScheduleScreen`'s optional `setupHeader` replaces daily-progress presentation in
the optional full editor. The brief experimental activity-filter mode has been
removed now that guided setup owns these questions.

## Guidance sources

- [Merck Veterinary Manual: feeding schedule for puppies](https://www.merckvetmanual.com/multimedia/table/feeding-schedule-for-puppies)
  informs the four/three/two meal hints. Adult copy uses two as a common choice,
  consistent with the [AKC feeding guide](https://www.akc.org/expert-advice/nutrition/puppy-feeding-fundamentals/).
  These are general hints; copy explicitly preserves the owner's veterinary plan.
- [Blue Cross: toilet training a puppy](https://www.bluecross.org.uk/advice/dog/behaviour-and-training/toilet-training-a-puppy)
  supports offering toilet opportunities after meals. The app does not claim that
  every puppy poops a fixed number of minutes after eating.

## Running on iOS

Use a simulator dedicated to this branch and a native host built from the
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
The preview can also be bundled with `--platform android` for a matching native
host.

## Verification

Verified on the iPhone 17 simulator **Puptime 2f17 Onboarding Keyboard**:
name entry with the native keyboard, personalized age/meal prompts, a changed
meal time reflected in the next question, back navigation, known manual poop
times, observed post-meal windows, an unknown poop routine left unset, and the
optional full editor carrying the chosen entries.

General, iOS, and Android TypeScript checks pass. The focused helper, domain,
native module-parity, and timeline-format tests pass (28 tests), including
unknown-age guidance and post-meal windows that cross midnight. Android runtime
layout has not been reviewed in this pass.

Red Hat Display and Red Hat Text are bundled as static font weights. Their shared
SIL Open Font License is in `assets/fonts/RedHat-OFL.txt`.
