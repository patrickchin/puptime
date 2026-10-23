# Multiple-pet UI audit — 23 October 2026

## Status

The production app still presents one puppy. Multiple-pet **storage foundations** exist; a usable multiple-pet **product flow** does not. This PR adds a separate native, interactive design preview, not production multi-pet support. `index.ts` and the production app are unchanged. Preview records live in memory and reset on restart. The preview never connects an account or schedules system notifications.

The direction follows `RELEASE_PLAN.md`: both pets' actions together on Log; one selected pet in Timeline, Insights and Schedule. Examples use Mochi, a puppy, and Maple, an adult, with different routines and 30 days of synthetic history. A third pet exercises long names and empty states.

## Three material findings

1. **There is no way to reach multiple-pet data from the app.** `runtime.native.ts` opens a singleton runtime around `active_pet_id`; `App.tsx` loads that runtime's activity, schedule and history. Settings provides a single puppy name editor. The preview adds pet management, a named action row for each pet, a combined history, and an explicit selector above individual views.
2. **A selector alone would hide incorrect ownership in several workflows.** `PuppyEvent` has no pet ID outside its repository scope; quick actions, undo, log editors and widget pending events currently rely on the one runtime. Account association displays `account.pets[0]`. The preview carries pet identity alongside each history item, keys rows by pet and event, names logging confirmations and editors, scopes undo to its original pet, and keeps selection visible. Production must carry that identity end to end rather than changing the global active pet around asynchronous writes.
3. **Reminders and widgets are not ready for several pets.** Custom one-off reminders already carry `petId`, but routine/potty scheduling takes one schedule/history, notification preferences are device-wide settings, and widget update props do not identify a target pet. The preview separates the device notification switch from each pet's timing rules and shows a fixed, named widget target. Production needs per-pet scheduling, cancellation, notification payloads and widget routing before enabling this design.

## Full surface audit

| Surface | Current implementation | Preview / required behavior |
|---|---|---|
| Initial setup | One puppy profile | Keep first-pet setup short; expose Add a pet afterward. Additional pets start with an empty log and routine. Existing onboarding is unchanged. |
| Navigation | No pet context | Log is household-wide. Individual views retain a visible pet selector across navigation. Learn remains shared. |
| Log quick actions | Three actions for the active puppy | Two named pet rows, each with its own latest timestamps; extra activities remain attached to that row. |
| History | One pet's day groups | Combined chronological list with a pet name on every entry; All pets / individual filtering. Production should preserve day grouping and paged queries. Preview uses a virtualized list. |
| Add, edit, undo | Implicit active puppy | Pet ID remains attached to the original action. Editor names the pet. Only the affected pet's event changes. Preview demonstrates note editing and undo; full date/type/delete/revision interactions still need production wiring. |
| Timeline | One history and routine | Existing native chart receives only the selected pet's events/windows. Switching resets transient chart detail state. |
| Insights | One pet's statistics | Existing native analytics receives only selected-pet history. No household average that combines different animals. |
| Schedule / learning | One routine and history | Existing routine editor and suggestions use selected-pet data. Mochi has three meals; Maple has two. New pet has no example routine silently applied. |
| Notifications | Device delivery switch; one runtime's recurring rules | One device permission/delivery choice, per-pet timing rules, pet names in delivered messages. Preview toggles modify memory only. |
| One-off reminders | Pet ID exists in payload | Preserve pet-specific list/cancel behavior; add pet name to delivery and route opening to that pet. Existing production implementation still needs multi-pet UI qualification. |
| Widgets | One unlabelled target | Bind each widget instance to a fixed pet ID; show its name. Changing the app's selected pet must not retarget a widget. Screenshot is an in-app layout proposal, not an installed widget. |
| Active naps | Scoped by current repository | Preserve one running nap per pet, allow different pets to nap simultaneously, and route widget completion to the correct pet. Not implemented by this preview's extra-activity sample buttons. |
| Pet settings | Rename the current puppy | Manage several names; long names wrap. This proposal requires distinct display names/nicknames to keep logs unambiguous. No destructive pet removal is proposed. |
| Device settings | Appearance, language, widget actions | Appearance and language remain shared. Widget target/action preferences need instance/pet ownership. Preview demonstrates shared appearance. |
| Local backups | Already retain/recover all dogs by original ID | Preserve all-pet recovery and per-pet limits; present names when choosing a snapshot. Existing recovery is not exercised by the preview. |
| CSV export/import | Active pet; CSV has event IDs but no pet mapping | Confirm destination pet before import; name source pet in export UI/file. Define an explicit multi-pet archive format before offering household export. Preview import explains its sample-only behavior; existing Insights export shares only selected synthetic history. |
| Cloud / account | One runtime; first cloud pet association | One account, multiple explicit local-to-cloud associations. Show the chosen dog's summary before combining/restoring. Requires backend/client qualification; the preview does not simulate a successful cloud connection. |
| Revision history | Repository-scoped events | Keep pet context visible in recent changes and restores; preserve composite identity even when event IDs collide. Not wired into the preview. |
| Learn / care guides | Shared content | Keep shared. No pet picker that implies advice has been personalized. Existing screen is reused. |
| Empty / validation | No add-pet flow | Third pet has zero logs and no routine. Blank and duplicate display names retain the form with inline errors. Cancel does not add a pet. |
| Accessibility / layout | Native framework and theme tokens | Native sheets, inputs, switches and 48-point actions; full names rather than color alone; two-letter monograms distinguish Mochi/Maple. Verify narrow, dark, large-text and landscape states. |

