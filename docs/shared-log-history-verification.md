# Shared native log history

History is a secondary editor action. Settings → Recent changes also finds
deleted logs. Both native clients use the same UI and guarded local/cloud APIs;
Android runtime verification is deferred.

The shared UI uses the existing guarded history API. The maintained flow
requires a single Reload tap to reach the actual list; a failed selector or a
visible button alone does not establish that transition.

## Repeatable iOS qualification

Use a dedicated history simulator with exclusive native-driver ownership.
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
and SQL checks. The microphone tests use native event/permission stubs and do
not claim actual microphone or OS permission verification.

## Native checkpoint — October 20, 2026

Frozen source `5612af66` passed local pagination/cancellation, draft persistence,
stale rejection and one-tap Reload, deleted restoration, and target-only SQL
failure/rollback followed by one successful retry. Each read-only or rejected
action preserved every SQL table. The fixture contained 1,000 unrelated logs.
An opt-in render probe on a separate fixture confirmed all 199 unrelated mounted
rows kept identical counters while opening, paging, selecting, cancelling and
rejecting a stale restoration. The functional journeys also ran without that
probe.

Actual local SDK email sign-in and explicit enrollment preceded cloud history
checks. The UI paged 56 cloud versions and cancelled without writes. An online
restore created one operation/revision and converged on an independent SQLite
client. During an actual proxy outage, a cached restore and new log retained the
same two pending payloads through process death; reconnect accepted each once,
converging on 1,003 logs. These checks used the local service, not a new external
provider sign-in or a native connection to the deployed backend.

Source `c726c8a` reduced stale rejection to one announced warning and made the
manual flows scroll to offscreen recovery controls. A small-screen test then
reproduced a blank confirmation when system text size changed live; opening at
the largest size worked. Source `d92d912` refreshes only the native history
viewport on font-scale changes. The same failing sequence now retains the
selected version and one warning, displays the body/header correctly, and
reaches the list after one Reload tap, with every SQL table unchanged. iOS and
Android static types passed again. Failed earlier runs and visibility-helper
false negatives remain recorded separately.

These native checks reused a compatible Debug shell with exact frozen Metro
sources; they do not establish a fresh build for each source. Fresh iOS Release
CI and its standard app flows are separate checks. Android runtime, external
provider authentication, delayed microphone permission and review videos are
not established by this history checkpoint.
