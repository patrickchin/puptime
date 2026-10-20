#!/usr/bin/env bash
# Qualify the existing standalone on a newly created disposable simulator only.
# No existing device UUID is accepted, reused, reset, or shut down.
set -euo pipefail
cd "$(dirname "$0")/.."
release="${1:-$PWD/build/ios-simulator/Build/Products/Release-iphonesimulator/Puptime.app}"
output="${2:-$PWD/build/ios-history-results}"
test -d "$release"
if [ -d "$output" ] && [ -n "$(ls -A "$output")" ]; then
  printf 'Choose a fresh history evidence directory: %s\n' "$output" >&2
  exit 1
fi
mkdir -p "$output"
output="$(cd "$output" && pwd)"
mkdir -p "$output/tmp"
iphone_id=''
observer_directory=''
cleanup() {
  result=$?
  trap - EXIT
  if [ -n "$iphone_id" ]; then
    if [ "${PUPTIME_HISTORY_RELOAD_PROBE:-0}" = 1 ]; then
      container=$(xcrun simctl get_app_container "$iphone_id" com.patrickchin.puptime data 2>> "$output/reload-probe-collection.log") || container=''
      if [ -n "$container" ] && [ -f "$container/Documents/history-reload-probe.json" ]; then
        cp "$container/Documents/history-reload-probe.json" "$output/history-reload-probe.json" || true
      else
        printf 'History Reload probe unavailable; retain qualification failure and native artifacts.\n' >> "$output/reload-probe-collection.log" || true
      fi
    fi
    xcrun simctl shutdown "$iphone_id" >> "$output/device-cleanup.log" 2>&1 || true
    if [ "${PUPTIME_KEEP_HISTORY_SIMULATOR:-0}" != 1 ]; then
      xcrun simctl delete "$iphone_id" >> "$output/device-cleanup.log" 2>&1 || true
    fi
  fi
  if [ -n "$observer_directory" ]; then rm -rf "$observer_directory" || true; fi
  printf '%s\n' "$result" > "$output/exit-code.txt"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Use Node24 or later for native SQLite qualification.")'
codesign --verify --deep --strict "$release"
if [ "${PUPTIME_HISTORY_RELOAD_PROBE:-0}" = 1 ]; then
  node --test scripts/native-activity-probe/reload-probe.test.cjs > "$output/reload-observer-tests.log" 2>&1
  # Instrument a private copy only. The ordinary signed Release remains the
  # artifact used by the app suite, store screenshots and simulator download.
  observer_directory=$(mktemp -d "${TMPDIR:-/tmp}/puptime-history-reload.XXXXXX")
  ditto "$release" "$observer_directory/Puptime.app"
  original_release="$release"
  release="$observer_directory/Puptime.app"
  PUPTIME_HISTORY_RELOAD_PROBE=1 \
    EXPO_OVERRIDE_METRO_CONFIG="$PWD/scripts/native-activity-probe/metro.config.cjs" \
    npx expo export:embed --entry-file "$PWD/index.ts" --platform ios --dev false --minify false \
    --bundle-output "$observer_directory/main.jsbundle" --assets-dest "$release" --max-workers 2 \
    > "$output/reload-observer-build.log" 2>&1
  grep -q 'history-reload-probe.json' "$observer_directory/main.jsbundle"
  node_modules/hermes-compiler/hermesc/osx-bin/hermesc -emit-binary -O \
    -out "$release/main.jsbundle" "$observer_directory/main.jsbundle" >> "$output/reload-observer-build.log" 2>&1
  codesign --force --deep --sign - "$release" >> "$output/reload-observer-build.log" 2>&1
  codesign --verify --deep --strict "$release"
  node - "$original_release" "$release" "$output/reload-observer-source.json" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const [original,observed,output]=process.argv.slice(2),hash=app=>crypto.createHash('sha256').update(fs.readFileSync(app+'/main.jsbundle')).digest('hex');
fs.writeFileSync(output,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),originalBundleSha256:hash(original),observedBundleSha256:hash(observed),scope:'Qualification-only Reload touch/press/handler/state observer on a copy of the CI Release; original app artifact retained.'},null,2));
NODE
fi
runtime_id=$(xcrun simctl list runtimes -j | jq -r '[.runtimes[] | select(.isAvailable and (.identifier | contains("iOS-26")))][-1].identifier // empty')
test -n "$runtime_id"
iphone_id=$(xcrun simctl create "Puptime Native Storage ios-history-ui CI ${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro "$runtime_id")
printf '%s\n' "$iphone_id" > "$output/device-uuid.txt"
xcrun simctl boot "$iphone_id"
xcrun simctl bootstatus "$iphone_id" -b
xcrun simctl install "$iphone_id" "$release"
# Keep the qualifier's seed, screenshots, SQL assertions and diagnostics inside
# the always-uploaded artifact even if a Maestro command fails before its summary.
qualification=(node scripts/verify-ios-history.mjs "$iphone_id" --replace-synthetic --local)
if [ -n "${PUPTIME_HISTORY_REVIEW_VIDEO:-}" ]; then
  qualification=("${PUPTIME_REVIEW_PYTHON:-python3}" scripts/record-ios-review.py \
    "$iphone_id" "$PUPTIME_HISTORY_REVIEW_VIDEO" \
    'Standalone local log-history acceptance' \
    "Fresh dedicated simulator · Reload observer ${PUPTIME_HISTORY_RELOAD_PROBE:-0} · free local history" \
    -- "${qualification[@]}")
fi
TMPDIR="$output/tmp" MAESTRO_CLI_NO_ANALYTICS=1 \
  "${qualification[@]}" \
  2>&1 | tee "$output/qualification.log"
