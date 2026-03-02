#!/bin/bash
# Screenshot content verification test
#
# Uses hj CLI to click color buttons and verify screenshots contain actual image data.
# Requires: haltija server running with a browser connected to the playground.
#
# Usage:
#   hj test-run tests/playground.json   # run DOM tests first
#   bash tests/screenshot-verify.sh     # then run this

set -euo pipefail

HJ="${HJ:-npx hj}"
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

# Strip ANSI escape codes from hj output
strip_ansi() { perl -pe 's/\e\[[0-9;]*m//g'; }

# Get the Electron window ID (screenshots only work in the desktop app)
get_electron_window() {
  $HJ windows --json 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
for w in d if isinstance(d, list) else d.get('windows', []):
    wid = w.get('id', '')
    if wid.startswith('hj-'):
        print(wid)
        sys.exit(0)
print('')
" 2>/dev/null
}

echo "Screenshot verification tests"
echo "=============================="

WINDOW=$(get_electron_window)
if [[ -z "$WINDOW" ]]; then
  echo "SKIP: No Haltija Desktop app window found."
  echo "Screenshots require the desktop app. Run: npx haltija@latest -f"
  exit 0
fi
WINDOW_ARG="--window $WINDOW"
echo "Using Electron window: $WINDOW"

# Navigate to playground
$HJ navigate http://localhost:8700 $WINDOW_ARG > /dev/null
sleep 0.5
$HJ click '[data-tab="playground"]' $WINDOW_ARG > /dev/null
sleep 0.3

# Helper: take screenshot targeting Electron window, return clean path
take_shot() {
  $HJ screenshot $WINDOW_ARG 2>/dev/null | head -1 | strip_ansi
}

# --- Test 1: screenshot returns a file path ---
echo ""
echo "1. Screenshot saves to disk"
SCREENSHOT_PATH=$(take_shot)
if [[ "$SCREENSHOT_PATH" == /tmp/haltija-screenshots/hj-*.png ]]; then
  pass "path matches expected pattern"
else
  fail "unexpected path: '$SCREENSHOT_PATH'"
fi

# --- Test 2: file exists and is a valid PNG ---
if [[ -f "$SCREENSHOT_PATH" ]]; then
  pass "file exists on disk"
  MAGIC=$(xxd -l 4 -p "$SCREENSHOT_PATH")
  if [[ "$MAGIC" == "89504e47" ]]; then
    pass "valid PNG magic bytes"
  else
    fail "not a valid PNG (magic: $MAGIC)"
  fi
  SIZE=$(stat -f%z "$SCREENSHOT_PATH" 2>/dev/null || stat -c%s "$SCREENSHOT_PATH" 2>/dev/null)
  if [[ "$SIZE" -gt 1000 ]]; then
    pass "file size ${SIZE} bytes (> 1KB)"
  else
    fail "file too small: ${SIZE} bytes"
  fi
  rm -f "$SCREENSHOT_PATH"
else
  fail "file does not exist: $SCREENSHOT_PATH"
fi

# --- Test 3: click red, screenshot, verify different from default ---
echo ""
echo "2. Screenshot changes after background color change"
BASELINE=$(take_shot)

$HJ click '#bg-red' $WINDOW_ARG > /dev/null
sleep 0.3
RED_SHOT=$(take_shot)

if ! cmp -s "$BASELINE" "$RED_SHOT"; then
  pass "red background screenshot differs from baseline"
else
  fail "screenshots are identical — color change not captured"
fi

# --- Test 4: different colors produce different screenshots ---
echo ""
echo "3. Different colors produce different screenshots"
$HJ click '#bg-blue' $WINDOW_ARG > /dev/null
sleep 0.3
BLUE_SHOT=$(take_shot)

if ! cmp -s "$RED_SHOT" "$BLUE_SHOT"; then
  pass "red and blue screenshots differ"
else
  fail "red and blue screenshots are identical"
fi

# --- Test 5: --data-url returns base64 instead of file ---
echo ""
echo "4. --data-url flag returns base64 data"
DATA_URL_OUT=$($HJ screenshot --data-url --json $WINDOW_ARG 2>/dev/null)
if echo "$DATA_URL_OUT" | grep -q '"image"'; then
  pass "--data-url returns image field in JSON"
else
  fail "--data-url did not return image field"
fi
if echo "$DATA_URL_OUT" | grep -q 'data:image/png;base64,'; then
  pass "image is a valid data URL"
else
  fail "image is not a data URL"
fi

# --- Test 6: reset background ---
echo ""
echo "5. Reset restores original appearance"
$HJ click '#bg-reset' $WINDOW_ARG > /dev/null
sleep 0.3
RESET_SHOT=$(take_shot)
if ! cmp -s "$BLUE_SHOT" "$RESET_SHOT"; then
  pass "reset screenshot differs from blue"
else
  fail "reset screenshot identical to blue"
fi

# Cleanup
rm -f "$BASELINE" "$RED_SHOT" "$BLUE_SHOT" "$RESET_SHOT"

echo ""
echo "=============================="
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