## Design refinements made after rendering

- Kept each pet's name directly beside its actions; compact action rows leave room for history on a phone.
- Used two-letter monograms after the first render showed identical M avatars for Mochi and Maple.
- Fixed the Settings rename entry point and added a duplicate-name error with a nickname suggestion.
- Replaced nested name-entry modals with one native sheet after iOS verification exposed a blank sheet when adding a pet dismissed both levels together.
- Kept editor draft state inside the editor and memoized history rows, with stable callbacks and composite pet/event keys.
- At the largest iPhone system text setting, the first preview wrapped the brand into several lines and clipped avatar initials. Bounded decorative branding and compact controls separately from body text; body copy still grows to twice its base size. The revised native Log was captured at that setting. Full accessibility qualification of the reused analysis/routine screens remains production work.

## Production implementation boundary

This is a reviewable UI proposal. Shipping it requires explicit pet-scoped writes/queries throughout the app, a persistent pet-management API, scoped notification preferences and scheduling, widget identity, account association, migrations and recovery qualification. Do not promote the preview entry point as the production entry point.

Run and screenshot instructions, automated flows, and the Android row-render observer are in `scripts/multi-pet-preview/`. Native captures and the gallery are under `output/multi-pet-audit/` in this worktree; selected contact sheets accompany this document.

## Verification

- All 461 existing and new Node unit tests passed. General, iOS and Android TypeScript checks passed.
- Native iPhone flows covered all main views, pet selection, pet-specific logging and undo, filtering, add/rename, duplicate-name validation, empty history and empty routine. A separate check exercised rename from Settings and cancellation.
- The Android UI rendered with 30 days of distinct history for two pets. The render observer tracked 72 history rows: opening and typing in the note editor redrew zero rows; saving redrew exactly the edited row.
- Captured iPhone light/dark, iPad portrait, Android light/dark, a 375 dp Android viewport, 2× Android text, the largest iPhone accessibility text category, and a landscape Android viewport. These are targeted preview checks, not full accessibility certification of the existing app.
- System notification delivery, installed widget interactions, cloud sync, persistent pet creation/switching, and recovery across multiple pets were not verified by this UI proposal.

## Screenshots

![Current and proposed Log](multi-pet-ui/01-log.png)
![Per-pet analysis and routines](multi-pet-ui/02-individual-views.png)
![Pet management, reminders and widget proposal](multi-pet-ui/03-management.png)
![Android, dark, empty and large-text states](multi-pet-ui/04-more-states.png)
![Large-text refinement](multi-pet-ui/05-accessibility-fix.png)
