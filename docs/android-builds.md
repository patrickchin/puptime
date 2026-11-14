# Android qualification artifacts

The existing **Android APK** workflow builds with local native Gradle through Expo prebuild. A manual run defaults to `publish=false`: it creates Actions artifacts and does not create a Git tag or GitHub release. Publishing requires an explicitly authorized manual run with `publish=true`; only that separate job receives `contents: write`. Tag pushes keep their existing build-only behavior. The workflow-wide release lock covers both jobs.

Do not dispatch a candidate build until its source is frozen and the run is authorized. This workflow change alone produces no APK/AAB and establishes no runtime or store acceptance. It does not use paid EAS services, create a keystore, configure a signing secret, or change app data/configuration.

## Outputs

- `puptime-android-apk`: the existing `app-release.apk` contract, retained for the separate manual publisher and other consumers.
- `puptime-android-aab`: `app-release.aab`, built by the same Gradle invocation for qualification, not uploaded to Play or attached to the GitHub release.
- `puptime-android-qualification`: both file digests, signature/certificate receipts, the decoded **packaged APK** manifest, the AAB's actual raw protobuf manifest, and source/run/configured-version metadata. `BUILD-INFO.json` labels configuration values; inspect the packaged manifest rather than treating those values as measured artifact fields.

Signature/archive checks and the existing known-restricted-audio guard must pass before artifacts are uploaded. The publish job downloads only this run's APK and checks it against the verified build's digest before producing the unchanged `Puptime-<version>.apk` and APK-only `SHA256SUMS.txt` release assets. It atomically creates a **new** tag at the checked-out source commit, refuses every existing tag (including annotated or same-source tags), then creates the release with `--verify-tag`. It never moves or overwrites a tag; `--target` alone would not validate an existing tag's source.

If release creation fails after tag creation, preserve the tag and verified artifacts. Stop and review the source/digest before using the separate explicitly authorized existing-tag publication path; do not delete/retarget the tag or rebuild silently. Retrying this fresh-tag path will refuse the existing tag.

## Signing and final acceptance

Signing is deliberately unchanged. The installed Expo 57 template's generated `release` build type uses `signingConfigs.debug`; this workflow supplies no production signing credentials or override. That observed template default is not proof of a historical APK's private-key provenance. A valid signature or a task named `Release` does not establish Play signing readiness. Use each resulting artifact's certificate receipt and compare the actual installed/GitHub signer, Play app-signing certificate and upload key through the qualified release process. Do not generate/rotate keys or prescribe uninstall/clear-data to resolve a mismatch.

The raw AAB manifest is preserved without adding a bundletool installer to the build. Decode/inspect it with official [bundletool](https://developer.android.com/tools/bundletool) during exact-AAB qualification. Inspect final package/version codes, production endpoints, permissions/background-media configuration, native library and 16 KB page compatibility, the current target-API policy, artifact rights, and Play track acceptance separately. AAB signing/upload-key verification and a data-preserving distribution transition remain gates. The owner's choice of iOS for shared account/history tests does not cover Android-specific configuration or signing.

See [store readiness](store-readiness.md) for the independent store gates and [Android command-line builds](https://developer.android.com/build/building-cmdline) for Gradle tasks. Typed manual inputs and job-level permissions follow [GitHub's workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
