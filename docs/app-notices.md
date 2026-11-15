# App notice capture and final-artifact gate

This is incomplete build preparation. The source JSON currently contains the
reviewed font/icon notices only. An empty component ledger deliberately prevents
sealing. Source tests, an internal simulator build, and finding licence filenames
do not establish complete app-library notice coverage or store readiness.

The own-package source records additionally bind 97 selected RN/Expo Pods to
28 exact public NPM owners. Package, podspec and original MIT text hashes match
lock-integrity-verified published tarballs; each reviewed podspec reads its own
package licence. The 91 literal directory/6 exact podspec forms use the existing
strict binding helper. These records preserve own-package attribution only.
ExpoRouter/ExpoUI without own text, Yoga, the six missing-text NPM components,
Metro prelude, and every vendor/generated boundary remain independently
unresolved. The component-approval ledger and offline payload are unchanged.

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
an optional SHA-256 component identifier. Source-graph failures additionally use
closed Error class/code enums and a SHA-256 of the supplied source string; no
source path or filename is included. It never includes raw errors, messages,
causes, paths, notice bodies or environment values. The most specific failing
Pod operation survives outer graph/union context. No bound is raised on failure.

Gradle archive inspection failures use the fixed `gradle-archive-scan`/`maven`
context with the existing canonical component ID's SHA and the archive SHA
already verified against its bytes. This wraps only the original Python call;
its invocation, strict exit and exception remain unchanged. Child output
and paths are not copied into this context.

Native archive entries have a separate 192 MiB cap and SHA-256 is streamed in
1 MiB chunks through ZIP EOF/CRC validation, requiring the declared byte count.
Text (1 MiB each/16 MiB total), payload (16 MiB), bundle and nested JAR (128 MiB)
bounds remain unchanged. The exact public React Android 0.86.3 release AAR
(`59b66e453d8775a54df66a321c0d5002b98716d68c4bd9edb8e64d7110ff8d28`)
has 32 native entries; its largest is 140,693,272 bytes, above the previous
128 MiB shared bound. This establishes the scoped size failure, not complete
notice coverage or a qualified app artifact.

