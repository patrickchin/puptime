# App notice capture and final-artifact gate

This is incomplete build preparation. The source JSON currently contains the
reviewed font/icon notices only. An empty component ledger deliberately prevents
sealing. Source tests, an internal simulator build, and finding licence filenames
do not establish complete app-library notice coverage or store readiness.

## Stable offline resource

`assets/notices/third_party_notices.json` is a **committed platform union** of
plain `{id,title,body,androidOnly?,iosOnly?}` sections. The existing offline
Settings view imports this exact file. Its current font/icon labels remain until
actual library text is reviewed and added. Preserve all six existing sections.

The existing `expo-asset` plugin also bundles those unmodified bytes. Expected
paths are APK `assets/third_party_notices.json`, AAB
`base/assets/third_party_notices.json`, and IPA
`Payload/Puptime.app/third_party_notices.json`. The small duplicate resource avoids
custom Hermes parsing. No tool rewrites source JSON, a generated native resource,
or a signed package. This asset/config change requires a new matching native host
and final package qualification; an older host is not equivalent.

## Commands and failure behavior

Run from the canonical project root, in the same production environment as its
normal bundle. `index.ts`, production Hermes transform settings and the pinned
Expo `createMetroServerAndBundleRequestAsync` implementation are reused. The graph
pass emits no JS/Hermes bundle or native compilation. Its temporary server is
closed in `finally` and on SIGINT/SIGTERM; it never creates a device. A private
cache directory plus `EXPO_NO_METRO_WORKSPACE_ROOT=1` isolates worktree resolution.

```sh
# After normal pod install; discovery only, never a release certificate.
node scripts/capture-app-notices.mjs collect ios

# After normal Android prebuild; resolve inputs without compiling.
# The raw Gradle input contains local cache paths: keep it private.
umask 077
mkdir -p build/notices/android/private
(cd android && ./gradlew -I ../scripts/notices-runtime.init.gradle \
  :app:writeNoticeRuntimeInputs --no-daemon \
  -PnoticeInputsOutput="$PWD/../build/notices/android/private/runtime-inputs.json")
node scripts/capture-app-notices.mjs collect android \
  --gradle-input build/notices/android/private/runtime-inputs.json

# Candidate gate, after reviewing/committing the union and ledger, before compile.
node scripts/capture-app-notices.mjs seal android \
  --gradle-input build/notices/android/private/runtime-inputs.json

# After the ordinary single Gradle build; repeat verify for the AAB.
node scripts/capture-app-notices.mjs verify android \
  --gradle-input build/notices/android/private/runtime-inputs.json \
  --archive android/app/build/outputs/apk/release/app-release.apk \
  --bundle android/app/build/generated/assets/react/release/index.android.bundle \
  --source-map android/app/build/generated/sourcemaps/react/release/index.android.bundle.map
```

`collect` writes `build/notices/<platform>/discovery.json`, always
`status: INCOMPLETE`, `complete: false`, `discoveryOnly: true`. Even fully mapped
discovery inputs are not certified. It produces neither a payload nor a seal.
Unexpected graph/source/archive errors still fail the command. Reports expose
relative source names, versions, hashes and finite unresolved reasons, not cache
paths, licence source bodies, raw maps, environment values or application data.

`seal` first retains that discovery report, then fails unless actual Metro and
native inputs are complete, all vendors/text are reviewed, font pins match, the
payload/ledger/relevant source files equal Git HEAD, and the view imports the same
resource. A passing `seal.json` records that exact source/lock/native-input graph.
Missing input metadata or a font-only placeholder cannot pass. A failed seal
removes previous seal/final receipts. There is no generation or fallback mode.

`verify` revalidates the same source, native inputs and committed payload, then
requires the packaged raw JSON to match byte for byte. It compares the packaged
bundle hash with the mapped build output and requires the final composed map's
source contents to equal captured source bytes. Code resolved from another
checkout, stale embedded source text, new modules and unmapped native files fail.
Only the current worktree and its explicitly identified installed `node_modules`
root are accepted, with realpaths normalized. Raw source maps stay private.

