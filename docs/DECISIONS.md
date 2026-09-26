# Decisions and records

Design records, measured decisions and release history that used to live in `TODO.md`. Moved
here (2026-09-26) when the backlog went onto the virta board, so they keep their reasons without
being imported as tasks. Records, not work: nothing here is a task.

## 1.12.2 — RELEASED (2026-08-11)

Tagged `v1.12.2`. Lanes green at the tag: 825 unit, 123 e2e, QA fixtures (playground 26, homepage
15), `hj doctor` exit 0, docs-drift clean. **Publish: `npm publish`** — that is the whole command;
a plain publish sets `latest` itself.

- **#30** the suite runner gained `drag` (the routine moved to `src/drag.ts` so `/drag` and the
  runner share it), a `wait` with nothing to wait for is now an ERROR instead of a silently passing
  guard, and `TEST_STEP_ACTIONS` is published + enforced by a both-directions test against the
  runner's switch. Writing that guard found `screenshot` documented in SKILL.md as a step action
  that never existed.
- **#31** `--private` now gives each instance its own Electron profile. Sharing one made the second
  instance ~10x slower and produced a **false version regression** in side-by-side A/B — the one
  workflow private mode exists for. Also stopped private runs writing the shared
  `~/.haltija/last-quit`, and added a startup sweep for stale private scratch.

