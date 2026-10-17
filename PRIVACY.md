# Puptime Privacy Policy

Last updated: October 17, 2026

Puptime is a private, offline puppy routine tracker developed by Patrick Chin. This policy explains how the native app and public website handle information.

## Information handling

The released native app does not require an account and does not include advertising, analytics, or tracking. Activity logs, notes, and routine settings are stored locally on your device. The native app does not collect or transmit that information to the developer.

## Public website

The website is hosted on Cloudflare Pages. Cloudflare handles network requests to serve and protect the website. Cloudflare Web Analytics measures aggregate traffic, page load performance, and Core Web Vitals without analytics cookies. See [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) and [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

Optional product analytics use PostHog's EU cloud when a Puptime project is configured. PostHog is off until you choose **Allow analytics**. It measures public page visits, Android download/source-code clicks, and categories of browser failures. It uses an anonymous browser identifier stored in local storage to associate visits and clicks. We do not send names, emails, pet records, notes, search terms, raw error messages, query strings, URL fragments, or referrer URLs. Automatic click/text capture, person profiles, and session recordings are disabled. Network requests necessarily reach the analytics provider; see [PostHog's privacy policy](https://posthog.com/privacy) for its handling of service data.

Use **Analytics settings** in the website footer or guide header to withdraw consent. Declining stops PostHog capture and clears its stored browser identifier. The site also respects Do Not Track and Global Privacy Control for optional PostHog analytics. Your consent choice stays in this browser until changed or browser storage is cleared. Withdrawing consent does not erase events already received by PostHog. Cloudflare's aggregate traffic and performance measurement operates separately from this optional choice.

Website analytics do not receive your puppy activity history from the native app.

## Speech recognition

If you choose to dictate a note, Puptime asks for the relevant microphone and speech-recognition permissions. It uses Apple's speech-recognition service on iOS and your device's configured speech-recognition service on Android, which may be provided by Google or another provider.

Depending on your device, language models, and recognition service, speech may be processed on your device or sent to the speech provider for processing, and a network connection may be needed. The provider handles that processing under its own privacy practices. Puptime does not save the audio recording or send it to the developer. The resulting text is stored locally as part of your note.

## Notifications

If you enable routine reminders, Puptime schedules notifications locally on your device. It does not register your device with a Puptime notification server.

## Activity backups and sharing

When you choose **Export CSV** in Insights, Puptime creates an activity backup in temporary app storage and opens the system share sheet. The file includes activity identifiers, times, notes, custom activity names, nap state, source, and estimate labels. Routines and settings are not included. Puptime does not control the app or destination you select for sharing; that destination handles the exported file under its own privacy practices.

When you choose **Import CSV**, the system file picker lets you select a Puptime activity backup. Puptime copies the selected file into temporary app storage, validates it, and adds entries whose identifiers are not already stored. Existing entries and edits are kept. The imported activity stays on your device; Puptime does not upload the file to the developer.

## Retention and deletion

Your data remains on your device until you delete individual records or remove the app. Deleting the app removes its locally stored data, subject to your device backup settings.

## Changes

If Puptime's data practices change, this policy will be updated before the relevant app release.

## Contact

For privacy or support questions, use the [Puptime support page](https://github.com/patrickchin/puptime/issues).
