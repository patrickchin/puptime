# Native onboarding design preview

`index.onboarding-preview.tsx` is a separate Expo entry for reviewing onboarding
with real native inputs. The normal `index.ts` entry and production first-launch
flow are unchanged. Answers, routine drafts, and preview logs stay in component
state. The preview does not open account, database, or sync services. Its optional
notification choice uses the real OS permission prompt, but schedules nothing.

## The whole journey

Keep one conversational voice from opening the app through the first real log.
The welcome page combines welcome and account entry, retaining the approved
emerald palette, real app icon, large Puptime name, Scruffy scene, and one equal
row of Apple/Google/email choices. These provider entry buttons explicitly explain
that sign-in is not connected in this design preview and offer the guest path;
they never pretend that authentication succeeded or send an email.

The same emerald background continues through every setup question, plan review,
the optional full schedule editor, reminders, and the ready page. Warm light text
and cream answer/action controls keep contrast clear. The name field uses the
native dark keyboard. Entering the log screen uses the app's usual warm cream
background and existing log controls.

The guest path asks one question at a time: puppy name, age, meals, and poop
routine. Replies carry into later prompts and previous times are acknowledged.
There are no duplicated visible field labels. Screen-reader focus moves to each
new question; inputs retain accessible names and native keyboard behavior.

After reviewing the plan, a friendly reminder choice asks before invoking the
native notification-permission sheet. Declining or skipping proceeds normally.
Granting permission does not enable or schedule individual reminders in this
preview. A final invitation offers a brief tour or independent exploration.

The tour continues inside the actual `LogScreen`, using its real `QuickActions`,
event rows, and event editor. A pointer connects the opening hint to the logging
buttons. The owner can dismiss it without creating a made-up entry. Logging an
activity replaces the hint with a short acknowledgment; editing and deleting
those preview records update the in-memory draft. Logs survive navigation back
to the plan during that run, but relaunching resets the whole preview.

`LogScreen` only gains an optional `quickActionsHelp` slot after its existing
buttons. Normal callers omit it and retain their current layout and behavior.

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
7. Review the meal and poop plan. The primary action keeps only those entries
   and continues to the reminder question, unless a full plan was explicitly
   adopted earlier. Back navigation preserves that choice.
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
project's current Expo SDK **and current native modules**, including Google
Sign-In. An older host without that module cannot load the current log screen's
account-related imports. Export the preview bundle into a copy of that host:

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
native module-parity, and timeline-format tests pass (29 tests), including
unknown-age guidance, post-meal windows that cross midnight, and retaining an
explicitly adopted full plan.

Additional iOS checks cover the full guest journey, the explicit provider-preview
disclosure, the real notification-permission sheet, declining permission, and
the handoff into the actual log screen with its contextual hint.
The final iOS pass verifies that an adopted full plan survives Back navigation,
notification setup can be skipped, the guide can be dismissed without logging,
and a real quick action creates an entry and its acknowledgment. The entry opens
and closes in the native editor. Fresh simulator captures include the keyboard,
meal question, reminder choice, ready page, contextual guide, and first log.

Android verification uses the dedicated **Puptime_Onboarding_2f17** emulator and
an ignored native QA fixture with 1,382 synthetic records. The hint and populated
history render correctly. A temporary EventRow render probe records 58 loaded
rows: opening and closing the log editor changes none of their counters. The QA entry,
instrumentation, APK, and records remain under ignored build output; no fixtures
or debug entry points are added to production.

Red Hat Display and Red Hat Text are bundled as static font weights. Their shared
SIL Open Font License is in `assets/fonts/RedHat-OFL.txt`.