**Still open, deliberately: [#26](https://github.com/tonioloewald/haltija/issues/26).** The
reporter's control run disproved the "1.12.0 regression" framing — the known-bad version survived
the original failing surface. A permanently-undrivable tab was really observed, so it stays open,
but neither of us can reproduce it on any version and 1.12.2 claims no fix.

**The pattern across the whole 1.12.x line, worth carrying into 1.13:** every one of these was ONE
idea with TWO implementations and only one of them updated — `/type`'s `ref`, `/map`'s parameters,
`:text()` vs `/find`, the CLI's `hj wait` vs the runner's `wait`, the runner's action list, and the
drag routine. The fix that sticks is a test that derives one registry from the other; the fix that
doesn't is patching the instance you were shown.

## Naming: measured, not argued (`tools/naming-probe.mjs`)

An instrument that asks fresh agents what our vocabulary *means to them*, in the spirit of the
tjs-lang intuitiveness harnesses. **Not a CI gate** — real model calls, non-deterministic, and a
flaky naming test would be switched off within a week. Run it when changing the vocabulary; read the
distribution, not the score.

**First run (n=3) overturned three of my four hand-waved claims**, which is the whole argument for
measuring instead of asserting:

| claim | verdict |
| --- | --- |
| `check` is dangerously confusable with `assert` | **PARTLY RIGHT — the first verdict was contaminated.** In context, fine: 3/3 pick `assert` for an assertion, 3/3 pick `check` for a checkbox. Cold, from a NEUTRAL cwd: **3/3 read it as "asserts a condition is true"**. The original 2/3-correct cold read came from our own CLAUDE.md being in the agent's context. |
| `verify` vs `assert` is arbitrary | **MOSTLY WRONG, weaker than first measured.** 2/3 picked `verify` (was 3/3 contaminated); 1 said `wait`. |
| `tabs-focus` misleads (sounds like a browser action) | **WRONG.** 3/3 picked it correctly. |
| `select` is mis-assigned | **CONFIRMED, unanimously.** 3/3 reached for `select` to choose a dropdown option; 3/3 cold-read it as "choose an `<option>`". **Nobody** read it as text selection. |

So the rename list collapses from four to one.

- [x] **`select` → `select-text`, with `select` as a deprecated alias.** Then, once the alias can be
  dropped, `select` is free to mean the thing every reader already thinks it means: pick an option
  from a `<select>`. That is also a real capability gap — haltija has no way to choose a dropdown
  option today, which is why the probe's honest expected answer was "none".
  Sequencing matters: the alias and the new meaning must not overlap, or one word means two things
  at once and we are back to a silent wrong action.
- [ ] **`map` is not the word agents reach for — and `map` is where every doc tells them to start.**
  Measured twice, two framings, and it lost both times: "list everything you can interact with and
  what each control is wired to" got **3/3 `form`** (the word "control" pulls toward form fields);
  neutrally reworded to "orient yourself on an unfamiliar page — which command first?" it got
  **`tree`**. `map` never won. The affordance map is the single most valuable thing haltija offers
  an agent, and its name is losing to two neighbours. Options: rename it something that says what it
  is, or accept that `tree` is the natural entry point and make `tree` the thing that leads to it.
  Worth more samples before acting — n=3 and n=1.
- [x] Probe the **CLI command** vocabulary — done. `find`, `where`, `doctor`, `snapshot` all scored
  3/3; `snapshot` vs `screenshot` and `call` vs `eval` were both read correctly cold. Those names
  are fine and need no defending prose.

## 1.12.6 — TAGGED, awaiting publish

**STANDING POLICY WHILE UNPUBLISHED: keep MOVING the `v1.12.6` tag, do not mint new versions.**
Nothing is on npm (`latest` is 1.12.5), so there is no released artifact to preserve and a forced
tag move costs nobody anything. Minting 1.12.7, 1.12.8 … for work nobody can install is exactly the
version churn we are trying to stop. When a fix lands on `main`:

```
git tag -f -a v1.12.6 -m "1.12.6" HEAD && git push --force origin v1.12.6
```

`package.json` already reads 1.12.6, so no bump is involved. This ends the moment it is published —
after that, a moved tag would rewrite a released artifact and every subsequent fix is a new patch.

There is a second reason beyond tidiness: a tag left on a commit with a known hole is a runnable
vulnerable checkout. The tag was briefly pointing at the pre-security-fix release commit; moving it
removed that.

`v1.12.6` is tagged with all lanes green. **Publish: `npm publish`** — that is the whole command.

**A PATCH, deliberately.** Nothing here breaks: no path removed, no surface renamed, and every
behaviour that changed was already broken (LAN access, wss recording, tokened page calls). New
capability ships as a patch per this repo's rule; minors are for when the nine-lens gate has run.

Contents: Electron 40 → 43 and the MCP re-lock (both security), electron-builder dropped entirely
(271 transitive packages, five advisories, for packaging nothing exercises), three silent
"page cannot reach the server" failures, and `hj session` — mirror an agent's tmux terminal into the
browser channel, read plus an opt-in write.

**The session-surface review HAPPENED** (adversarial, security-focused) and found the feature
exploitable by an anonymous caller — attach with `allowInput` then write, landing text on a
privileged agent's stdin; plus `send-keys` without `-l` synthesising keys rather than typing text
(`C-c` killed a running process). Both fixed and reproduced before and after. `/session/*` now
refuses without a token. See #40 for the broader posture finding it surfaced, which is NOT fixed.

**Superseded note (kept for the record):** a nine-lens review of the session
surface. It is the most security-sensitive thing haltija has shipped — it reads an agent's terminal
and, with a grant, types into it — and the grant model was designed and argued for by the same
person who implemented it. Shipping first was a deliberate call to stop churning version numbers,
not a judgement that review is unnecessary.

## Design principles these all serve

- **Token burn is not an expense, it's brain damage.** An agent that spends 10k tokens on a DOM
  dump doesn't just *pay* 10k tokens — it is measurably worse at reasoning for the rest of the
  session, and in a long autonomous build that's what actually ends the run. "Minimize token burn"
  really means **"preserve the agent's reasoning capacity across a long loop."** Same thesis as
  everything else here: high signal, low volume, honest.
- **Pixels are a terrible oracle.** A screenshot of a 3D scene says "that looks wrong" and nothing
  else. What's needed is the scene graph — camera alpha/beta/radius, FOV, which animation group is
  at which frame, how many meshes loaded, whether the light exists. A screenshot-and-click tool
  **structurally cannot see that**; it isn't a few features behind, it's on a design path that
  cannot reach 3D. An eval-first API can ask *"radius is 12, should be 3."*
- **An agent's ceiling is set by the fidelity and honesty of its feedback.** What gates an agent
  building real UI isn't code generation, it's whether **its model of the running page is true.**
  Interrogation, not observation, is what closes the loop on real bugs instead of pixels. This is
  the same idea as settle-based assertions and instrument-must-not-lie — they are one idea.
- **Multi-tenancy plumbing is not housekeeping competing with the high bar — it is the
  precondition for the high bar holding when twenty agents run at once.** In a 45-minute
  autonomous build, one cross-tenant read means the agent builds on a false premise for the next
  forty minutes with no signal that anything is wrong.

### The through-line (tosijs-project's framing — worth putting on the README)

> The differentiator isn't access to a browser, it's the ability to **hold a running UI at an
> arbitrary point in its state space and interrogate it.** Claude-in-Chrome gives an agent
> hands. Playwright gives it a script. **Neither gives it instruments.**

That's an unoccupied niche and it's exactly the shape of the bugs this stack produces. Note it
sharpens Tonio's positioning rather than replacing it: a UI build/test tool, whose distinctive
verb is *instrument*, not *drive*.

### Foundational, not a feature: an instrument must not lie

> "When the tab vanished mid-probe, my measurements didn't fail loudly — they went **ambiguous**,
> and I couldn't tell 'the map is broken' from 'my instrument is broken.' An instrument that lies
> is worse than no instrument." — tosijs-project

This bites harder for a debugging tool than a browsing one, and it's a **correctness** property,
not a nice-to-have. What I verified against 1.4.0 (so this list is evidence, not speculation):

- [x] With **no browser connected**, `/eval` returns `{success:false, error:"No browser
      connected…"}` and plain `hj` exits **1**. The loud signal exists for that case.
- [x] **`hj … --json` printed the failure envelope and then exited 0** — so an agent checking
      the exit code (which is how a harness decides whether a step worked) saw *success* while
      the payload said failure. Fixed in 1.4.0: `--json` now exits 1 when `success:false`.
      *(Correction: I first filed this as "`--json` prints nothing", from a measurement where
      I put `--json` before the subcommand, where it isn't parsed. The review had it right and
      I had it wrong. Worth keeping visible — a false finding from a mis-run instrument, in the
      middle of a thread about instruments that lie.)*
- [ ] **The mid-probe case is untested and is the one that actually bit.** Losing the browser
      *during* an in-flight request is a different path from having none at the start. Needs a
      test that drops the WebSocket mid-`/eval` and asserts the response is an unambiguous,
      machine-readable "I lost the browser" — never a timeout that reads like a slow page, and
      never a partial result.
- [ ] **Liveness in the response envelope.** Every result should be able to say *which* window it
      was measured against and that the window was still alive when the value was taken —
      otherwise a scrub/sample table can silently contain readings from a tab that died halfway.
