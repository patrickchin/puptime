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
cleanup() {
  result=$?
  trap - EXIT
  if [ -n "$iphone_id" ]; then
    xcrun simctl shutdown "$iphone_id" >> "$output/device-cleanup.log" 2>&1 || true
    if [ "${PUPTIME_KEEP_HISTORY_SIMULATOR:-0}" != 1 ]; then
      xcrun simctl delete "$iphone_id" >> "$output/device-cleanup.log" 2>&1 || true
    fi
  fi
  printf '%s\n' "$result" > "$output/exit-code.txt"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Use Node24 or later for native SQLite qualification.")'
codesign --verify --deep --strict "$release"
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
    'Fresh dedicated simulator · signed default Release · free local history · no account or backend' \
    -- "${qualification[@]}")
fi
TMPDIR="$output/tmp" MAESTRO_CLI_NO_ANALYTICS=1 \
  "${qualification[@]}" \
  2>&1 | tee "$output/qualification.log"
