# Shared native log history

History is a secondary editor action. Settings → Recent changes also finds
deleted logs. Both native clients use the same UI and guarded local/cloud APIs;
Android runtime verification is deferred.

The product UI is adapted from PR106's final `5b65ccfd` source. Its old observer
workflow, service harnesses, gallery changes and CI changes are excluded. In
particular, its earlier native Reload failure is not claimed resolved by this
port. The maintained flow requires a single Reload tap to reach the actual list.

## Pending iOS qualification

Use a dedicated history simulator after the account/sync driver is released.
Seed a clearly marked disposable fixture through the existing local runtime:
1,000 unrelated events, an edited custom event with over 50 revisions, and one
deleted custom event. Retain a database backup and capture all tables before
each read-only or rejected action. Never replace an account-owned fixture.

| Check | UI flow and proof |
| --- | --- |
| Local history | `ios-history-open.yaml` saves an editor draft before opening history. Only that event and its local revisions may change. `ios-history-local-restore.yaml`, with `ORIGINAL_SEQUENCE`, pages and cancels; every SQL table must then remain identical. `ios-history-confirm-restore.yaml`, with `HISTORY_NOTE`, commits one restore. Check stable event ID/source/estimated provenance and exactly one new restore revision. |
| Deleted log | `ios-history-deleted-restore.yaml`, with `DELETION_SEQUENCE` and `DELETED_ORIGINAL_SEQUENCE`, finds the log through Recent changes. Check its original ID/provenance returns, unrelated events and sync ownership stay exact, and deleted quick actions stay disabled. |
| Stale confirmation | While confirmation is open, commit a newer change through an independent runtime connection. `ios-history-stale-confirm.yaml` must reject the stale selection, then reach the list after one Reload tap. Compare the complete SQL snapshot with the newer baseline before and after Reload. |
| SQL failure | Inject a trigger limited to the marked target event. `ios-history-write-failure.yaml` must retain the confirmation and show an error with all tables unchanged. Remove that trigger in `finally`; retry once and require one committed restore revision. |
| Cloud history | Reuse the already-qualified disposable account/service. Add over 50 target versions through the standard API, load both cloud history pages, select an older acknowledged version and cancel without SQL writes. Then confirm via `ios-history-confirm-restore.yaml`; check one outbox intent and convergence on an independent client. Repeat with the connection offline, then reconnect: local logging remains usable and the same intent syncs once. Run against local and deployed development services. |
| Populated activity rows | In a separate diagnostic build, reuse `scripts/native-activity-probe/metro.config.cjs`. Compare `row-render-probe.json` counters across opening, paging, selecting, cancelling and a rejected restoration. The normal app fixture has 1,000 unrelated events, but only visible/bounded activity rows should render. Unchanged mounted row counters must stay exact. Repeat the functional happy path in the normal app; diagnostic counters alone are not normal-build proof. |

Also check Settings navigation from the Recent changes drawer, a small screen,
large text, dark mode, and readable error/restore states. Permission entry and
authentication stay outside recordings. No additional video gallery is needed.

The history flows are intentionally manual under `.maestro/native/`; they are
not added to the main app suite until a matching fixture runner is coordinated.
Their variables describe synthetic rows and contain no credentials.

## Source checks

The candidate passed 379 Node tests, including guarded SQL restoration, bounded
100,000-revision reads and three real-component dictation callback regressions.
Default, iOS and Android TypeScript resolution checks passed. These are source
and SQL checks; native history UI, restoration and populated-row render proof are
still pending. The microphone tests use native event/permission stubs and do not
claim actual microphone or OS permission verification.
