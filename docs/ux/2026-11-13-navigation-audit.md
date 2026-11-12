# Navigation and interface audit — 13 November 2026

The main usability problem is that account, puppy identity, sharing and app preferences have separate entry points without enough connections between them. The puppy avatar is useful as a shortcut to Pets; it should not also mean the human account.

## Navigation contract

| Destination | Responsibility | Access |
| --- | --- | --- |
| Settings | App preferences, notification and widget setup, local data, help and privacy | Navigation drawer |
| My Account | Sign-in methods, cloud backup and sync, cloud export, sign-out and account deletion | Drawer, Settings, Pets |
| Pets | Puppy name and photo, sharing your puppy, puppies shared with you | Puppy avatar, drawer, Settings, My Account |
| Share puppy | Invite carers and manage their access to your puppy | Pets |
| Shared puppies | Open puppies that other owners have shared with you | Pets, Share puppy, invitation links |
| Activity history | Inspect and restore recorded changes | Settings, log detail |

Settings retains both My Account and Pets near the top. The drawer keeps its existing shortcuts. Puppy profile fields have one home in Pets. My Account shows the saved puppy image next to the local name and provides a link to that home. My Account and Share puppy keep their back controls visible during scrolling.

## Findings and changes

| Priority | Finding | Resolution |
| --- | --- | --- |
| High | Native Settings declares account props but does not render an account entry. The browser implementation has an entry. | Use the same account row in native and browser Settings. |
| High | Puppy name, photo and sharing are reachable from the avatar but absent from Settings and My Account. | Add Pets links from both places, plus a My Account link from Pets. |
| Medium | “Share puppy” and “Shared puppies” do not explain their different directions. | Group them under Sharing; describe inviting carers versus opening another owner's puppy. |
| Medium | Pets actions touch with no vertical spacing. | Replace standalone buttons with padded navigation rows and section spacing. |
| Medium | My Account uses a dog icon instead of the saved puppy image. | Reuse the real puppy avatar in the local summary and phone/cloud comparison. |
| Medium | Local puppy information follows the long sign-in form. | Show the local puppy summary and management link before cloud sign-in. |
| Medium | Shared puppies uses a full-width Back button; Share puppy uses a large text button. | Share one 48-point icon back control and centered title layout with Account and activity history. |
| Medium | Account and history titles align with the top of their back controls. | Center titles vertically in the shared header, allowing accessible text wrapping. |
| Medium | The sharing screen uses a different maximum content width. | Align it to the same 720-point limit as account and settings. |
| Medium | Recent Changes adds a second top safe-area inset inside the app shell. | Reuse the shell’s safe area and align history content with its header. |
| Medium | Opening Pets from My Account while already on Pets can duplicate the back-stack destination. | Ignore navigation to the current destination. |
| Low | Shared puppy status text touches the puppy action. | Add an 8-point gap within each puppy entry. |

## Broader screen review

The source review covers the drawer and top bar; Log and its editors; Timeline and activity details; Insights; Schedule; Notifications; Puppy care; Settings and its sheets; Pets; Account; sharing and shared puppies; recent history and version details; and onboarding. Runtime coverage and limits are recorded below.

Existing separation that remains useful: Log/Timeline has a direct switch for daily logging; Schedule owns routine editing; Notifications owns delivery and reminders; Settings links to Notifications and widgets instead of duplicating their controls. The avatar remains a puppy shortcut. Account remains the human identity and cloud-management destination.

Settings fuzzy search and timeline gap compression were dispatched to separate worktrees and chats at the user's request. They are not part of this change.

## Verification

- Shared and iOS TypeScript checks pass. Localization and native module-resolution tests pass (4 tests). New copy is supplied in English, Simplified Chinese and Spanish.
- Native verification uses the dedicated **Puptime 9789 UX Audit** iPhone 17 Pro simulator, iOS 26.5, with a sample puppy photo and 360 synthetic activity logs. Real user records are untouched.
- Actual production components are rendered in an isolated test build. A test-only state driver selects the screens, opens/closes the drawer and opens/closes a real log editor. The existing render observer confirms that all 13 loaded activity rows retain their render counts during those drawer/editor transitions. Every field of all 360 activity records remains unchanged. This checks component state and layout, rather than simulating touch navigation.
- Fresh native screenshots cover Settings, Pets, My Account, Share puppy, Shared puppies, Recent Changes, the drawer and log editor. Evidence is saved under `~/Pictures/Screenshots/Codex/puptime-ux-audit/`.
- Settings, Pets, My Account and Shared puppies were also visually checked in dark mode at the maximum iOS Dynamic Type category. Text wraps into the scrollable content; the back controls remain visible. The simulator’s original appearance and text category were restored.
- The navigation regression flow is included at `.maestro/native/ios-ux-navigation.yaml`. The full touch flow could not complete on this host: the initial XCTest driver startup timed out; a retry launched the app but failed while querying the system status-bar accessibility hierarchy. No end-to-end navigation pass is claimed.
- Android runtime parity is assumed from the shared implementation and module-resolution check. Android, tablets, landscape, live signed-in account states and invitation acceptance are not runtime-qualified by this audit.
