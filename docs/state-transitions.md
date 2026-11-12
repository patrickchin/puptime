# Stateful write contracts

These transitions are enforced at their write boundaries. Keep view state derived
from the committed result, and retain acknowledged data when an async operation
loses ownership of its original session.

| Flow | Transition contract | Implementation |
| --- | --- | --- |
| Sign-out/local fallback | Approval covers an outbox sequence high-water mark. Atomic detach refuses newer work. If credentials have already cleared, retain the paused owner and queue for confirmation or sign-in. | `src/cloud/account-controller.ts`, `src/local/sync-engine.ts` |
| Sharing | Capacity counts active access with either accepted membership or a valid invitation. Creation checks capacity atomically. Acceptance checks both accounts, revocation and deadlines in its SQL statement. | `server/sharing-eligibility.ts`, `server/sharing-routes.ts` |
| iOS potty reminders | Host and extensions use one native scheduler. Eligibility comes from the latest committed puppy/delivery policy and reconciled widget journal. Recheck after OS awaits; an obsolete plan can remove only its own request. | `plugins/ios-widget/PuptimeWidgetNotifications.swift`, `src/widgets/sync.ios.ts` |
| Naps | New starts and reopen edits cannot add a second running nap. Local toggles are transactional. Previously committed cloud/widget conflicts retain every log. Foreground reconciliation ends older naps at the first recorded awake activity or subsequent nap start, capped at a two-hour estimate to avoid multi-day naps, and leaves the newest running. A dismissible suggestion opens the existing end-time editor; read-only logs are never changed. Semantic sync rejection blocks until corrected; closing the conflicting nap requeues a blocked start after that correction. | `src/domain.ts`, `src/local/repository.ts`, `server/account-store.ts` |
| Routine editing | Save and permission results belong to an editor generation, including reopening the same record. Closing invalidates that generation. Saving locks draft inputs; permission completion cannot enable a replacement draft. | `src/screens/ScheduleScreen.tsx` |
| Dictation | Permission, starting, listening, finishing and cancellation are explicit phases. Manual changes invalidate the transcription. A native session reaches `end` before another starts. | `src/components/NoteInput.tsx` |
| Shared-care history | One queue owns refresh and pagination. Refresh reloads all loaded pages, reflects deletions and reuses unchanged rows. Identity changes invalidate outstanding responses. | `src/web/care-history.ts` |

## Review checklist

- For each `await`, identify the record, account, editor generation or policy that
  owns its completion. Check ownership again before applying the result.
- Put data invariants inside the transaction used by every writer. Include imports,
  recovery, sync, widgets and multiple database connections in the review.
- Test with deferred responses and reversed completion order. Include retries,
  permission denial, account changes, process reopening and partially completed
  destructive operations.
- Verify populated screens keep unchanged row identities during local editing.
  Follow `AGENTS.md` for native runtime and screenshot evidence.

## Regression checks

```sh
npm test
npm run test:web
npm run test:server
npm run typecheck:ios
npm run typecheck:android
npm run typecheck:server
node scripts/verify-ios-widget-reminders.mjs
node scripts/verify-ios-widget-journal.mjs
```

The Swift harnesses compile the production scheduling/journal code with controlled
OS boundaries. They supplement the dedicated iOS Simulator check; they do not
claim microphone, notification delivery or widget UI runtime verification.
