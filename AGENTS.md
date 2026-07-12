# Agent Instructions

> **Shared engineering practices** live at
> **https://github.com/tonioloewald/tosijs-coding-practices** — and, when checked out beside this
> repo, at [`../tosijs-coding-practices`](../tosijs-coding-practices/README.md). Read that index
> first for the cross-project defaults. **Session completion ("landing the plane"), the canonical
> release flow, and the review gate all live there** —
> [`practices/releasing.md`](../tosijs-coding-practices/practices/releasing.md) and
> [`practices/review.md`](../tosijs-coding-practices/practices/review.md). This file records only
> what is **specific to or divergent from** those defaults; when they conflict, this file wins.
> Same contract as `CLAUDE.md`, which has the architecture.

This project tracks issues and roadmap notes in **`TODO.md`** (free-form: build/distribution
items, multi-phase plans, known bugs). There is no separate issue-tracker tool — keep `TODO.md`
current as you work.

**Pushing is not gated to a human here.** A session is not done until `git push` succeeds — see
["Landing the plane"](../tosijs-coding-practices/practices/releasing.md#landing-the-plane--session-completion).
`npm publish`, by contrast, is usually left to Tonio; ask rather than assume.

## Releases

The sequence lives upstream under
[Project-specific practices → haltija](../tosijs-coding-practices/practices/releasing.md#haltija-npm--electron-dmg).
The short version: bump **both** `package.json` files → `bun run build` → `bun test src/` 100%
green → commit → annotated tag → push commits **and** tag → `gh release create` → `npm publish`.

Before a **minor or major** bump, run `/pre-release-review` (the eight-lens adversarial review
gate). Patch releases don't require it.

Haltija-specific notes not worth upstreaming:

- **Betas** add two flags — `gh release create --prerelease` and `npm publish --tag beta`. Get
  them right in both directions; upstream explains why.
- The **annotated tag message doubles as the release-note seed** — write it as prose you'd be
  happy to publish, then expand it into `gh release create --notes-file`.
- **Commit body** for a release: one bullet per meaningful commit since the last one.
- Run **`npm whoami`** before publishing if it's been a while.
- `bun run build` regenerates `src/version.ts`, `src/embedded-assets.ts`, the `dist/` bundles,
  and the `apps/desktop/resources/component.js` copy that ships in the DMG. Verify
  `src/version.ts` shows the new version. It also regenerates the schema-derived docs, which CI
  (`docs-drift`) will fail on if they're stale — see `CLAUDE.md` → CI / QA.

### Building a standalone DMG (on demand only)

**Not part of the standard beta loop.** The npm package (`bunx haltija`) is the
paved path — for local dev/debugging you run a per-project server and drive it
with `hj`/Claude Code, and CI uses `--headless`/`--ci`. The notarized standalone
DMG is only for beta testers who want a click-to-run app without Node/Bun
installed; we haven't needed a fresh one in months. Build it only when someone
specifically asks. When you do, from `apps/desktop/`:

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
- **Drop deterministic build noise** afterward — `apps/desktop/icons/*` and
  `apps/desktop/resources/Assets.car` get touched by every `npm run icons`
  pass but the bytes don't meaningfully change:
  ```bash
  git checkout HEAD -- apps/desktop/icons apps/desktop/resources/Assets.car
  ```
- **Distribute** by uploading to the iCloud folder shared with beta testers —
  do NOT attach DMGs to the GitHub release, and do NOT commit them to the repo.
  They're ~140 MB each.
