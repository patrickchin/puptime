# Puptime navigation and interface audit

The puppy avatar, Settings, and the drawer lead to a small set of pages with distinct jobs. Settings is the index for app preferences. My Account is for the person and their cloud connection. Pets is the list of puppies they own or care for.

## How to reach each page on iOS

```mermaid
flowchart TD
    drawer["Navigation drawer"] --> log["Log"]
    drawer --> timeline["Timeline"]
    drawer --> insights["Insights"]
    drawer --> routine["Routine"]
    drawer --> notifications["Notifications"]
    drawer --> care["Puppy care"]
    drawer --> settings["Settings"]
    drawer --> account["My Account"]
    drawer --> pets["Pets"]
    log <-->|"Log and Timeline switch"| timeline
    avatar["Puppy avatar"] --> pets
    settings --> account
    settings --> pets
    settings --> notifications
    settings --> recent["Recent changes"]
    settings -->|"App guide"| guide["App guide"]
    notifications --> routine
    notifications --> pets
    pets -->|"Your puppies"| profile["Puppy profile"]
    pets -->|"Shared with you"| sharedLog["Shared puppy’s Log"]
    pets -->|"Sign in to see shared puppies"| account
    profile --> share["Share puppy"]
    firstRun["First-run setup"] -->|"Optional sharing"| share
    share -->|"Sign in to share"| account
    link["Invitation link"] --> invitation["Invitation review"]
    invitation -->|"Accept invitation"| sharedLog
```

## What each page does

```mermaid
flowchart LR
    log["Log"] --> logActions["Record or edit the active puppy’s activity"]
    timeline["Timeline"] --> timelineActions["Browse past activity and open log details"]
    insights["Insights"] --> insightActions["Review activity patterns"]
    routine["Routine"] --> routineActions["Plan activities, edit times and set routine reminders"]
    notifications["Notifications"] --> notificationActions["Manage delivery, permissions, nudges and timed reminders"]
    care["Puppy care"] --> careActions["Browse and read care guides"]
    settings["Settings"] --> settingActions["Set appearance, language and widget actions. Manage backups, CSV, help and privacy."]
    recent["Recent changes"] --> recentActions["Review local changes and open log version history"]
    account["My Account"] --> accountActions["Sign in, link providers, manage sync, export cloud data or delete the cloud account"]
    pets["Pets"] --> petsActions["Open your puppy’s profile or switch to a puppy shared with you"]
    profile["Puppy profile"] --> profileActions["Edit the name, change or remove the photo, or open sharing"]
    share["Share puppy"] --> shareActions["Set up cloud sharing, invite carers and revoke access"]
    invitation["Invitation review"] --> invitationActions["Sign in if needed and accept an invitation"]
    sharedLog["Shared puppy’s Log"] --> sharedActions["View shared activity and add entries when your role allows it"]
    firstRun["First-run setup"] --> firstRunActions["Start a local puppy journal or connect an account"]
    guide["App guide"] --> guideActions["Walk through app features"]
```

The Settings groups share one component for uppercase headings, card insets and separators. Search keeps data controls mounted during a transfer and shows separators only between visible rows.

The Account route keeps the caller on the navigation stack. Back returns to the drawer’s source page, Settings, or Share puppy. The account page shows compact local storage status and count. Puppy identity comparisons stay with the cloud connection review. The Apple and Google buttons use the providers’ native controls.

The profile uses a single photo control. iOS uses the system action sheet for the two photo actions, and adding or replacing a photo opens the system picker. The production journal supports one owned puppy. Additional owned puppy rows and independent journals need their own data and switching work.

The original pass also standardized the back button and heading alignment on sharing and activity history, and removed a duplicate safe-area inset from Recent changes.

## iOS verification

The navigation flow used an iPhone 17 simulator on iOS 26.5 with 360 synthetic activity logs. It exercised the Settings and avatar paths to Pets, inline name editing, photo removal and replacement, and all three paths to My Account and back.

Separate iOS fixtures passed guide replay from Settings, recovery of 21 logs into a fresh installation, and local preservation of 12 logs after cloud account deletion. The account fixtures used a local backend and disposable identities.
