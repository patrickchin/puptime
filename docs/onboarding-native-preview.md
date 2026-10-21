# Native conversational onboarding

`index.onboarding-preview.tsx` runs the real `PuptimeApp` with the conversational
first-run design enabled. The normal entry keeps the existing first-launch UI
while this draft is reviewed. Both entries use the same native app, SQLite
storage, schedule, Notifications section, logging, and navigation after setup.
There is no stripped-down home screen or route back into onboarding from a plan
shortcut. Provider buttons still disclose that sign-in is not connected in this
design preview and offer the guest route.

## Journey

The welcome and setup screens share the emerald background, warm light text,
cream controls, real icon, and one randomly chosen approved Scruffy scene.
The keyboard uses its native dark appearance. Each heading asks its question
once, with accessible input names. Skip actions replace the redundant Optional
tag. Headings use short, single-line copy at the default phone text size,
without forced line breaks or truncation. Larger accessibility text and long
puppy names may wrap. Supporting text is reserved for useful context, such as
age-based meal guidance, time-window behavior, and what happens to the plan.

1. Ask for a puppy name and approximate age. Either can be skipped.
2. Offer the usual meal count for the chosen age, while preserving the owner's
   veterinary plan. Ask how many meals their puppy actually has.
3. Show **all meal times together** with editable defaults: noon for one meal;
   7am/6pm for two; 7am/noon/6pm for three; 7am/11am/3pm/7pm for four.
   Back preserves edited times when the meal count stays the same.
4. Ask about poop patterns: observed after-meal timing, known daily windows, or
   still figuring it out. Unknown creates no invented poop entries.
5. Review the chosen times. The full schedule editor is optional and offers
   starter pee/nap times. An explicitly adopted full plan survives Back.
6. Choose notification timing, then allow notifications or skip them.
7. Save setup and enter the normal app, with an optional spotlight over the real
   quick-action buttons. Declining the tour enters the same app directly.

## Notifications

`NotificationTimingControls` is shared by onboarding and the existing separate
Notifications destination in the app's side navigation. It includes:

- Scheduled meal and poop-window reminders, with independent before/at/after
  offsets and toggles that update the actual routine reminder flags.
- A delay after a logged meal, using the existing potty reminder preference.
- A delay after a logged wee, using the existing after-pee preference.
- An activity icon beside each reminder.

Other routine reminders retain the existing shared lead time. New timing fields
are optional and validated in storage and sync, so old preferences keep their behavior. The shared cloud protocol accepts
the additional optional fields; a deployed server must include this protocol
change before a released client syncs these choices.

The OS permission request uses the app's real notification flow. Not now disables
delivery on this device while preserving the selected timing choices. Finishing
saves the schedule and notification preferences before marking onboarding done;
a failed write keeps the answers available for retry. Logs, settings, and the
completion marker survive app relaunch.

## Spotlight

The spotlight is an absolute sibling overlay over the normal app. It measures
the real QuickActions without adding a row or padding to the log list. Four
native Expo BlurView regions surround an unobscured opening over those buttons.
Android uses BlurTargetView and its native SDK 31+ blur implementation; older
Android versions use Expo's dimmed fallback. The overlay blocks touches outside
the highlighted area. Nothing yet dismisses it without creating an entry;
logging through an actual button also dismisses it. Normal navigation is then
available, including Schedule and Notifications. Android Back dismisses the hint.

## Native verification

Use a task-specific simulator/emulator. Because `expo-blur` is a native module,
build a current native host with it before embedding this entry. An old host
without ExpoBlur cannot run the spotlight.

```sh
npx expo prebuild
# Build the native iOS or Android app for the dedicated test device.
node node_modules/expo/bin/cli export:embed \
  --entry-file index.onboarding-preview.tsx --platform ios --dev false \
  --bytecode --max-workers 2 \
  --bundle-output build/onboarding-native/Puptime.app/main.jsbundle \
  --assets-dest build/onboarding-native/Puptime.app
```

After installing the conversational build on that device, run the complete flows:

```sh
maestro --device DEVICE_ID test .maestro/conversational
```

The iOS Simulator pull-request workflow builds this entry into a separate copy
of the native host and runs these flows on its own CI simulator, uploading a
separate report alongside the main app results.

The flows edit a default meal time and verify it survives Back, select all four
notification timings, finish setup, dismiss or act through the spotlight, navigate
normal Schedule/Notifications/Timeline, and reopen the app with the real log still
present. They assert the old preview plan route is absent. These flows clear test
app data and belong only on the dedicated test device, not an installation with
personal history.

## Checked on this branch

- All three committed iPhone Maestro flows pass on **Puptime 2f17 Onboarding
  Keyboard**: completed setup plus restart, logging through the spotlight, and
  skipping optional setup plus the tour. The logging path was rerun after the
  Android measurement fix and passes on the final build.
- The dedicated **Puptime_Onboarding_2f17** Android emulator passes the onboarding
  handoff into the real app and spotlight with 1,382 synthetic SQLite records.
  Dismissing the guide, opening the log editor, and closing it each leave all 62
  observed EventRow render counters unchanged. The real quick-action positions
  stay fixed when the overlay disappears. QA fixtures, native artifacts, and
  render probes remain in ignored build output.
- General, iOS, Android, and server TypeScript checks pass. All 461 Node tests
  and 126 server tests pass, including signed notification scheduling across
  midnight, optional preference validation, and storage/sync round trips.
- The shared time selector now uses a keyboard-aware native modal. Maestro types
  a meal time, saves with the keyboard open, and confirms it survives Back.

## Guidance sources

- [Merck Veterinary Manual: feeding schedule for puppies](https://www.merckvetmanual.com/multimedia/table/feeding-schedule-for-puppies)
  informs the age-specific four/three/two meal hints.
- [AKC feeding guide](https://www.akc.org/expert-advice/nutrition/puppy-feeding-fundamentals/)
  supports two meals as a common adult choice.
- [Blue Cross: toilet training a puppy](https://www.bluecross.org.uk/advice/dog/behaviour-and-training/toilet-training-a-puppy)
  supports offering toilet opportunities after meals. The app does not prescribe
  a universal digestion delay or tell owners to wait before taking a puppy out.

Red Hat fonts are bundled with their SIL Open Font License in
`assets/fonts/RedHat-OFL.txt`.