Native stripping may change a `.so` hash. Final Android ABI/library names are
bound to the verified source AAR's actual libraries; final hashes are recorded
separately. Additional generated/NDK/Swift/framework inputs need explicit reviewed
component mappings in the ledger. Nothing is silently called app-owned. All nine
previously shipped Android LICENSE/NOTICE resources must retain their bytes.

For an IPA, use `seal ios` after pod setup, set `SOURCEMAP_FILE` to a private
absolute path for the normal Xcode build (the installed Expo/RN script composes
Hermes maps), then `verify ios --archive <candidate.ipa> --bundle <built main.jsbundle>
--source-map <composed map>`. This helper does not build, sign, upload or submit.
Keep normal version, signing, audio, provider, device and store gates separate.

## Reviewed ledger contract

`scripts/app-notice-provenance.json` records exact component IDs such as
`npm:react-native@0.86.3`, `cocoapods:Expo@57.0.24`, or Maven coordinates, actual
notice source/hash sets, `reviewedVendors`, explicit `platforms`, a pinned
`upstream` reference and the combined section's `sectionSHA256`. Deterministic
section IDs are `library-` plus the first 24 SHA-256 hex characters of the exact
component ID. Body text is the actual notice files, sorted by logical source and
joined with two newlines. Keep separate NOTICE/multiple-vendor texts.

When an AAR/JAR omits full text, an explicitly reviewed `additionalNoticeFiles`
entry may point at an actual pinned upstream copy under `assets/notices/sources/`
with `file`, `sha256`, `upstream`. It supplements discovered notices; it cannot
replace a missing NOTICE with a package label or an assumed parent licence.
Generated Metro sources require an explicit `generatedSources` provider/hash
mapping. Final native files not identified from resolved AARs require an exact
platform/path `packagedNative` mapping with covered `components` and a pinned
`review` reference. These mappings are intentionally empty until discovery.

Metro inputs are selected files, not every declared or installed package. Nested
packages have their own licence boundary. CocoaPods inputs include resolved pod
versions, generated acknowledgements, actual source notice files and vendored
framework/library names. Gradle inputs are the actual release runtime resolution
and artifact hashes, including autolinked native projects. Missing source/text,
unreviewed vendor boundaries and changed digests stay unresolved. A POM/SPDX label
alone is insufficient. This is scoped notice evidence, not a complete transitive
SBOM or an independent legal certification.

## Proposed workflow wiring — not active in this preparation

No build workflow is changed here. Review this exact behavior before wiring:

1. Normal simulator CI: after `pod install`, run **collect only**, with an
   explicit INCOMPLETE/non-release-qualified step name and job-summary notice.
   Upload only sanitized `discovery.json`/finite failure metadata. Do not upload
   `private/`, raw Gradle inputs, source maps or raw collector logs. A successful
   internal test host does not certify rights coverage.
2. Android candidate producer: after prebuild resolve the Gradle input, then
   **seal before** the existing `assembleRelease bundleRelease`. Give seal and
   build identical public build environment/entry/transform settings. Missing
   metadata stops before compile, preserving sanitized discovery for review.
   Commit the reviewed union/ledger first; do not plan a throwaway native build
   or overwrite assets during the build.
3. After the ordinary build, run strict **verify for both APK and AAB before**
   artifact uploads or the existing publisher. Only exact READY receipts and
   package hashes qualify; no `continue-on-error` or placeholder success.
4. A device/iOS release producer must similarly seal before compilation and
   verify its actual IPA before sealing/submission. There is no current automated
   device-build workflow to amend; wiring must name its actual producer rather
   than imply a simulator receipt qualifies an IPA.
5. Keep one affected offline-view UI proof plus final resource byte proof. Actual
   new host/resource rendering, complete native input capture and final-artifact
   execution are **pending**, not supplied by these source tests.

Current npm/lock/font inputs and prior packaged Android notices are available.
Current generated CocoaPods acknowledgements, complete resolved Gradle artifacts,
final candidate maps and native-runtime metadata were not preserved in the prior
QA packet. Obtain them in the otherwise-required native setup. If incomplete,
stop before candidate compilation, retain discovery, review/commit real text and
resume the normal build; do not manufacture complete payloads now.
