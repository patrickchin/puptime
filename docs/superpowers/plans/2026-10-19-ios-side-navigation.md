# iOS side navigation and notification workspace

User steering on October19 supersedes the prior inline-only implementation choice: use parallel agents for independent work, keep iOS first, and prioritize navigation, Notifications, concise setup, the selected mascot and review-media usability. Existing history data Tasks1–3 are complete; history surfaces/qualification Tasks4–5 remain subsequent work, not abandoned or claimed complete.

## Design contract

- Use the installed, maintained React Navigation drawer layout and Expo-matched native dependencies. A labelled menu button opens a left-side overlay with current selection and a dismissible backdrop. Preserve the underlying activity view while the drawer opens; no bottom tabs on iOS. Deferred platforms retain their prior navigation.
- Give Notifications a dedicated destination. Move device delivery, after-pee/meal rules and routine lead time there, with compact labelled controls. Retain existing synchronized rules and device-only delivery semantics. Widget-specific controls stay with the deferred widget settings.
- Add explicit one-off timed reminders using Expo's persistent scheduled-request store, scoped by puppy and strict app marker. No additional database or cloud transport. Date/title validation, permission and device-intent gates, exactly-once tap handling, list/delete/restart/error cases and queued off-versus-create behavior are required. Turning delivery off explicitly warns that it removes pending one-offs; daily rules remain retained.
- Onboarding uses one clear question/title per step. Preserve checkpoints, optional accounts, explicit cloud activation, restore safeguards and permission choices. User selected scruffy terrier A; use a bundled transparent derivative with responsive sizing, no text baked into artwork.
- Gallery serves byte ranges for real seeking, app footage only as video, searchable plain text for terminal checks. Remove exact redundant terminal MP4s only after validating original text/metadata and no live use. Archive only this chat's inactive managed worktree, preserving needed ignored provenance; other chats and synthetic owned data remain untouched.

## Parallel ownership

Gallery agent owns server/builder/recorder and gallery evidence. Notifications agent owns extraction, timed reminders and focused native flow updates. Onboarding agent owns the two iOS setup/tour screens and mascot integration. Root owns drawer/App integration, locales, service lifecycle checks, cleanup decisions and coordinated native verification. Agents share a branch with disjoint file ownership; root alone commits, runs devices and integrates PRs.

## Acceptance

Run full Node/Workers and all platform typechecks; gallery range/escaping/exit-status regression; real standalone iOS first-open/name/keyboard/permissions and drawer/Notifications journeys, including timed reminder creation/delete/restart/denial/failure. Check standard/small screen, large text, language/theme and populated history state/row rendering. Record app journeys and text output with precise scope. Inspect fresh screenshots and show them inline. One fresh independent review covers the completed branch before PR integration; PR99 must pass/merge first. Preserve the active broader cloud rollout and all provider/payment/distribution gates.
