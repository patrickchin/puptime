# Puptime navigation and interface audit

The puppy avatar, Settings, and the drawer lead to a small set of pages with distinct jobs. Settings is the index for app preferences. My Account is for the person and their cloud connection. Pets is the list of puppies they own or care for.

| Destination | How to open it | What it does |
| --- | --- | --- |
| Log and Timeline | Drawer or Log/Timeline switch | Record, edit and browse activity for the active puppy |
| Insights | Drawer | Review activity patterns |
| Routine | Drawer or Notifications | Plan activities, edit times and enable routine reminders |
| Notifications | Drawer or Settings | Manage delivery, permissions, nudges and timed reminders |
| Puppy care | Drawer | Browse and read care guides |
| Settings | Drawer | Choose appearance, language and widget actions, manage backups and CSV, see recent changes, control analytics and open help |
| My Account | Drawer, Settings, or sharing setup | Sign in, link providers, manage cloud sync, export cloud data or delete the cloud account |
| Pets | Drawer, Settings, or puppy avatar | Open the owned puppy’s profile or switch to a puppy under Shared with you |
| Puppy profile | Owned puppy row in Pets | Edit the name in place, change or remove the photo, and open sharing for this puppy |
| Share puppy | Puppy profile or optional first-run sharing | Set up cloud sharing, invite carers and revoke their access |
| Invitation review | Invitation link | Sign in if needed and accept the invitation |
| Recent changes | Settings | Review local changes and open per-log version history |

The Settings groups share one component for uppercase headings, card insets and separators. Search keeps data controls mounted during a transfer and shows separators only between visible rows.

The Account route keeps the caller on the navigation stack. Back returns to the drawer’s source page, Settings, or Share puppy. The account page shows compact local storage status and count. Puppy identity comparisons stay with the cloud connection review. The Apple and Google buttons use the providers’ native controls.

The profile uses a single photo control. iOS uses the system action sheet for the two photo actions, and adding or replacing a photo opens the system picker. The production journal supports one owned puppy. Additional owned puppy rows and independent journals need their own data and switching work.

The original pass also standardized the back button and heading alignment on sharing and activity history, and removed a duplicate safe-area inset from Recent changes.
