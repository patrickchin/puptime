# Native guest history and account recovery

The account history acceptance test uses the actual iOS Release app, native
Better Auth email SDK, SecureStore, SQLite and a private local Worker with real
D1 and Durable Object storage. Authentication and sync responses are not mocked.
No production account or real email delivery is involved.

Build the simulator host with signing enabled so Xcode embeds the simulator
Keychain entitlements:

```sh
xcodebuild -workspace ios/Puptime.xcworkspace -scheme Puptime \
  -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/ios-simulator \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
node scripts/verify-ios-guest-account.mjs DEVICE_ID \
  build/ios-simulator/Build/Products/Release-iphonesimulator/Puptime.app \
  --replace-synthetic build/guest-account-ios
```

Use the dedicated `Puptime 2f17 Onboarding…` simulator or the workflow's
`Puptime Onboarding CI…` simulator. The runner rejects cloud-owned starting
history, backs up previous synthetic SQLite data and resets that simulator's
Keychain. It owns local ports 8797 and 8799 and installs a temporary fixture CA
on that simulator. The app uses a normal Release bundle over HTTPS. Private
service data, credentials, codes and raw authentication traces stay outside
public evidence; successful output contains a verification summary and a
post-authentication screenshot.

The Maestro cases in `.maestro/account-preservation` exercise these paths:

1. Complete the shipped onboarding as a guest. Create 12 real pee, poop and meal
   logs, including an edited note.
2. Sign in through the actual native email SDK. Verify every local event stays
   exact and sign-in alone does not create an association or upload queue.
3. Confirm **Enable cloud sync**. Compare all 12 original IDs and event bodies
   against the authenticated remote pull, with one revision per event.
4. Create three more logs while signed in. Wait for automatic synchronization,
   verify all 15 remotely, then sign out. Keep all 15 local records.
5. Create six more logs as a guest. Sign in to the same account, explicitly
   confirm the same puppy and combine histories. Verify all 21 IDs and contents
   locally and remotely, without duplicates or rewriting earlier events.
6. Sign out, back up the source database, clear local app state and repeat
   onboarding. Assert the new local database has zero events. Sign in again and
   recover all 21 logs from the account. Verify the exact event fields and IDs,
   unchanged remote revisions, an empty upload queue and the same account owner.
7. Cold restart and navigate the normal app. Verify the recovered history and
   authenticated state remain intact.

Cloud upload remains an explicit confirmation after sign-in. An existing cloud
puppy also requires the same-puppy confirmation. The test covers real email
authentication through the shared account controller; it does not claim external
Apple or Google provider authentication. Those provider qualification records
are documented separately in `cloud-development.md`.

The iOS Simulator PR workflow runs this test after the onboarding decision suite
and failure/retry checks and uploads `build/guest-account-ios` as evidence.

## Android

The same cases and database/remote assertions also run on the dedicated Android
emulator:

```sh
ANDROID_HOME=/path/to/android-sdk npm run test:e2e:accounts:android -- emulator-5596 \
  android/app/build/outputs/apk/debug/app-debug.apk --replace-synthetic
```

Android uses the native Debug host with normal embedded release JavaScript,
rebuilt against the isolated HTTPS service. Set `ANDROID_HOME` (or
`ANDROID_SDK_ROOT`) and generate the Android project first. The runner temporarily
adds its fixture CA to the ignored native Debug source set, rebuilds the Debug
APK and restores those source files afterward. The Release source set is
untouched, and its production onboarding suite runs separately against the
Release APK. No Metro server is required.

The runner stops the disposable app before copying its SQLite/WAL files, then
reopens the actual account destination for each phase. This ensures consistent
snapshots and exercises recovery through repeated native cold starts. Ports
8797 and 8799 must be free. It verifies that the actual app reaches the isolated
backend before attempting sign-in. All authentication, Keystore storage and
sync use their real implementations; no provider session is injected.
