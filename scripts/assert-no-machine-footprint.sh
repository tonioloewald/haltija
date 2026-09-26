#!/usr/bin/env bash
# Fail if a test run touched machine-scope state. Run on a FRESH CI runner after a suite.
#
# The suites spawn real haltija servers, and a spawned server re-reads the real $HOME. Every spawn
# site must use `isolatedServerEnv` (src/test-ports.ts); this catches the one that doesn't.
#
# ~/.haltija is checked WHOLE, not path by path. The previous gate listed `servers/` and missed
# `certs/` when 1.13.0 put a machine-level certificate there, so e2e runs wrote a private key into
# the real home and the gate stayed green. A list can only omit the next thing.
set -u
fail=0

if [ -e "$HOME/.local/bin/hj" ]; then
  echo "FAIL: the test suite installed hj onto the PATH (a spawn site is missing HALTIJA_NO_INSTALL=1)."
  fail=1
fi

if [ -d "$HOME/.haltija" ] && [ -n "$(find "$HOME/.haltija" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  echo "FAIL: the test suite wrote into the real ~/.haltija (registry, receipt log or certificates):"
  find "$HOME/.haltija" -mindepth 1 | sed 's/^/  /'
  echo "A spawn site is not using isolatedServerEnv (src/test-ports.ts)."
  fail=1
fi

# Artifacts are the write that DELETES: saving one prunes the directory (>24h, keep 200), so a
# test writing to the real one removed the developer's screenshots.
REAL="${TMPDIR:-/tmp}"
for d in screenshots schematics videos; do
  if [ -d "${REAL%/}/haltija-$d" ]; then
    echo "FAIL: the test suite created the REAL artifact directory ${REAL%/}/haltija-$d (missing HALTIJA_ARTIFACT_DIR)."
    fail=1
  fi
done

[ "$fail" = 0 ] && echo "No machine-scope footprint."
exit "$fail"
