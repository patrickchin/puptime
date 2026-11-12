# Sync diagnostics

Native profile-photo uploads send validated JPEG bytes. Passing an Expo `File` directly to the authentication SDK sends its JSON metadata instead of image bytes, which can reject the photo and stop the queued activity upload that follows it. Reading the existing file's bytes preserves its photo ID and the pending activity operations.

Native builds keep the latest 100 structured diagnostic entries on the device, separately from opt-in product analytics. Open **My account → Export sync diagnostics** to create a JSON report through the system share sheet. Export is available without a network connection or an active account. Nothing is uploaded automatically.

The report includes its schema version, export time, native app version/build and platform. Entries contain allowlisted request categories (`config`, `account`, `enroll`, `push`, `pull`, `history`, `photo-upload`, `photo-download`), method, actual HTTP status where observed, duration, result/error category, batch size and sync state/queue counts. A missing status means no response status was observed; it is not a synthetic success. A successful HTTP response can still have an invalid-response category if its body fails validation.

Entries exclude account/puppy/activity/device identifiers, names, notes, photo bytes, request/response bodies, full URLs/query strings, credentials and raw errors. Unknown properties are removed both when recording and when loading persisted history. The bounded AsyncStorage write queue is best effort and cannot prevent logging or sync. Duplicate exports share one active operation. A single cache report remains available to the chosen share target and is replaced on the next export; the operating system may clear it. User-saved copies remain where the user chose to save them.

For a paused sync investigation, preserve a current external activity backup and the original installation first. Collect the diagnostic report after one retry. Read the last request category/status together with sync pending/blocked counts. A generic `invalid-request` or `conflict` during sync is not evidence of failed sign-in. Avoid signing out, clearing storage, relinking or importing over the live account to investigate an unknown failure.

Device logs remain available through Xcode/Console or Android logcat when connected to a development computer, but they are not a substitute for this bounded report. Older APKs do not retroactively gain diagnostics. CSV activity exports do not include authentication, association, upload queue or request history.

Keep support reports and real-user screenshots private. Use synthetic records and an isolated backend for regression tests. A fault-injected HTTP rejection that reproduces the screen establishes symptom handling and queue retention; it does not establish the root cause on a user's device. Qualify any fix against the actual failed path before calling the incident resolved.
