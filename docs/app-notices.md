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
  -PnoticeMainProjectRoot="$PWD" \
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
Unexpected graph/source/archive errors still fail the command. `failure.json`
may add a `native` object containing fixed operation/component/category enums and
an optional SHA-256 component identifier. It never includes raw errors, messages,
causes, paths, notice bodies or environment values. The most specific failing
Pod operation survives outer graph/union context. No bound is raised on failure.

The Gradle init script requires an explicit absolute `noticeMainProjectRoot` and
compares canonical project directories before registering its task. Other
included builds are skipped; a missing `:app` on the selected root still fails.
This uses Gradle's public [root project](https://docs.gradle.org/current/javadoc/org/gradle/api/invocation/Gradle.html#getRootProject())
and [project directory](https://docs.gradle.org/current/javadoc/org/gradle/api/Project.html#getProjectDir()) APIs.
The source-only root guard regression executes this actual init script through
`groovy.ui.GroovyMain scripts/notices-runtime-root.test.groovy scripts/notices-runtime.init.gradle`
with the installed Gradle distribution's `lib/*` on the Java classpath. It stubs
Gradle callbacks/task registration only; it starts no build or resolver.

Reports expose
relative source names, versions, hashes and finite unresolved reasons, not cache
paths, licence source bodies, raw maps, environment values or application data.

`seal` first retains that discovery report, then fails unless actual Metro and
native inputs are complete, all vendors/text are reviewed, font pins match, the
payload/ledger/package manifest/lock/app config/relevant source files equal Git
HEAD in the canonical checkout root, and the view imports the same
resource. A passing `seal.json` records that exact source/lock/native-input graph.
All tracked working-tree content must equal HEAD, including build configuration
outside the selected graph; ignored generated native/build outputs are permitted.
Missing input metadata or a font-only placeholder cannot pass. A failed seal
removes previous seal/final receipts. There is no generation or fallback mode.

`verify` revalidates the same source, native inputs and committed payload, then
requires the packaged raw JSON to match byte for byte. It compares the packaged
bundle hash with the mapped build output and requires the final composed map's
source contents to equal captured source bytes. Observed component IDs come from
those actual map entries and mapped archive-native entries, not the expected
coverage list. Code resolved from another
checkout, stale embedded source text, new modules and unmapped native files fail.
Missing asset-only packages and extra modules also fail. Only the current
worktree and its explicitly identified installed `node_modules`
root are accepted, with realpaths normalized. Raw source maps stay private.

Native stripping may change a `.so` hash. Final Android ABI/library names are
bound to the verified source AAR's actual libraries; final hashes are recorded
separately. Additional generated/NDK/Swift/framework inputs need explicit reviewed
component mappings in the ledger. Nothing is silently called app-owned. All nine
previously shipped Android LICENSE/NOTICE resources must retain their bytes.
The archive reader inspects Mach-O magic for every regular entry, including
extensionless main/appex executables. The exact JSON resource has its own 16 MiB
limit and is excluded from generic 1 MiB notice-file classification.
Universal headers are distinguished from Java class files sharing `CAFEBABE`
using bounded architecture-table offsets/sizes. Format references are Apple's
[fat header](https://github.com/apple-oss-distributions/cctools/blob/main/include/mach-o/fat.h)
and [JVMS 4.1](https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html#jvms-4.1).

Java/static-native ownership cannot be independently recovered from DEX/static
linked bytes here. Actual resolved Pod/Gradle inputs are re-inspected after
packaging; IDs supported only by those inputs are separately listed under
`resolvedBuildOnly` with their basis. Locked generated Metro providers are also
explicit. Receipts record `independentFinalComponentInventory: false` and do not
claim a newly regenerated Gradle resolution. Unknown/missing component IDs still
fail; no generic omission waiver or independent native final-byte identity is
implied by the complete *notice coverage* check.

For an IPA, use `seal ios` after pod setup, set `SOURCEMAP_FILE` to a private
absolute path for the normal Xcode build (the installed Expo/RN script composes
Hermes maps), then `verify ios --archive <candidate.ipa> --bundle <built main.jsbundle>
--source-map <composed map>`. This helper does not build, sign, upload or submit.
Keep normal version, signing, audio, provider, device and store gates separate.

## Reviewed ledger contract

`scripts/app-notice-provenance.json` has a `components` array indexed by each
record's explicit `platform` (`ios` or `android`) and unchanged actual `component`
ID, such as `npm:react-native@0.86.3`. Duplicate platform/component pairs fail.
Each record pins actual notice source/hash sets, `reviewedVendors`, native source
`nativeInputs` fingerprints, `upstream` and `sectionSHA256`. Section IDs are
`library-` plus the first 24 SHA-256 hex characters of `platform + ':' + component`.
Each is explicitly `iosOnly` or `androidOnly` in the ONE committed JSON. This lets
one npm ID have extra Android-native notices without weakening iOS comparison.
The union must contain every reviewed platform section, not only the current
target. Bodies are actual files sorted by logical source, joined with two newlines.
Font visibility is independently pinned in `font-icon-provenance.json` too.

When an AAR/JAR omits full text, an explicitly reviewed `additionalNoticeFiles`
entry may point at an actual pinned upstream copy under `assets/notices/sources/`
with `file`, `sha256`, `upstream`. It supplements discovered notices; it cannot
replace a missing NOTICE with a package label or an assumed parent licence.
Generated Metro sources permit only the known `__prelude__`, with its exact
installed Metro generator path/hash. Final native files not identified from resolved AARs require an exact
platform/path `packagedNative` mapping with covered `components` and a pinned
`review` reference. These mappings are intentionally empty until discovery.

Metro inputs are selected files, not every declared or installed package. Nested
packages have their own licence boundary. CocoaPods inputs include resolved pod
versions, generated acknowledgements, actual source notice files and vendored
framework/library names. Raw Pod lock/plist/notice bytes must be valid UTF-8;
invalid bytes are rejected before decoding, never repaired. Gradle inputs are the
actual release runtime resolution and artifact hashes. A shared bounded scanner
walks Pods and autolinked Gradle native subtrees, fingerprints source files, and
finds source-only `vendor`/`third_party` children as well as binary vendors.
Native roots are restricted to installed packages, Pods and identified local
modules; arbitrary project data is not traversed.
Only the actual Gradle build-directory output, configured CMake staging path and
Git metadata are excluded. The metadata exporter reads AGP's CMake configuration;
its module-local `.cxx` default applies only when CMake is enabled. Canonical
excluded paths are recorded; there is no `.cxx`/vendor wildcard. See the pinned
[AGP CMake staging contract](https://developer.android.com/reference/tools/gradle-api/8.12/com/android/build/api/dsl/Cmake#buildStagingDirectory()).
Vendor text must be present within its boundary, or explicitly mapped to a pinned
actual supplemental notice using `vendorNoticeSources`; approving a vendor name
alone cannot borrow the root licence. Missing source/text,
unreviewed vendor boundaries and changed digests stay unresolved. A POM/SPDX label
alone is insufficient. This is scoped notice evidence, not a complete transitive
SBOM or an independent legal certification.

## Proposed workflow wiring — not active in this preparation

No native build/upload workflow is changed here. Review this exact behavior before wiring:

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
   The current producer edits `app.json` for its version override; that dirty
   config is deliberately rejected. Its frozen-source/version policy must be
   reviewed when wiring this gate; there is no ignore-dirty switch.
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

## Separate unreviewed input artifacts — upload not enabled

Discovery retains `build/notices/<platform>/private/unreviewed-inputs.json` in a
0700 directory/0600 file. It contains original component notice inputs, explicitly
INCOMPLETE/discoveryOnly, not view sections or a seal. Never upload `private/`.

A separate `review/unreviewed-oss-notice-inputs.json` includes bodies only when
the exact component/source/SHA is explicitly pinned as public in
`knownLicenseSources`, with explicit ecosystem and version too. Public npm,
CocoaPods and Maven originals use the same manual pin contract; metadata alone
never implies public origin. The artifact allowlist contains only component/version/ecosystem,
normalized logical notice source, exact SHA and original UTF-8 body. Uncertain
or private-origin records expose only hashes and finite unresolved reasons. No
body is redacted or rewritten. Limits are 256 public bodies/4 MiB; over-budget
records remain hash-only. All captured input text is capped at 16 MiB.

After review, an optional upload would use exactly the following path (not a
directory glob), separately from any build qualification artifact:

```yaml
- uses: actions/upload-artifact@v6
  if: always()
  with:
    name: unreviewed-oss-notice-inputs-ios
    path: build/notices/ios/review/unreviewed-oss-notice-inputs.json
    if-no-files-found: warn
    retention-days: 3
```

Its content is always `INCOMPLETE`, `complete:false`, `discoveryOnly:true`.
The analogous Android path substitutes `android` for `ios`. No raw maps/cache,
source archives, owner paths, credentials or customer records are included. This
artifact supports technical review after the hosted runner disappears; it is
not a payload generator, legal certificate or release gate success.

Current npm/lock/font inputs and prior packaged Android notices are available.
Current generated CocoaPods acknowledgements, complete resolved Gradle artifacts,
final candidate maps and native-runtime metadata were not preserved in the prior
QA packet. Obtain them in the otherwise-required native setup. If incomplete,
stop before candidate compilation, retain discovery, review/commit real text and
resume the normal build; do not manufacture complete payloads now.
