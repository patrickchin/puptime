# Puptime Privacy Policy

Last updated: October 28, 2026

Puptime is a puppy routine tracker developed by Patrick Chin. Local logging works without an account. This policy explains optional cloud accounts, the native app, and the public website.

## Information handling

When optional cloud sync and the hands-free assistant are not used, activity logs, notes, and routine settings stay on your device. The native app does not include advertising. Optional usage analytics are off until you enable them in Settings. Earlier offline-only releases do not have the optional account features described below.

## Optional accounts and cloud data

Where configured, you can sign in with an email code, Google, or Apple. Puptime stores your email address, name, provider identity, and authentication/session records to operate your account. Email codes are delivered through Resend; Google and Apple handle their own sign-in and consent screens. Puptime requests basic identity/profile and email access, not access to your mailbox or files.

Signing in does not upload puppy history or activate cloud sync. In account-enabled iPhone builds, choosing cloud sync uploads your puppy's profile (including an optional profile photo), activity, notes, routines, and supported preferences. Cloudflare D1 stores account/authentication records, and Cloudflare Durable Objects store synchronized puppy data and version history. Different sign-in methods are connected only through an explicit authenticated action; they are not silently joined by matching email addresses.

The account website lets you manage sign-in methods, sign out, download cloud data, and delete the cloud account. It does not record puppy activity. Authentication uses server-managed HttpOnly cookies. Temporary session storage records an account-return check for provider linking or reauthentication; it contains no password, email code, or session token and is cleared when used or the browser session ends. A necessary deletion guard in browser local storage keeps the original account identifier and attempt time until deletion is confirmed. This survives interrupted requests and closed tabs and is separate from optional analytics.

## Dog profile photos

You can choose a profile photo using the system photo picker in Settings. Puptime crops and resizes it and saves a JPEG file in the app’s private storage. SQLite stores only the photo’s identifier. The app does not need camera access for this feature.

With cloud sync enabled, JPEG files are uploaded separately to private Cloudflare R2 object storage. Profile data and version history contain image references. Downloads require an authenticated session for the owning account. Previous photos remain available with profile history until cloud account deletion, which also removes the account’s image objects. Removing the current photo clears its profile reference. Activity CSV exports, automatic activity recovery backups and cloud history exports do not embed image files.

## Optional app usage analytics

Usage analytics are off by default. In builds configured for analytics, enable **Usage analytics** in **Settings → Help & privacy** to share anonymous product events with PostHog's EU cloud. This measures screen visits and transitions, foreground time on screens, named control presses and press duration, and coarse activity-log actions (such as creating, editing, deleting, undoing, importing, ending a nap, or adding a custom activity type). Custom activities are counted as `custom`; their names are never sent.

