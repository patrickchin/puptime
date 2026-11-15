# Android qualification artifacts

The existing **Android APK** workflow builds with local native Gradle through Expo prebuild. A manual run defaults to `publish=false`: it creates Actions artifacts and does not create a Git tag or GitHub release. Publishing requires an explicitly authorized manual run with `publish=true`; only that separate job receives `contents: write`. Tag pushes keep their existing build-only behavior. The workflow-wide release lock covers both jobs.

Do not dispatch a candidate build until its source is frozen and the run is authorized. This workflow change alone produces no APK/AAB and establishes no runtime or store acceptance. It does not use paid EAS services, create a keystore, configure a signing secret, or change app data/configuration.

## Outputs

- `puptime-android-apk`: the existing `app-release.apk` contract, retained for the separate manual publisher and other consumers.
- `puptime-android-aab`: `app-release.aab`, built by the same Gradle invocation for qualification, not uploaded to Play or attached to the GitHub release.
- `puptime-android-qualification`: both file digests, signature/certificate receipts, the decoded **packaged APK** manifest, the AAB's actual raw protobuf manifest, and source/run/configured-version metadata. `BUILD-INFO.json` labels configuration values; inspect the packaged manifest rather than treating those values as measured artifact fields.

Signature/archive checks and the existing known-restricted-audio guard must pass before artifacts are uploaded. The publish job downloads only this run's APK and checks it against the verified build's digest before producing the unchanged `Puptime-<version>.apk` and APK-only `SHA256SUMS.txt` release assets. It atomically creates a **new** tag at the checked-out source commit, refuses every existing tag (including annotated or same-source tags), then creates the release with `--verify-tag`. It never moves or overwrites a tag; `--target` alone would not validate an existing tag's source.

If release creation fails after tag creation, preserve the tag and verified artifacts. Stop and review the source/digest before using the separate explicitly authorized existing-tag publication path; do not delete/retarget the tag or rebuild silently. Retrying this fresh-tag path will refuse the existing tag.

## Disposable signing-transition evidence

The separate [disposable proof workflow](../.github/workflows/android-signing-proof.yml) consumes two already completed artifact-only runs. It pins the immutable app source separately from the reviewed driver source. Its full-tree guard permits only the two named tooling edits and the new regular-file command-evidence helper; every other path, blob and mode must match the app source. It does not build another app or adopt a production signing key.

The guest-only exercise targets one fresh offline API 36 x86_64 emulator and temporary QA signing material. A static signature/lineage pass, successful installation or launch command is not a history-preserving update pass. Acceptance requires the actual guest seed and widget binding, plain-key rejection, lineage bridge, later update, exact UID/tables/files/widget comparisons and cold restart. It does not cover nonempty SDK credentials, genuine providers, Play, OEM/ARM devices or API 24–32.

Read the bounded verification receipt's completed stages, actual failure and cleanup result. An unfinished stage is not a pass. Failure diagnostics retain only fixed command fields; at most one best-effort screenshot is permitted only for the exact fresh offline guest-setup or launcher-widget-binding failure. Missing or competing command states remain unknown. Raw driver output, databases, preferences, QA keys and APK copies are not uploadable evidence. Keep **Hold: no new APK** until the exact candidate's remaining gates pass.

The current diagnostic attempt completed static signing/lineage checks, exact original-APK installation, guest setup and reminder-preference setup, then stopped while tapping the Quick Log item during launcher widget binding. Emulator exit and private-material removal were confirmed. The picker state remains unresolved; initial saved-state snapshots and the OS update/data-preservation sequence were not reached. This does not establish a failed signing transition or a passed update.

## Signing and final acceptance

Signing is deliberately unchanged. The installed Expo 57 template's generated `release` build type uses `signingConfigs.debug`; this workflow supplies no production signing credentials or override. That observed template default is not proof of a historical APK's private-key provenance. A valid signature or a task named `Release` does not establish Play signing readiness. Use each resulting artifact's certificate receipt and compare the actual installed/GitHub signer, Play app-signing certificate and upload key through the qualified release process. Do not generate/rotate keys or prescribe uninstall/clear-data to resolve a mismatch.

The raw AAB manifest is preserved without adding a bundletool installer to the build. Decode/inspect it with official [bundletool](https://developer.android.com/tools/bundletool) during exact-AAB qualification. Inspect final package/version codes, production endpoints, permissions/background-media configuration, native library and 16 KB page compatibility, the current target-API policy, artifact rights, and Play track acceptance separately. AAB signing/upload-key verification and a data-preserving distribution transition remain gates. The owner's choice of iOS for shared account/history tests does not cover Android-specific configuration or signing.

See [store readiness](store-readiness.md) for the independent store gates and [Android command-line builds](https://developer.android.com/build/building-cmdline) for Gradle tasks. Typed manual inputs and job-level permissions follow [GitHub's workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