`CAFEBABE` also identifies JVM class bytes. After valid universal-native tables
are checked first, the reader recognizes JVM structure independently of the
filename: known version/pool tags and references, member and attribute framing,
and exact EOF/CRC within the existing 128 MiB nested-input bound. It does not
execute or semantically verify bytecode. Malformed or unknown ambiguous inputs
still fail. The pinned [Kotlin producer](https://github.com/Kotlin/kotlinx.coroutines/blob/1.10.2/kotlinx-coroutines-core/jvm/src/debug/internal/AgentPremain.kt#L40)
uses `DebugProbesKt.bin` as class bytes; this is a format distinction, not an
archive-member exclusion or a notice-coverage approval.

Zero-byte notice members are reported separately as `emptyNotices` with their
logical source, zero length, empty SHA-256 and verified ZIP CRC. They never enter
the notice text list or resource-coverage map. Maven component `nativeInputs`
binds those records and the verified source archive hash; a changed or dropped
record invalidates its review. A component without actual text remains
`missing-notice-text`, even with a ledger entry. Other text and vendored sources
still require the normal explicit review. Final evidence retains empty records
separately, and an empty file cannot satisfy a required nonempty notice resource.
Nonempty invalid text and all existing archive/size limits remain strict.

The Gradle init script requires an explicit absolute `noticeMainProjectRoot` and
compares canonical project directories before registering its task. Other
included builds are skipped; a missing `:app` on the selected root still fails.
Android discovery setup uses a best-effort ERR trap to call the existing CLI's
`setup-failure android --phase prebuild|gradle-resolution` mode. This writes only
`stage:setup` and fixed phase/`command-failed` fields to the same `failure.json`.
It neither interprets raw command output nor guesses the cause. The trap always
exits with the original nonzero setup status, including if metadata writing
fails. The fixed metadata upload remains separate from public notice bodies.
If reached, the existing Gradle collector adds only a fixed root-binding,
task-registration, runtime-resolution or artifact-collection phase and a closed
public/base Throwable class. A standard `getCause()` chain includes at most eight
entries, starting with the thrown object; each contains only that closed class
enum and the SHA-256 of its fully qualified class name. Identity cycles, the
eight-entry limit and throwing cause getters have fixed termination labels.
Gradle 9.3.1's [multi-cause implementation](https://github.com/gradle/gradle/blob/v9.3.1/platforms/core-runtime/stdlib-java-extensions/src/main/java/org/gradle/internal/exceptions/DefaultMultiCauseException.java#L111)
exposes only the first cause through `getCause()`, so this does not enumerate all
resolution failures or prove a root cause. It reads no raw class name into the
report, exception message or stack and always rethrows the same Throwable; a
failed/outside-workspace metadata write is ignored.
Only the observed exact Gradle 9.3.1 `ArtifactSelectionException` can add optional
selection metadata: failure-class SHA, a fixed module/main-project kind and a
component SHA. Module identity is `maven:group:module@version`; main-project
identity is `gradle-project:` plus its build path, `:` and project path, after
checking the actual main root/project binding. Getters are contained; unknown,
unreadable or competing leaves omit this context. No display name, attribute,
variant, message or raw coordinate is emitted. This identifies a failure family
and component fingerprint, not a successful resolution or a demonstrated cause.
The shell writer retains this context only after exact schema, source and enum
validation, then reconstructs the finite report. Failures before these callbacks
or during other Gradle/plugin configuration still have only the generic setup
phase; absence of collector context is not evidence the collector caused them.
No listener, service, configuration-cache setting, resolution or task gate is added.

This uses Gradle's public [root project](https://docs.gradle.org/current/javadoc/org/gradle/api/invocation/Gradle.html#getRootProject())
and [project directory](https://docs.gradle.org/current/javadoc/org/gradle/api/Project.html#getProjectDir()) APIs.
The source-only root guard regression executes this actual init script through
`groovy.ui.GroovyMain scripts/notices-runtime-root.test.groovy scripts/notices-runtime.init.gradle`
with the installed Gradle distribution's `lib/*` and `lib/plugins/*` on the Java classpath. It stubs
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
Generated Metro sources permit only the known `__prelude__` and Expo CLI’s exact
NUL-prefixed `polyfill:external-require`, `polyfill:environment-variables` and
`polyfill:assets-registry` IDs, with their exact
installed generator path/hash. The Expo provider additionally pins its exact
installed package path, name and version against package-lock and the committed
component ID. The same pinned native polyfill function registers `external-require` and
`environment-variables`;
the app imports the MaterialCommunityIcons TTF, whose generated asset registry
require is intercepted by the pinned resolver into the third. Source-only tests
exercise those actual provider functions in memory without Metro or dynamic
environment values. These are technical generated-source mappings, not reviewed notice
coverage; the component ledger remains empty. Other virtual IDs are not accepted
by a NUL/path wildcard. Final native files not identified from resolved AARs require an exact
platform/path `packagedNative` mapping with covered `components` and a pinned
`review` reference. Packaged-native mappings remain empty until reviewed discovery.

Metro inputs are selected files, not every declared or installed package. Nested
packages have their own licence boundary. CocoaPods inputs include resolved pod
versions, generated acknowledgements, actual source notice files and vendored
framework/library names. Raw Pod lock/plist/notice bytes must be valid UTF-8;
invalid bytes are rejected before decoding, never repaired. A framework symlink
may cross a Pod sandbox only when its exact literal path appears in the hashed
CocoaPods xcframework input list and its target belongs to the locked external
podspec's installed npm package. The link target, owning package, podspec and
selected target bytes are fingerprinted. Undeclared links, targets outside that
package and nested links escaping the selected framework remain rejected; a
declared link does not supply the vendor's licence. Gradle inputs are the
actual release runtime resolution and artifact hashes. External module archives
use a strict module-only Gradle artifact view;
the unfiltered resolution graph still supplies every selected local project's
build/source/CMake inputs. No local AAR is required or silently approved before
it is built. Unknown graph identifiers, missing projects and module-resolution
errors still fail; no leniency, attribute override or variant reselection is used.
A shared bounded scanner walks Pods and autolinked Gradle native subtrees, fingerprints source files, and
finds source-only `vendor`/`third_party` children as well as binary vendors.
Native roots are restricted to installed packages, Pods and identified local
modules; arbitrary project data is not traversed.
The two literal RN 0.86.3 roots `ReactAppDependencyProvider` and `ReactCodegen`
under `ios/build/generated/ios/` also require their exact Podfile.lock declaration,
locked producer package/config/template hashes and selected input fingerprints.
The Provider must contain exactly its three expected template-derived files.
ReactCodegen requires actual autolinking JSON with the pinned nine dependency
configs, seven configured spec-source trees and platform podspecs, no app-level
codegen config or native component crawler, plus separate RN core/spec evidence.
A test invokes the pinned selector to prove this selection path; no missing
metadata is replaced with guessed dependency discovery. Raw autolinking bodies
and absolute roots stay private; only logical package/version identities and
hashes enter reports. Unknown roots, changed pins and escaping links reject.
All output bytes are fingerprinted, and each input owner remains a separate
vendor boundary needing explicit notice review; admitting a generated source
does not inherit a producer's licence or complete the empty approval ledger.
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
