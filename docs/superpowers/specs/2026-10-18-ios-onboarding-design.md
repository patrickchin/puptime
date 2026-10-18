# iOS onboarding: a small first success

Date: October18,2026. Extends the agreed optional-cloud design and the user's latest priority: onboarding should be exceptionally well designed, easy and fun. Execution remains autonomous; implementation uses the native inline Superpowers workflow, one fresh final review and PR-only integration.

## Product and design contract

Help a new puppy carer understand logging, patterns and routines before their first real log. The signature is a practice tap that makes Puptime's existing puppy illustration react and adds an obviously labelled example to the preview. The walkthrough contains four short stops, is skippable throughout, and does not require that practice action. The last stop offers an optional name and a separate optional notification action; Start logging always works without either.

Reuse the existing theme: background #F5F3EC, surface #FFFEFA, ink #17231E, primary #176B52, soft green #DDEFE7 in the default light theme. Derive runtime colors from theme tokens for all themes/dark mode. Use headingStyle(theme), existing system/body typography and utility time labels; add no fonts. Reuse assets/puppy-journal.png and ActivityIcon. The puppy response is the sole decorative motion: a short tap-triggered scale/translation using React Native Animated, stopped/omitted for Reduce Motion. No looping animation, new graphics package or confetti dependency.

1. Log: a puppy illustration and three practice actions (pee, poop, meal). Label the area Practice; an action changes only component state and reveals its sample row, with a brief puppy response. Next stays enabled.
2. Timeline: show the chosen practice activity in an illustrative three-day timeline, with clearly labelled example data and readable activity colors. Selecting an example day may highlight it locally. Demonstrate the actual existing timeline's meaning, without pretending to predict care needs.
3. Routine: show an example walk time and a practice reminder switch that updates the preview only. It never invokes OS permission or schedules a notification. Explain this is an example through its label, not a paragraph.
4. Ready: optional Puppy’s name input (default My puppy through Not now/blank), optional notifications control, Start logging. Notification Allow is explicit and independent of completion; blocked state offers Open Settings. No trial/account/payment prompt. Replay replaces setup with a simple ending; it never edits name or requests permission.

Skip completes first-run onboarding using the existing puppy name, even if a name draft was entered. Start logging commits a supplied trimmed name or My puppy together with completion. Completion failure keeps the screen/draft open. Back preserves in-memory choices. Existing completed installations stay completed. Replay closes to Settings and leaves records, name, preferences, ownership, outbox and notification permission unchanged.

Name is pet-scoped and stable identity never changes. Accept the current puppy protocol's 1–256 character name after trimming; blank first-run input means My puppy. Add a small iOS Settings puppy-name row using the existing native name setter and a native edit prompt, so the name can be changed later. Show the actual saved value only after a successful commit; failures retain the old value. Subscribe to the existing local commit signal so a remote name projection is reflected without resetting an open draft. No new account/trial/enrollment behavior.

## Platform and interaction requirements

Activate through OnboardingScreen.ios.tsx; preserve existing Android UI/runtime. Shared optional types may widen for platform compatibility. Touch targets >=44pt, visible labels, accessible selected/checked states and sample announcements, screen focus on title after step change. Keep Skip and main action reachable with large text, the keyboard and safe areas. Scroll long content instead of clipping or shrinking text. Cover English, Simplified Chinese and Spanish, default dark mode, all named themes, Reduce Motion and largest accessibility text.

Practice state never imports a storage writer. Samples never enter events/routines/revisions/outbox. No new nap behavior or widget promises. Permission delivery remains governed by existing code; a later device-only delivery plan still owns that control. No optional product analytics emitted before consent; observability integration remains a later plan.

## Evidence and finish

Before video19 shows the current four static screens. Record actual new full walkthrough, Skip, optional name, notification allow/deny, replay on populated history, name edit/failure and accessibility/theme journeys. Use the dedicated worktree simulator, synthetic data and external review gallery. Unit/storage checks use actual SQLite and injected write failure; native checks inspect exact retained data/ownership, not only visible success labels. Full Node/Workers/typechecks, Release build and all applicable Maestro flows must pass. Android remains unverified/deferred by explicit user instruction.

References: existing product components/tokens; Apple HIG onboarding (fast, fun, optional), https://developer.apple.com/design/human-interface-guidelines/onboarding; Mobbin's public onboarding catalogue, https://mobbin.com/explore/mobile/flows/onboarding. ALLEYKAT AppStore id6744624267 appears to match the original racing-app reference; its onboarding has not yet been inspected, so no claims or copied details are based on it.
