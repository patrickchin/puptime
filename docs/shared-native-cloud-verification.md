# Shared native account and logging paths

Based on main `7f59afb2c052f54678b66e2efb7a57482d62b357`. This slice shares the working iOS implementation through React Native's `.native` resolution. It changes no server schema, wire protocol, trial/entitlement behavior or website analytics.

The storage, activity queries, local runtime, auth/export adapters, cloud hook, notification device preference, setup/walkthrough/settings screens and puppy editor now resolve to the same files on iOS and Android. Browser activity fallbacks remain separate. No AsyncStorage conversion or compatibility layer is added: both phones use the existing typed SQLite schema, repository and durable outbox. Platform-specific widget implementations remain deferred.

The app's native feature routing now includes both phones: account/profile setup, side navigation and Notifications. Genuine platform choices remain small: both phones use the same modal/input puppy editor; keyboard show/hide events follow each OS. The shared auth adapter continues using BetterAuth Expo, SecureStore, Expo fetch and external browser authentication.

## Checks

`src/native-parity.test.ts` uses the installed TypeScript resolver to verify that both native module graphs select the shared implementations. Default, iOS and Android type checks are static checks; they do not establish Android runtime behavior. Existing Node checks cover the SQL repository/outbox/controller and shared domain logic. All 372 Node checks and the default/iOS/Android static type checks pass for this candidate. Android has not been built or run.

Before any native driver use, the source diff and iOS verification plan are reviewed. iOS runtime checks should cover a clean setup, optional local use, profile editing, notification navigation/device opt-in, email sign-in, logging offline, reconnect synchronization and restart. Screenshots show the preserved iOS screens. Real provider login requires separately controlled accounts/session approval and is not implied by a static shared adapter.

## Deferred Android qualification

No Android emulator, Gradle build or runtime test is run in this slice. Native SQLite transactions/WAL/connection and change-listener behavior, SecureStore/backup/reinstall, auth browser/callback/cancellation, authenticated WebSocket headers, app background/resume, notification permissions/channels/alarms, file sharing and populated-list redraw behavior still need Android verification.

The timed-reminder editor uses separate date and time picker modes on Android because Expo UI maps its combined `datetime` mode to date-only. Hardware back/keyboard/accessibility and existing widget headless SQL/outbox writers also remain Android runtime gates. These are not claimed as tested merely because their shared TypeScript compiles.