Events use a random anonymous installation identifier that is separate from your account and puppy records, plus a session identifier, platform and app version. We do not send account/provider identifiers, puppy names or identifiers, log identifiers, activity timestamps, note contents, custom activity labels, photos, email addresses, codes, search terms, typed text, touch coordinates or raw errors. Automatic text/click capture, person profiles, session recordings, feature flags, surveys and automatic push tracking are disabled. Events request no GeoIP enrichment. Requests necessarily reach PostHog; see [PostHog's privacy policy](https://posthog.com/privacy).

Your choice and anonymous identifier stay on this device and are not synced or included in activity exports. Turn the switch off to stop capture, discard queued events, abort pending analytics requests and remove the stored anonymous identifier. Turning it on again creates a new identifier. Events already received by PostHog are not erased by withdrawal. The event queue is bounded and kept in memory, so offline use works normally and unsent events may be lost when the app is closed. Analytics are optional and do not affect local logging or cloud access. App consent and website consent are separate. Earlier releases without this setting do not collect these app events.

## Public website

The website is hosted on Cloudflare Pages. Cloudflare handles network requests to serve and protect the website. Cloudflare Web Analytics measures aggregate traffic, page load performance, and Core Web Vitals without analytics cookies. See [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) and [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

Optional product analytics use PostHog's EU cloud when a Puptime project is configured. PostHog is off until you choose **Allow analytics**. It measures website visits, source-code clicks, coarse account-action outcomes, and categories of browser failures. Account events distinguish actions such as sign-in, connecting a provider, export, and deletion; they do not identify the account. It uses an anonymous browser identifier stored in local storage. We do not send names, emails, account/provider identifiers, pet records, notes, email codes, authentication cookies, search terms, raw error messages, full URLs, query strings, URL fragments, or referrer URLs. Only known website route paths are included. Events request that PostHog disable GeoIP enrichment. Automatic click/text capture, person profiles, and session recordings are disabled. Network requests necessarily reach the analytics provider; see [PostHog's privacy policy](https://posthog.com/privacy) for its handling of service data.

Use **Analytics settings** in the website footer or guide header to withdraw consent. Declining stops PostHog capture and clears its stored browser identifier. The site also respects Do Not Track and Global Privacy Control for optional PostHog analytics. Your consent choice stays in this browser until changed or browser storage is cleared. Withdrawing consent does not erase events already received by PostHog. Cloudflare's aggregate traffic and performance measurement operates separately from this optional choice.

Website analytics do not receive your puppy activity history from the native app.

## Speech recognition

If you choose to dictate a note or use voice requests in Hands-free, Puptime asks for the relevant microphone and speech-recognition permissions. It uses Apple's speech-recognition service on iOS and your device's configured speech-recognition service on Android, which may be provided by Google or another provider.

Depending on your device, language models, and recognition service, speech may be processed on your device or sent to the speech provider for processing, and a network connection may be needed. The provider handles that processing under its own privacy practices. Puptime does not save the audio recording or send it to the developer. Dictated notes are stored locally as part of the selected log. Hands-free transcripts follow the additional processing described below.

## Optional hands-free assistant

Where configured, Hands-free lets you type or speak requests to log activities, edit recent log times and notes, navigate the app, and choose whether to review proposed logs before saving. It needs a signed-in account and an internet connection. Before the first request in each session, the app explains this processing and asks you to choose **Use assistant**.

Requests are sent through Puptime's Cloudflare backend to OpenAI. Each request includes your text, the current dog's identifier and name, current time, timezone and language, custom activity names, confirmation preference, up to 30 recent activity records (including notes), and bounded recent conversation context. This context can include local-only logs even when cloud sync is off. Using the assistant does not enable cloud sync or enroll a puppy for backup. Account credentials, email addresses and profile photos are not included in model input.

The backend requests that OpenAI not store the response as application conversation state (`store: false`). Provider processing and retention follow the applicable OpenAI service settings and policies; this flag does not establish zero retention. Puptime does not persist prompts or chat transcripts on its backend. It stores account-scoped request counters to limit usage.

Chat text remains in memory while the assistant is open and clears when it closes. The device keeps the last saved assistant operation, including affected log values, for retry protection and undo. Saved activities and notes follow your normal local backup and optional sync settings. Spoken replies use your device's text-to-speech service. Voice listening stops when you end the conversation, close the assistant, or put the app in the background.

## Notifications

If you enable routine reminders, Puptime schedules notifications locally on your device. It does not register your device with a Puptime notification server.

## Activity backups and sharing

When you choose **Export CSV** in Insights, Puptime creates an activity backup in temporary app storage and opens the system share sheet. The file includes activity identifiers, times, notes, custom activity names, nap state, source, and estimate labels. Routines and settings are not included. Puptime does not control the app or destination you select for sharing; that destination handles the exported file under its own privacy practices.

When you choose **Import CSV**, the system file picker lets you select a Puptime activity backup. Puptime copies the selected file into temporary app storage, validates it, and adds entries whose identifiers are not already stored. Existing entries and edits are kept. Imported entries follow the same optional sync choice as other activity; the original file is not uploaded.

**Download cloud data** exports the saved cloud snapshot and its version history as a browser download. It is available without active cloud access. Changes that have not synchronized from an iPhone are not part of that cloud snapshot. The exported file is private data; your browser and any destination you choose handle it under their own practices.

## Retention and deletion

Your data remains on your device until you delete individual records or remove the app. Deleting the app removes its locally stored data, subject to your device backup settings.

Cloud data is retained when sync is paused or access expires. Deleting a log can leave earlier versions in cloud history. **Delete cloud account** requires recent sign-in and explicit confirmation, and removes the account, its sign-in methods, sessions, and stored cloud records/history from the live service. It does not erase logs remaining on your devices or files you previously downloaded. For an Apple-linked account, Puptime also attempts to revoke its Apple authorization. If tokens are unavailable or Apple does not confirm revocation, app-data deletion still proceeds and the website directs you to remove Puptime in your Apple Account's Sign in with Apple settings.

Cloudflare's recovery backups expire separately from live deletion. D1 account/authentication history can remain recoverable for up to seven days on Workers Free or thirty days on Workers Paid; SQLite Durable Object puppy data can remain recoverable for up to thirty days. Deletion does not immediately erase those provider-managed recovery copies. The retired account object keeps non-content metadata to reject old clients.

If a deletion response is interrupted, the website reports that it cannot confirm completion rather than claiming success or creating a replacement account. With a still-valid original session, you can verify that account again by email and review a new deletion confirmation; verification never resumes deletion automatically.

## Changes

If Puptime's data practices change, this policy will be updated before the relevant app release.

## Contact

For privacy or support questions, use the [Puptime support page](https://github.com/patrickchin/puptime/issues).
