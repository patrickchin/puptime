# iOS review videos

[Open the local gallery](http://127.0.0.1:8877/). Six representative entries contain seven actual app recordings. Apple and Google share one provider entry, with Google as its collapsed companion.

| Entry | Clips | Actual scope |
| --- | --- | --- |
| First open | 360 | Frozen ad54 shared core in a reused qualified Debug shell; public Pages configured. Full setup, optional local choice, practice, first real log and timed reminder. Only clearState was omitted after fresh-data proof to retain its separate Metro binding. |
| Email and explicit upload | 361 | Actual SDK email-code sign-in with a synthetic address against the local HTTP proxy/API, using a private local preview code; no delivered-email claim. Retained local log, explicit enable/upload and authenticated restart. SQL equality excludes OS scheduled-notification state; the later separate UI/Expo timer readback is not part of that SQL claim. |
| Native provider restarts | 362 + 363 | Apple: fresh local Xcode Release151c. Google: fresh local integrated Release a1bb417, official Google SDK with its normal secure system-browser flow. Public Pages, no Metro. Both clips show safe saved-log restart footage only; private sign-in/provider/account-identity scenes are omitted. Separate root-reviewed native acceptance supplies the sign-in/restore/no-auto-upload proofs. |
| Restore and incoming edit | 364 | Frozen ad54 shared core in the reused Debug shell, local HTTP proxy/API, fresh empty device. Explicit confirmed-puppy restore and incoming peer edit; private code entry omitted. |
| Offline recovery | 365 | Fixed0472307 JS in the reused157-file Debug shell, local proxy8794→8793. The original failedad54 event/operation survives offline cold restart and uploads automatically when only the proxy resumes. SQL proof precedes all UI inspection, Retry or foreground actions. One acceptance/revision1/exact echo, empty outbox and15 unchanged unrelated records. |
| Local history | 366 | Frozen ad54 shared core in the reused Debug shell, account-free prepared fixture with1,001 local logs. Preview, Cancel and one confirmed restore. Node-minted fixture IDs do not establish Hermes generation. |

The five shared-core clips are not fresh Release builds. Provider clips362/363 are fresh local Release builds, not CI artifacts. Original sidecars, logs, chapters and captions remain byte-exact. Capture scopes do not extend to Android runtime, payments or publication. Current development scope is defined in [cloud-development.md](cloud-development.md); [cloud-verification.md](cloud-verification.md) remains a historical ledger.

## Concise technical evidence

- **367 — generated summary:** actual435 Node tests,103 Workers tests, default/iOS types and a fresh local integrated Release. It is labelled as a generated summary, not a new test execution or terminal recording. Its captured scope explicitly leaves combined CI Maestro pending. Updated Details separately record accepted native Google SDK sign-out and integrated Apple upgrade/restart.
- **365 harness/proxy-resume diagnostic — actual exit1:** the retained log exits with ESRCH while resuming a dead proxy, before actual transport resume or an automatic-recovery wait. It is not the product-failure capture. The separate protected `automatic-recovery-failure-proof.json` and raw SQL snapshots establish the real ad54 product recovery failure. Fixed0472307 recovery passes separately in clip365. The raw diagnostic files, SQL snapshots and other external proofs remain unchanged.

The approved cleanup removes1,436 exact obsolete files, including172 earlier videos and191 stale technical entries, plus their supporting captions, screenshots, logs and metadata. A refreshed exact-path/size/SHA256 manifest and execution receipt are retained outside the gallery under `obsolete-media-plan-2026-10-21`. The old browser-SDK363 fingerprints were replaced by accepted native Google files and are skipped. Current360–367 assets are protected. Obsolete media URLs retire intentionally; current journey, companion, chapter and technical-evidence links remain valid.

## Rebuild and serve

`scripts/build-review-gallery.py` reads `docs/review-gallery-catalog.json`. Only supplied qualified recordings belong in `journeys`; terminal evidence uses `.log` plus `.json`, with no MP4. Avoid empty placeholder entries. Generated summaries retain `generated_summary: true`, actual provenance and uncompleted-check limitations. Actual failures retain their original exit codes.

```text
python3 scripts/build-review-gallery.py /absolute/path/puptime-review-videos
python3 scripts/serve-review-gallery.py /absolute/path/puptime-review-videos --port 8877
python3 scripts/check-review-gallery.py
```

Use the maintained range-aware server:206/Content-Range responses let native browser controls seek before the whole file downloads. The gallery preserves original video IDs, chapter timestamps and current deep links. Use the maintained repository builder rather than the artifact directory's legacy `build-index.py`.

Existing `scripts/record-ios-review.py` captures actual credential-free app flows and retains result/log/JSON/caption metadata. Private authentication must be completed outside the footage; do not record credentials or provider identity pages. No generative product footage or terminal videos are accepted. Keep source recordings and raw proofs outside managed worktrees.
