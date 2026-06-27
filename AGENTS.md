# Agent Instructions

This project tracks issues and roadmap notes in **`TODO.md`** (free-form: build/distribution
items, multi-phase plans, known bugs). There is no separate issue-tracker tool — keep `TODO.md`
current as you work.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **Note remaining work** - Add anything that needs follow-up to `TODO.md`
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update `TODO.md`** - Check off finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

## Cutting a beta release

When the user asks for a new beta (e.g. "cut beta.N"), follow this sequence.
Several steps have non-obvious gotchas that have burned us — they're called out
inline.

1. **Bump the version** in `package.json` (root). Also bump
   `apps/desktop/package.json` to match — the `sync-version` script inside
   `npm run build:mac` does this automatically, but doing it up front means one
   less commit later.

2. **Rebuild**: `bun run build`. This regenerates `src/version.ts`,
   `src/embedded-assets.ts`, the `dist/` bundles, and the copy of
   `apps/desktop/resources/component.js` that ships in the DMG. Verify
   `src/version.ts` shows the new version.

3. **Run unit tests**: `bun test src/` — must be 100% green before tagging.

4. **Commit the version bump**. Title: `chore: bump version to 1.3.0-beta.N`.
   Body: a one-bullet-per-meaningful-commit summary of what's new since the
   previous beta.

5. **Build the notarized DMGs** from `apps/desktop/`:

   ```bash
   cd apps/desktop && \
     APPLE_API_KEY_ID="$APPLE_API_KEY" \
     APPLE_API_KEY="$APPLE_API_KEY_PATH" \
     npm run build:mac
   ```

   **Gotchas:**
   - **Env-prefix order matters.** Bash expands left-to-right *and* commits
     each assignment before the next, so the second prefix sees the first's
     overwrite. Set `APPLE_API_KEY_ID` *first* (using the unchanged
     `$APPLE_API_KEY`), then overwrite `APPLE_API_KEY` with the file path. If
     you reverse the order, notarytool gets the `.p8` path as the key ID,
     Apple returns an HTTP error, and `@electron/notarize` fails parsing it
     as JSON with `Unexpected token 'E', "Error: HTT"...`.
   - **`electron-builder` uses different env conventions than `xcrun
     notarytool` directly.** electron-builder wants `APPLE_API_KEY` = path to
     the `.p8` file and `APPLE_API_KEY_ID` = the key id. The shell vars
     already exported on Tonio's machine (`APPLE_API_KEY` = the id,
     `APPLE_API_KEY_PATH` = the file) are shaped for direct `notarytool` use,
     hence the inline remap above.
   - **Apple may demand a freshly-signed license agreement** at unpredictable
     intervals. Symptom: `xcrun notarytool` returns
     `HTTP status code: 403. A required agreement is missing or has expired.`
     Fix: log into <https://developer.apple.com/account/> (and/or App Store
     Connect → "Agreements, Tax, and Banking") as the Account Holder, accept
     the pending one. There's a propagation delay of a few minutes; poll
     `xcrun notarytool history --key "$APPLE_API_KEY_PATH" --key-id
     "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER"` until it stops 403-ing.
   - **`codesign` sometimes errors with `A timestamp was expected but was not
     found`** mid-signing — Apple's timestamp server is occasionally flaky.
     This is transient; just rerun the build.
   - **Build outputs** land in `apps/desktop/dist/`: `Haltija-<version>.dmg`
     (Intel x64), `Haltija-<version>-arm64.dmg`, plus matching ZIPs.

6. **Drop deterministic build noise** before tagging — `apps/desktop/icons/*`
   and `apps/desktop/resources/Assets.car` get touched by every `npm run
   icons` pass but the bytes don't meaningfully change:
   ```bash
   git checkout HEAD -- apps/desktop/icons apps/desktop/resources/Assets.car
   ```

7. **Tag** with an annotated message that doubles as the release-note seed:
   ```bash
   git tag -a v1.3.0-beta.N -m '...'
   ```

8. **Push commits and the tag**:
   ```bash
   git push origin main
   git push origin v1.3.0-beta.N
   ```

9. **Distribute the DMGs.** Tonio uploads them to an iCloud folder he shares
   with beta testers — do NOT attach them to the GitHub release, and do NOT
   commit them to the repo. They're ~140 MB each.

10. **Create the GitHub pre-release** (notes-only, no binaries):
    ```bash
    gh release create v1.3.0-beta.N \
      --title 'v1.3.0-beta.N — <one-liner>' \
      --notes-file /tmp/release-notes.md \
      --prerelease
    ```

11. **`npm publish --tag beta`** from the repo root. The `--tag beta` flag is
    critical — without it, npm marks the beta as `latest` and bare
    `npm install haltija` would pull a pre-release. Verify with `npm whoami`
    if it's been a while since the last publish.
