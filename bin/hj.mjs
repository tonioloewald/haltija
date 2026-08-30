#!/usr/bin/env node
/**
 * hj - Short alias for haltija CLI subcommands
 * 
 * Usage:
 *   hj tree              # DOM tree
 *   hj click @42         # Click by ref
 *   hj type @10 hello    # Type text
 *   hj eval 1+1          # Eval JS
 *   hj status            # Server status
 */

import { runSubcommand, isSubcommand, getSuggestion, listSubcommands, COMMAND_HINTS, COMMAND_SUMMARIES } from './cli-subcommand.mjs'
import { extractWindowTarget } from './arg-utils.mjs'
import { findProjectOrigins, routeByDeclaredOrigin, ORIGINS_FILE } from './project-origins.mjs'
import { collectCandidates, describeServer, sortRows, labelFor, isAmbiguousTarget } from './server-list.mjs'
import { isDrivable, isVisible, visibilityKnown } from './window-state.mjs'
import { PAINT_STALE_MS } from './tab-liveness.mjs'
import { LOCAL_COMMANDS, LOCAL_COMMAND_HELP } from './cli-commands.mjs'
import { HJ_VERSION } from './version.mjs'
import { differsBeyondPatch } from './semver.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)

/** Commands hj handles itself rather than routing to the server. One source: src/cli-commands.ts. */
const HJ_LOCAL_COMMANDS = new Set(LOCAL_COMMANDS)

// One definition. These were redeclared inside a dozen functions, which is how `green` ended up in
// some outputs and not others — small enough that nobody notices, exactly the kind of duplication
// that quietly diverges.
// Same per-stream gate as bin/cli-subcommand.mjs: colour only when a human is watching THAT
// stream. `hj where`/`hj doctor`/`hj servers` all print machine-readable-ish output here, and
// escape codes in a captured variable are indistinguishable from part of the value.
const colorOut = () => !process.env.NO_COLOR && process.stdout.isTTY
const colorErr = () => !process.env.NO_COLOR && process.stderr.isTTY
const bold = (s) => (colorOut() ? `\x1b[1m${s}\x1b[0m` : String(s))
const dim = (s) => (colorErr() ? `\x1b[2m${s}\x1b[0m` : String(s))
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

/** Where instance entries live. Mirrors DEFAULT_REGISTRY_DIR in src/sessions.ts. */
const REGISTRY_DIR = process.env.HALTIJA_REGISTRY_DIR || join(homedir(), '.haltija', 'servers')

if (args[0] === '--version' || args[0] === '-v') {
  console.log(HJ_VERSION)
  process.exit(0)
}


/**
 * What declared-origin routing will do for this shell, in one line.
 *
 * Declared origins are the answer to "another project's tab keeps answering my commands", and until
 * now neither diagnostic mentioned them. Worse, the warning for a *broken* declaration lived in a
 * block both `where` and `doctor` exit before reaching — so the feature was silent in exactly the
 * two commands SKILL.md names as the first response to "wrong page", and a `.haltija.json` that
 * declared nothing usable was reported nowhere a user would look.
 *
 * Returns `{ line, problem }`: `problem` is set only when the configuration is actively broken,
 * so `doctor` can fail on it while `where` merely reports.
 */
function describeOrigins(windows) {
  const declared = findProjectOrigins(process.cwd(), process.env)
  if (!declared) {
    return {
      line: `${dim('none declared')} ${dim(`— commands follow browser focus; add a ${ORIGINS_FILE} to pin them to your tabs`)}`,
      problem: null,
    }
  }
  if (!declared.origins.length) {
    const msg =
      `${declared.source} exists but declares no usable origins, so per-tab routing is OFF and ` +
      `commands silently fall back to whatever tab has focus — the exact problem it was added to ` +
      `fix. Expected e.g. { "origins": ["http://localhost:3000"] }.`
    return { line: yellow(msg), problem: msg }
  }
  const list = declared.origins.join(', ')
  const routing = routeByDeclaredOrigin(declared.origins, windows || [], null)
  if (routing.kind === 'matched') {
    return { line: `${list} ${dim(`(${declared.source}) → window ${routing.windowId}`)}`, problem: null }
  }
  if (routing.kind === 'no-match') {
    // Not fatal: the tab may simply not be open yet. But say it, because the symptom otherwise is
    // "routing quietly did nothing" and the user has no way to tell configured from working.
    const saw = routing.sawOrigins.length ? routing.sawOrigins.join(', ') : 'none'
    return {
      line: `${list} ${dim(`(${declared.source})`)} ${yellow('— no connected tab matches')} ${dim(`(tabs are on: ${saw}); commands will follow focus until one does`)}`,
      problem: null,
    }
  }
  return { line: `${list} ${dim(`(${declared.source})`)}`, problem: null }
}

/**
 * Print what server this shell is currently targeting and what's alive
 * there. Reports the resolved port, the source of the resolution (flag,
 * env var, or registry lookup), and — if reachable — the server's
 * version, the named-instance label, tab count, and the focused tab.
 * Used as `hj where` (or `hj where --json` for structured output).
 */
async function runWhere(port, portSource, jsonOutput) {
  let serverInfo = null
  let serverError = null
  // Alive but refusing us — tracked separately so neither the label nor the JSON can call it dead.
  let serverAuthRefused = false
  try {
    const resp = await fetch(`http://localhost:${port}/status`, {
      // Send the token. Without it a `--token` server 401s and every branch below describes it as
      // broken or absent — so the command whose entire job is "which server am I talking to?"
      // answered "none" about a server that was running fine and had just replied to us.
      headers: process.env.HALTIJA_TOKEN ? { 'X-Haltija-Token': process.env.HALTIJA_TOKEN } : {},
      signal: AbortSignal.timeout(2000),
    })
    if (resp.ok) {
      serverInfo = await resp.json()
    } else if (resp.status === 401 || resp.status === 403) {
      serverAuthRefused = true
      // Name the actual cause and its remedy. "HTTP 401" sends someone to look at the server;
      // the problem is in this shell.
      serverError = process.env.HALTIJA_TOKEN
        ? `a server IS running here, but it rejected the token in HALTIJA_TOKEN — check the value matches what the server was started with (haltija --token <secret>)`
        : `a server IS running here, but it requires a token and this shell has none — export HALTIJA_TOKEN=<secret> (the value passed to haltija --token), or use hj --token <secret>`
    } else {
      serverError = `HTTP ${resp.status}`
    }
  } catch (err) {
    serverError = err.code === 'ConnectionRefused' || err.cause?.code === 'ECONNREFUSED'
      ? 'no server is listening on this port'
      : err.message
  }
  // Look up the instance name (if any) by scanning ~/.haltija/servers/ for
  // an entry pointing at this port.
  let instanceName = null
  try {
    const dir = REGISTRY_DIR
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue
        try {
          const entry = JSON.parse(readFileSync(join(dir, file), 'utf-8'))
          if (entry.port === Number(port)) {
            try { process.kill(entry.pid, 0); instanceName = entry.name } catch {}
          }
        } catch {}
      }
    }
  } catch {}

  const focused = serverInfo?.windows?.find(w => w.focused) || serverInfo?.windows?.[0]
  const tabs = serverInfo?.windows?.length ?? 0

  if (jsonOutput) {
    console.log(JSON.stringify({
      port: Number(port),
      portSource,
      portSourceKind,
      // "Reachable" means it answered — which a 401 is. It used to mean "and I could read it",
      // so a token-protected server reported `reachable: false` and any consumer printing
      // "start a server" gave advice that could never work against a server that was already up.
      // `server: null` + `authRefused` carry the "couldn't read it" half.
      reachable: !!serverInfo || serverAuthRefused,
      // A consumer branching on `server === null` would otherwise read an auth refusal as "no
      // server" — the same conflation the human output just stopped making.
      authRefused: serverAuthRefused,
      error: serverError,
      client: HJ_VERSION,
      origins: (() => {
        const d = findProjectOrigins(process.cwd(), process.env)
        return d ? { declared: d.origins, source: d.source } : null
      })(),
      // Same policy as the human output: patch drift is not "skew", it's normal.
      versionSkew: serverInfo ? differsBeyondPatch(serverInfo.serverVersion || '', HJ_VERSION) : null,
      server: serverInfo ? {
        version: serverInfo.serverVersion,
        instanceName,
        desktopApp: !!serverInfo.desktopApp,
        tabs,
        agents: serverInfo.agents,
        focused: focused ? { id: focused.id, url: focused.url, title: focused.title } : null,
      } : null,
    }, null, 2))
    return
  }
  console.log(`${bold('port:')}   ${port} ${dim(`(${portSource})`)}`)
  if (!serverInfo) {
    // Don't label an auth refusal "unreachable" — the body then contradicts its own headline
    // ("unreachable — a server IS running here"), and a line that argues with itself teaches the
    // reader to discount the whole report.
    console.log(
      serverAuthRefused
        ? `${bold('server:')} ${yellow('running, but not readable by this shell')} ${dim(`— ${serverError}`)}`
        : `${bold('server:')} ${dim(`unreachable — ${serverError}`)}`,
    )
    return
  }
  // TRANSPORTS, present and absent (issue #32). The channel is shared, so an instance that came up
  // HTTP-only silently denies HTTPS pages in OTHER projects — and nothing said so. A half-open
  // channel used to look identical to a full one from here.
  const t = serverInfo.transports
  if (t) {
    const parts = []
    if (t.http) parts.push(t.http.listening ? green(`http ${t.http.port} ✓`) : dim(`http ${t.http.port} ✗`))
    if (t.https) {
      // No port when there is nothing listening and none was assigned — `https 0` is noise.
      const label = t.https.port ? `https ${t.https.port}` : 'https'
      parts.push(
        t.https.listening
          ? green(`${label} ✓`)
          : `${yellow(`${label} ✗`)} ${dim(`(${t.https.reason})`)}`,
      )
    }
    console.log(`${bold('transports:')} ${parts.join('   ')}`)
    // Only for a SHARED channel. A private instance denies nobody else — saying otherwise would be
    // the alarming answer rather than the true one.
    if (t.https && !t.https.listening && !serverInfo.isPrivate) {
      console.log(
        dim('  an HTTPS page cannot import an HTTP channel (mixed content), so any page served over ' +
          'https has no haltija here — including pages belonging to other projects sharing this channel.'),
      )
    }
  }

  const desc = [
    `haltija ${serverInfo.serverVersion}`,
    instanceName ? `name=${instanceName}` : null,
    serverInfo.desktopApp ? 'desktop app' : null,
    `${tabs} tab${tabs === 1 ? '' : 's'}`,
    serverInfo.agents > 0 ? `${serverInfo.agents} agent${serverInfo.agents === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ')
  console.log(`${bold('server:')} ${desc}`)
  console.log(`${bold('client:')} hj ${HJ_VERSION}`)
  console.log(`${bold('origins:')} ${describeOrigins(serverInfo.windows).line}`)
  if (focused) {
    console.log(`${bold('focused:')} ${focused.title || dim('(no title)')} ${dim(`— ${focused.url}`)}`)
  } else if (tabs === 0) {
    console.log(`${bold('focused:')} ${dim('no tabs connected')}`)
  }
  // `hj where` is the diagnostic command, so it always SHOWS both versions above.
  // It only escalates to a warning when the gap is wide enough to matter — patch
  // skew between one global hj and many pinned per-project servers is normal and
  // unfixable, and a warning that always fires is one nobody reads.
  if (serverInfo.serverVersion && differsBeyondPatch(serverInfo.serverVersion, HJ_VERSION)) {
    console.log(`\n${bold('warning:')} hj ${HJ_VERSION} is driving server ${serverInfo.serverVersion}.`)
    console.log(dim(`  That gap is wide enough to route or format wrongly.`))
    console.log(dim(`  This hj is ${process.argv[1]}`))
  }
}

/**
 * `hj servers` — enumerate every live haltija server so you can pick one when several coexist
 * (e.g. a project server + the Electron desktop app). Sources: the registry, the well-known
 * defaults 8700/8701 (to catch anything unregistered), and this shell's resolved target. Marks the
 * one `hj` would drive. Pure probes + registry read; no side effects, never auto-launches.
 */
async function runServers(resolvedPort) {
  const token = process.env.HALTIJA_TOKEN

  // Enumeration + row derivation live in src/server-list.ts (tested); this only does the I/O.
  const rows = await Promise.all(
    collectCandidates(listLiveInstances(), resolvedPort).map(async (c) => {
      try {
        const resp = await fetch(`http://localhost:${c.port}/status`, {
          headers: token ? { 'X-Haltija-Token': token } : {},
          signal: AbortSignal.timeout(2000),
        })
        if (resp.ok) return describeServer(c, await resp.json())
        // 401/403 means "alive, and not for you" — a different fact from "nothing there", and the
        // only one of the two the user can act on.
        const authRefused = resp.status === 401 || resp.status === 403
        return describeServer(c, null, { authRefused })
      } catch {
        return describeServer(c, null)
      }
    }),
  )

  const up = sortRows(rows)
  if (!up.length) {
    console.log('No haltija servers are running.')
    console.log(dim('Start one:  bunx haltija --server   (or the desktop app:  bunx haltija)'))
    return
  }

  console.log(bold('Live haltija servers') + dim('  (▸ = what this shell targets)'))
  for (const r of up) {
    const here = String(r.port) === String(resolvedPort) ? green('▸') : ' '
    const name = labelFor(r)
    // Don't print "0 tabs" for a server that refused to tell us — that reads as an empty server
    // and is the same laundered-guess mistake as a bare ✓ from doctor.
    const tabs = r.authRefused ? yellow('auth required') : `${r.tabs} tab${r.tabs === 1 ? '' : 's'}`
    const kind = r.authRefused
      ? dim('needs HALTIJA_TOKEN to inspect')
      : r.desktopApp
        ? 'desktop app'
        : r.cwd || ''
    console.log(
      `  ${here} ${String(r.port).padEnd(6)} ${name.padEnd(14)} v${String(r.version).padEnd(8)} ${tabs.padEnd(9)} ${dim(kind)}`,
    )
  }
  if (!up.some((r) => String(r.port) === String(resolvedPort))) {
    console.log(dim(`\nThis shell targets :${resolvedPort}, but nothing is listening there.`))
  }
  console.log(dim('\nPick one:  ') + `hj --port <n> <cmd>` + dim('  or  ') + `hj --name <name> <cmd>`)
}

/**
 * `hj doctor` — one-command preflight for a test lane: "is the thing I'm about to drive the thing
 * I mean, and can it actually be driven?" (issues #8, #11). Exits NON-ZERO when it isn't, which is
 * the whole point: "is a server up?" is a cheap probe that does NOT predict success, so adopters
 * who used it skipped spawning their own browser and failed much later on a timeout.
 *
 * Checks, in the order they bite: server reachable → drivable (a tab is connected) → targeting is
 * unambiguous (cwd matches, or the choice was explicit) → tabs visible → versions aligned.
 */
async function runDoctor(port, portSource, portSourceKind, jsonOutput) {
  const token = process.env.HALTIJA_TOKEN

  const problems = [] // fatal → exit 1
  const notes = [] // advisory
  // Checks we could NOT perform. Deliberately a third state, not folded into either list above:
  // "I checked and it's fine" and "I couldn't check" are different claims, and a diagnostic that
  // renders the second as ✓ puts itself back inside the user's hypothesis space — the exact cost
  // this command exists to remove.
  const unchecked = []
  let status = null

  try {
    const resp = await fetch(`http://localhost:${port}/status`, {
      headers: token ? { 'X-Haltija-Token': token } : {},
      signal: AbortSignal.timeout(3000),
    })
    if (resp.ok) status = await resp.json()
    else problems.push(`server on port ${port} returned HTTP ${resp.status}`)
  } catch (err) {
    const refused = err.code === 'ConnectionRefused' || err.cause?.code === 'ECONNREFUSED'
    problems.push(
      refused
        ? `no haltija server is listening on port ${port} — start one (bunx haltija) or check the target`
        : `could not reach the server on port ${port}: ${err.message}`,
    )
  }

  if (status) {
    // The signal that actually predicts success. Older servers (<1.6.1) don't send `ready`; fall
    // back to counting tabs rather than inventing a pass.
    const tabs = Array.isArray(status.windows) ? status.windows : []
    // Prefer the server's own answer; fall back to the SHARED predicate for older servers rather
    // than a hand-written `tabs.length > 0`, which counted iframes and popups as drivable.
    const ready = typeof status.ready === 'boolean' ? status.ready : isDrivable(tabs)
    if (!ready) {
      problems.push(
        `the server on port ${port} is up but has NO connected browser tab — nothing to drive. ` +
          `Open a tab in the desktop app, or inject the widget into a page. ` +
          `("server is up" is not "server is drivable" — that's what this check exists for.)`,
      )
    }
    // Reads `active` via the shared predicate: /status and /windows disagreed on polarity, and
    // keying on one endpoint's field name is what made this diverge from the origin router.
    const hidden = tabs.filter((w) => !isVisible(w))
    // A tab that reported NEITHER field hasn't told us anything; `isVisible` had to assume. Say so
    // rather than counting the assumption as a passed check.
    const silent = tabs.filter((w) => !visibilityKnown(w))
    if (ready && silent.length) {
      unchecked.push(
        `${silent.length} of ${tabs.length} tab(s) did not report visibility${
          status.serverVersion ? ` (server ${status.serverVersion} is too old to send it)` : ''
        } — this check ASSUMED they are on screen and cannot confirm it. ` +
          `A backgrounded tab returns plausible-but-wrong results (rAF/timers throttled), so if ` +
          `something looks stale, that assumption is the first thing to doubt. ` +
          `Upgrade the server to make this checkable.`,
      )
    }
    if (ready && hidden.length === tabs.length) {
      problems.push(
        `every connected tab reports HIDDEN — results from a backgrounded tab can be ` +
          `plausible-but-wrong (rAF/timers throttled). Bring one to the front.`,
      )
    } else if (hidden.length) {
      notes.push(`${hidden.length} of ${tabs.length} tab(s) are hidden; commands targeting them may return stale results`)
    }
    if (status.serverVersion && differsBeyondPatch(HJ_VERSION, status.serverVersion)) {
      notes.push(`hj ${HJ_VERSION} is driving server ${status.serverVersion} (version skew)`)
    }

    // Does this tab actually PAINT? `visibilityState` answers "is this tab selected", not "is this
    // tab being composited", and the two diverge for occluded windows, offscreen windows and a
    // sleeping display. A starved tab renders nothing while reporting `visible`, geometry probes
    // still return real numbers, and the absence of an element stops being evidence of anything.
    //
    // That is worse than a missing feature: it invites a plausible code-level explanation. An agent
    // driving a React app found four routes "not mounting" on hard navigation, had a coherent
    // mechanism (the router gates its first mount on rAF), reproduced it four times, and nearly
    // filed it as an application bug. Opening a second tab fixed all four (#28). This check is here
    // to convert that silent, confidently-wrong outcome into a visible one.
    if (ready && tabs.length) {
      const probe =
        `new Promise(r => { const s = Date.now();` +
        ` const t = setTimeout(() => r({ fired: false, ms: Date.now() - s }), 2000);` +
        ` requestAnimationFrame(() => { clearTimeout(t); r({ fired: true, ms: Date.now() - s }) }) })`
      let raf = null
      try {
        // BOUND IT. The probe resolves in ~2s at the latest when a browser is there to answer, so a
        // longer wait means nothing is coming — and doctor is a pre-flight: a lane runs it to find
        // out quickly, not to sit through another component's timeout. Without this, a connected
        // socket that never answers `/eval` (a widget mid-teardown, or a test harness holding an
        // open WebSocket) made `hj doctor` block for the server's full browser timeout.
        const cancel = AbortSignal.timeout(3000)
        const r = await fetch(`http://localhost:${port}/eval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Haltija-Token': token } : {}) },
          body: JSON.stringify({ code: probe }),
          signal: cancel,
        })
        if (r.ok) {
          const j = await r.json()
          // Prefer the widget's OWN measurement when it sends one. It answers the same question
          // this probe does — is the tab compositing — but it is the signal the server already
          // attaches to every result, so doctor and the result warnings cannot disagree about a
          // borderline tab. The probe stays as the fallback for a widget older than 1.12.6, which
          // reports no paintAgeMs at all; without it, an old widget would silently go unchecked.
          if (typeof j?.paintAgeMs === 'number' && Number.isFinite(j.paintAgeMs)) {
            raf = { fired: j.paintAgeMs < PAINT_STALE_MS, ms: j.paintAgeMs, measured: true }
          } else if (j && j.success && j.data && typeof j.data.fired === 'boolean') {
            raf = j.data
          }
        }
      } catch {
        // Fall through to the unchecked branch — never a pass.
      }
      if (raf === null) {
        unchecked.push(
          `could not run the requestAnimationFrame probe — whether this tab actually paints is ` +
            `UNKNOWN. If elements seem missing, suspect a non-compositing tab before the page.`,
        )
      } else if (!raf.fired) {
        problems.push(
          (raf.measured
            ? `this tab HAS NOT PAINTED A FRAME IN ${(raf.ms / 1000).toFixed(1)}s — it is not compositing, even though `
            : `requestAnimationFrame DID NOT FIRE within 2s — this tab is not compositing, even though `) +
            `it reports visibilityState "visible". Anything rAF-driven (React's scheduler, tosijs ` +
            `queueRender, animations, virtual scrollers) will never render, so a missing element ` +
            `is NOT evidence of an application bug. Bring a window to the front, or wake the ` +
            `display, and re-run.`,
        )
      }
    }
    // Declared origins decide WHICH tab answers. A broken declaration silently disables the
    // routing it configures, and doctor is where a CI lane finds out.
    const origins = describeOrigins(tabs)
    if (origins.problem) problems.push(origins.problem)
  }

  // Ambiguous targeting: we fell back to the shared default while other projects' servers are live.
  // ONE predicate, shared with the resolution-time warning above and unit-tested — the two hand-
  // written copies both counted the resolved server as "other", so `hj doctor` failed against the
  // server it had just validated.
  const { ambiguous, others } = isAmbiguousTarget(portSourceKind, port, listLiveInstances())
  if (ambiguous) {
    problems.push(
      `targeting the shared default port 8700, but ${others.length} other haltija server(s) are ` +
        `running and none matches this directory (${process.cwd()}) — the target is ambiguous. ` +
        `Pick one with --name/--port, or run from the project's directory.`,
    )
  }

  // In strict mode an unperformed check is a failure: a lane that asked for no-surprises would
  // rather stop on "I couldn't verify the tabs are awake" than consume a green built on a guess.
  // By default it stays advisory, because exiting 1 at every older server would be crying wolf —
  // and a diagnostic nobody believes is no better than one that lies.
  const ok = problems.length === 0 && !(STRICT && unchecked.length > 0)

  if (jsonOutput) {
    console.log(JSON.stringify({
      ok, port, portSource, portSourceKind,
      serverVersion: status?.serverVersion ?? null,
      ready: status ? (typeof status.ready === 'boolean' ? status.ready : (status.windows?.length ?? 0) > 0) : false,
      tabs: status?.windows?.length ?? 0,
      problems, notes,
      origins: (() => {
        const d = findProjectOrigins(process.cwd(), process.env)
        return d ? { declared: d.origins, source: d.source } : null
      })(),
      // Machine-readable third state. A consumer that only knows `ok` still behaves as before;
      // one that wants certainty can require `unchecked` to be empty.
      unchecked,
    }, null, 2))
    return ok
  }

  console.log(`${bold('target:')} port ${port} ${dim(`(${portSource})`)}`)
  if (status) {
    const tabCount = status.windows?.length ?? 0
    console.log(`${bold('server:')} haltija ${status.serverVersion || '?'}${status.desktopApp ? dim(' (desktop app)') : ''}, ${tabCount} tab${tabCount === 1 ? '' : 's'}`)
  }
  if (status) console.log(`${bold('origins:')} ${describeOrigins(status.windows || []).line}`)
  for (const n of notes) console.log(`${yellow('!')} ${n}`)
  // `?` — its own glyph, because the whole point is that this is neither a pass nor a failure.
  for (const u of unchecked) console.log(`${dim('?')} ${u}`)
  for (const p of problems) console.log(`${red('✗')} ${p}`)
  if (ok) {
    // Never a bare ✓ when something went unverified. The verdict has to carry its own caveat or
    // the caveat above it may as well not be printed.
    console.log(
      unchecked.length
        ? `${green('✓')} ready to drive ${dim(`(${unchecked.length} check${unchecked.length === 1 ? '' : 's'} could not be performed — see ? above)`)}`
        : `${green('✓')} ready to drive`,
    )
  }
  return ok
}

/**
 * Resolve a named haltija instance to its port by reading
 * ~/.haltija/servers/<name>.json. Returns null if the file is missing,
 * malformed, or the recorded pid is no longer alive.
 */
function lookupNamedInstance(name) {
  const path = join(REGISTRY_DIR, `${name}.json`)
  if (!existsSync(path)) return null
  let entry
  try {
    entry = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
  if (entry?.pid) {
    try { process.kill(entry.pid, 0) } catch { return null }
  }
  return entry
}

/**
 * Every live entry in ~/.haltija/servers/. Mirrors `list()` in src/sessions.ts —
 * duplicated rather than imported because this file is plain .mjs bundled
 * standalone into dist/hj.js, with no access to the compiled TS.
 */
function listLiveInstances() {
  const dir = REGISTRY_DIR
  if (!existsSync(dir)) return []
  const out = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const entry = lookupNamedInstance(file.slice(0, -'.json'.length))
    if (entry) out.push(entry)
  }
  return out
}

/** True if `dir` is `p` or one of its ancestors (segment-wise, not raw prefix). */
function isAncestorOf(dir, p) {
  if (!dir || !p) return false
  if (dir === p) return true
  return p.startsWith(dir.endsWith('/') ? dir : dir + '/')
}

/**
 * Find the live server that owns `cwd` — the one whose recorded directory is
 * the nearest ancestor of it. This is what makes plain `hj` inside a project
 * reach *that project's* server instead of the global default port.
 *
 * `/` and the home directory are ancestors of everything, so servers started
 * there can't win a match; otherwise they'd capture every project on the box.
 */
function resolveByCwd(cwd, instances) {
  const candidates = instances.filter(
    (e) => e.cwd && e.cwd !== '/' && e.cwd !== homedir() && isAncestorOf(e.cwd, cwd),
  )
  if (!candidates.length) return null
  candidates.sort((a, b) => b.cwd.length - a.cwd.length || (b.startedAt || 0) - (a.startedAt || 0))
  return candidates[0]
}

// `hj <cmd> --help` shows help for THAT command. It used to fall into the global help below, which
// reads exactly like "unknown command" — a reporter reasonably concluded `doctor` and `map` didn't
// exist in their build (issue #14). Worse, haltija's own error messages tell you to run
// `hj <cmd> --help`, so the remedy we print was broken: a printed remedy is a testable claim.
if ((args.includes('--help') || args.includes('-h')) && args[0] && !args[0].startsWith('-')) {
  // Command help first; fall back to a text search so `hj help <topic>` still works.
  if (!commandHelp(args[0])) filterHelp(args[0])
  process.exit(0)
}

if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`
${bold('hj')} - Haltija command-line interface

Usage: hj <command> [args...]

${dim('Which server does hj talk to?')}
  ${dim('By default, the one that owns the directory you are in: a haltija server')}
  ${dim('records where it was started, and hj picks the one whose directory is the')}
  ${dim('nearest ancestor of your cwd. So inside a project with its own server,')}
  ${dim('plain `hj tree` just works. Otherwise it falls back to port 8700.')}
  ${dim('Run `hj where` to see the port, WHY it was chosen, and what is alive there.')}

${dim('Overriding that (per-shell):')}
  ${dim('haltija --name api --server')}   # in another shell: register as "api"
  ${dim('export HALTIJA_NAME=api')}       # all hj calls in this shell talk to "api"
  ${dim('hj --name api tree')}            # one-off name override
  ${dim('export HALTIJA_PORT=9123')}      # bypass the registry; talk to a port directly
  ${dim('hj --port 9123 tree')}           # one-off port override
  ${dim('export HALTIJA_TOKEN=secret')}   # required when server was started with HALTIJA_TOKEN
  ${dim('hj --token secret tree')}        # one-off token override
  ${dim('hj --version')}                  # which hj is this?

${dim('Lifecycle:')}
  ${dim('hj where')}                       # which server this shell targets + what is alive there
  ${dim('hj servers')}                     # list ALL live servers (pick one with --port/--name)
  ${dim('hj doctor')}                      # preflight: drivable + unambiguous? EXITS 1 if not
  ${dim('hj shutdown')}                    # stop the targeted server (a private --app: Electron + all)

${dim('For scripts / CI:')}
  ${dim('hj --strict <cmd>')}              # turn advisory warnings (wrong project, hidden tab)
  ${dim('HALTIJA_STRICT=1')}               # into non-zero exits, so a lane fails fast on the
                                  ${dim('# real cause instead of a later timeout')}
${listSubcommands()}
Run ${dim('hj --help')} for this help.
Run ${dim('haltija --help')} for server/app options.
`)
  process.exit(0)
}

// Parse --strict FIRST — before port resolution, which is itself one of the things strict mode
// turns from a warning into an error. (A check placed before the input it depends on is a
// recurring bug shape: parse the flag, then run the code that reads it.) Sets HALTIJA_STRICT so
// cli-subcommand.mjs sees it too.
//
// In strict mode the advisory warnings — cross-project targeting, hidden tab, focus ambiguity —
// become non-zero exits (issue #8). haltija already DETECTS these precisely; the gap was that
// detection never reached the exit code, so a lane consumed a plausible-but-wrong result and failed
// much later pointing at the caller's own code. A warning is right for a human at a prompt and
// wrong for a script.
const strictIdx = args.indexOf('--strict')
if (strictIdx !== -1) {
  process.env.HALTIJA_STRICT = '1'
  args.splice(strictIdx, 1)
}
const STRICT = process.env.HALTIJA_STRICT === '1'

// Parse --name option (or HALTIJA_NAME env): resolve to a port via
// ~/.haltija/servers/<name>.json, written by `haltija --name <foo>`.
let resolvedName = process.env.HALTIJA_NAME || ''
let nameSource = resolvedName ? 'HALTIJA_NAME env' : ''
const nameIdx = args.indexOf('--name')
if (nameIdx !== -1 && args[nameIdx + 1]) {
  resolvedName = args[nameIdx + 1]
  nameSource = '--name flag'
  args.splice(nameIdx, 2)
}

// Parse --port up front. It must be consumed BEFORE resolution runs: the
// fallback branch below warns about landing on the default port, and if --port
// were still unparsed at that moment, `hj --port 9999` would warn "you're on
// 8700, use --port" and then correctly use 9999 — a single run contradicting
// itself, telling the user to reach for the flag they just used.
let portFlag = ''
const portIdx = args.indexOf('--port')
if (portIdx !== -1 && args[portIdx + 1]) {
  portFlag = args[portIdx + 1]
  args.splice(portIdx, 2)
}

// Port resolution priority:
//   --port flag > --name/HALTIJA_NAME registry lookup > HALTIJA_PORT env
//   > DEV_CHANNEL_PORT env > cwd match against the registry > 8700 default
//
// The cwd step is what keeps projects from stepping on each other: a server
// started inside a project records its directory, so plain `hj` run anywhere
// under that directory routes to it. Without it, every `hj` in every project
// lands on 8700 and drives whatever browser is focused there — silently.
//
// Resolved highest-precedence-first and short-circuited, so each source is
// consulted only when nothing above it decided. Only the final, losing branch
// warns.
// `portSource` is the sentence a human reads; `portSourceKind` is what code decides on. They were
// one string doing both jobs, keyed by a regex in one file and `!==` in another — see PortSourceKind.
let port, portSource, portSourceKind
if (portFlag) {
  port = portFlag
  portSource = '--port flag'
  portSourceKind = 'flag'
} else if (resolvedName) {
  const entry = lookupNamedInstance(resolvedName)
  if (!entry) {
    console.error(`hj: no live haltija instance named "${resolvedName}".`)
    console.error(`Start one with:  haltija --name ${resolvedName} --server`)
    process.exit(1)
  }
  port = String(entry.port)
  portSource = `name "${resolvedName}" via ${nameSource}`
  portSourceKind = 'name'
} else if (process.env.HALTIJA_PORT) {
  port = process.env.HALTIJA_PORT
  portSource = 'HALTIJA_PORT env'
  portSourceKind = 'env'
} else if (process.env.DEV_CHANNEL_PORT) {
  port = process.env.DEV_CHANNEL_PORT
  portSource = 'DEV_CHANNEL_PORT env (legacy)'
  portSourceKind = 'env'
} else {
  const live = listLiveInstances()
  const cwdMatch = resolveByCwd(process.cwd(), live)
  if (cwdMatch) {
    port = String(cwdMatch.port)
    portSource = `cwd match: ${cwdMatch.name}`
    portSourceKind = 'cwd'
  } else {
    port = '8700'
    portSource = '8700 (default)'
    portSourceKind = 'default'
    // Falling back to the shared default while project servers are running is
    // the classic misroute — you think you're driving this project's browser
    // and you're driving someone else's. Say so rather than doing it quietly.
    // Reached only when nothing else selected a port, so it can't contradict an
    // explicit choice.
    const { ambiguous, others } = isAmbiguousTarget(portSourceKind, port, live)
    if (ambiguous) {
      const names = others.map((e) => `${e.name} (${e.cwd})`).join(', ')
      if (STRICT) {
        // A lane must not silently drive another project's browser (issue #8, case 1).
        console.error(`hj: ERROR (strict) — refusing to fall back to the default port 8700 while other haltija servers are running: ${names}`)
        console.error(`hj: this shell's cwd (${process.cwd()}) matches none of them, so the target is ambiguous.`)
        console.error(`hj: pick one explicitly with --name/--port (or cd into its directory), or drop --strict to proceed anyway.`)
        process.exit(1)
      }
      console.error(`hj: warning — targeting the default port 8700, but these haltija servers are running: ${names}`)
      console.error(`hj: if you meant one of them, cd into its directory, or use --name/--port. See \`hj where\`.`)
    }
  }
}

// Parse --token option (sets HALTIJA_TOKEN env so cli-subcommand.mjs picks it up).
const tokenIdx = args.indexOf('--token')
if (tokenIdx !== -1 && args[tokenIdx + 1]) {
  process.env.HALTIJA_TOKEN = args[tokenIdx + 1]
  args.splice(tokenIdx, 2)
}

// Parse --no-launch option (skip auto-launching Electron app)
let noLaunch = false
const noLaunchIdx = args.indexOf('--no-launch')
if (noLaunchIdx !== -1) {
  noLaunch = true
  args.splice(noLaunchIdx, 1)
}

// Parse --window <id> HERE so it works BEFORE the subcommand, like --port/--name/--token do.
// It was only handled after the subcommand, so the documented form `hj --window <id> eval …`
// died with "Unknown command: '--window'" — i.e. the escape hatch we tell people to use for a
// hidden/wrong tab didn't work in the shape the docs gave. Pulled out here and re-appended to
// the subcommand args below, so BOTH positions work.
const { windowTarget, args: argsWithoutWindow } = extractWindowTarget(args)
// Preserve the `const args` reference (downstream code mutates it in place) while dropping the
// consumed --window <id> pair.
args.length = 0
args.push(...argsWithoutWindow)

// Did the shell explicitly target a private instance (--port / --name /
// HALTIJA_PORT / HALTIJA_NAME / DEV_CHANNEL_PORT)? If so, this is a
// project-owned server with a bring-your-own browser — auto-launching the
// standalone Haltija.app is never right (it runs its own server on 8700 and
// can't connect to this port), so we suppress the Electron launch and print
// an actionable hint instead. Only the bare, unconfigured 8700 default keeps
// the zero-config desktop auto-launch.
const explicitTarget = portSourceKind !== 'default'

// --- Space-to-hyphen sub-command resolution ---
// "hj test run foo.json" → "hj test-run foo.json"
// "hj events watch" → "hj events-watch"
// "hj recording start" → "hj recording-start"
// Works even when args[0] is a known command (e.g., "events" is valid, but "events watch" → "events-watch")
if (args.length >= 2 && isSubcommand(`${args[0]}-${args[1]}`)) {
  args.splice(0, 2, `${args[0]}-${args[1]}`)
}

// --- Bare noun defaults ---
// "hj test" → "hj test-run", "hj mutations" → "hj mutations-status", etc.
const NOUN_DEFAULTS = {
  'test': 'test-run',
  'events': 'events',       // already a command (GET /events)
  'mutations': 'mutations-status',
  'network': 'network',     // already a command (GET /network)
  'select': 'select-status',
  'tabs': 'windows',        // show tab list
  'video': 'video-status',
  'send': 'send',           // already a command
  'session': 'session-read',// bare `hj session` shows the mirror
}
if (args.length === 1 && !isSubcommand(args[0]) && Object.hasOwn(NOUN_DEFAULTS, args[0])) {
  args[0] = NOUN_DEFAULTS[args[0]]
}

// `hj session read --follow` — poll the mirror and print only what is new.
//
// Client-side rather than a streaming endpoint: the page in the headset polls the same endpoint, so
// a second transport would be a second thing to keep working. newTailOnly() is shared with the
// server module and unit-tested, including the case where the pane has scrolled past what we saw.
if ((args[0] === 'session-read' || (args[0] === 'session' && args[1] === 'read')) && args.includes('--follow')) {
  const { newTailOnly } = await import('./tmux-session.mjs')
  const linesIdx = args.indexOf('--lines')
  const lines = linesIdx !== -1 ? Number(args[linesIdx + 1]) : 200
  let seen = ''
  let firstPass = true
  process.stderr.write(`[hj] following the mirrored session — Ctrl-C to stop\n`)
  for (;;) {
    let json
    try {
      const resp = await fetch(`http://localhost:${port}/session/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.HALTIJA_TOKEN ? { 'X-Haltija-Token': process.env.HALTIJA_TOKEN } : {}) },
        body: JSON.stringify({ lines }),
      })
      json = await resp.json()
    } catch (err) {
      console.error(`hj: ${err.message}`)
      process.exit(1)
    }
    if (!json.success) {
      // Do not spin silently on a session that has gone away — say it once and stop, so a dead
      // mirror cannot look like an idle agent.
      console.error(`hj: ${json.error}`)
      process.exit(1)
    }
    const text = json.text || ''
    const fresh = firstPass ? text : newTailOnly(seen, text)
    if (fresh) process.stdout.write(fresh.endsWith('\n') ? fresh : fresh + '\n')
    seen = text
    firstPass = false
    await new Promise((r) => setTimeout(r, 1000))
  }
}

const subcommand = args[0]
let subArgs = args.slice(1)
// Re-attach a leading --window so cli-subcommand's existing handling sees it (both positions work).
if (windowTarget) subArgs = [...subArgs, '--window', windowTarget]

// Commands hj answers itself, as a MAP rather than an if-chain.
//
// The names lived in five places: `LOCAL_COMMANDS` in src/cli-commands.ts (documented as
// authoritative), hand copies in `HJ_LOCAL_COMMANDS` and `DIAGNOSTIC` here, and — the one that
// actually decided anything — a hardcoded `if (subcommand === 'where' || …)` chain. Importing the
// list without replacing the chain would have fixed nothing: adding a name to `LOCAL_COMMANDS`
// made `hj <name> --help` print the routed footer ("machine-readable: hj <name> --json", a remedy
// that cannot work) and then POST /<name> to the server. Now there is one map, and the invariant
// below makes a missing handler a startup error instead of a wrong answer.
const LOCAL_HANDLERS = {
  // Which server is this shell targeting, and what's alive there. Pure resolution + one /status
  // probe; no side effects, no auto-launch, safe anywhere.
  where: async () => {
    await runWhere(port, portSource, subArgs.includes('--json'))
    return 0
  },
  // Every live haltija (registry + defaults + this shell's target), so you can pick one when
  // several coexist. Diagnostic; never auto-launches.
  servers: async () => {
    await runServers(port)
    return 0
  },
  // Preflight for a test lane. EXITS NON-ZERO when the target isn't drivable or is ambiguous, so a
  // lane fails fast with the real reason (issues #8, #11). Never auto-launches.
  doctor: async () => ((await runDoctor(port, portSource, portSourceKind, subArgs.includes('--json'))) ? 0 : 1),
  // Cleanly stop the targeted server. For a private `--app` instance this tears down the WHOLE
  // thing (Electron + its child servers). Never auto-launches — it's a stop command.
  shutdown: async () => {
    const token = process.env.HALTIJA_TOKEN
    try {
      const resp = await fetch(`http://localhost:${port}/shutdown`, {
        method: 'POST',
        headers: token ? { 'X-Haltija-Token': token } : {},
        signal: AbortSignal.timeout(3000),
      })
      const j = await resp.json().catch(() => ({}))
      if (resp.ok) {
        console.log(j.message || `Shutdown requested on port ${port}.`)
        return 0
      }
      // Surface the server's explanation (e.g. the desktop-app refusal), not a bare status code.
      console.error(`hj ${subcommand}: ${j.error || `server on port ${port} returned HTTP ${resp.status}`}`)
      return 1
    } catch (err) {
      // Nothing listening = already stopped; that's success for a stop command.
      if (err.code === 'ConnectionRefused' || err.cause?.code === 'ECONNREFUSED') {
        console.log(`No server listening on port ${port} (already stopped).`)
        return 0
      }
      console.error(`hj ${subcommand}: ${err.message}`)
      return 1
    }
  },
}
// Aliases, declared once so `LOCAL_COMMANDS` and the map stay the same set.
LOCAL_HANDLERS.ls = LOCAL_HANDLERS.servers
LOCAL_HANDLERS.quit = LOCAL_HANDLERS.shutdown

// The invariant that closes the class. A name in LOCAL_COMMANDS with no handler here would fall
// through to the routing table and POST to the server; a handler with no name would never be
// reachable as a command. Both are silent, so make them loud — and at startup, not at use.
{
  const declared = new Set(LOCAL_COMMANDS)
  const implemented = new Set(Object.keys(LOCAL_HANDLERS))
  const missing = [...declared].filter((c) => !implemented.has(c))
  const orphaned = [...implemented].filter((c) => !declared.has(c))
  if (missing.length || orphaned.length) {
    console.error(
      `hj: internal error — LOCAL_COMMANDS and LOCAL_HANDLERS disagree` +
        (missing.length ? `; no handler for: ${missing.join(', ')}` : '') +
        (orphaned.length ? `; handler not in LOCAL_COMMANDS: ${orphaned.join(', ')}` : ''),
    )
    process.exit(1)
  }
}

// `Object.hasOwn`, not truthiness — the third instance of this in one dispatch path. A bare object
// inherits Object.prototype, so `LOCAL_HANDLERS['toString']` is a FUNCTION that returns
// '[object Object]', which went straight into `process.exit()` and crashed with an
// ERR_INVALID_ARG_TYPE from node's bootstrap. `hj toString` — or `constructor`, `valueOf`,
// `hasOwnProperty` — should print "unknown command", not a stack trace from inside node itself.
// Same class as the CLI's lookup tables: these are dictionaries keyed by user input, so they get
// no prototype. `COMMAND_HINTS` is generated and imported, so it's nulled here at the point of use.
for (const table of [NOUN_DEFAULTS, LOCAL_HANDLERS, COMMAND_HINTS]) {
  try { Object.setPrototypeOf(table, null) } catch {}
}

if (Object.hasOwn(LOCAL_HANDLERS, subcommand)) {
  const code = await LOCAL_HANDLERS[subcommand]()
  // And exit with a NUMBER whatever a handler returns. A handler that forgets to return one would
  // otherwise reintroduce this crash from a different direction.
  process.exit(typeof code === 'number' ? code : 0)
}

// Declared-origin routing (issues #1/#2). cwd routing found the right SERVER; if this project has
// declared which origins are its pages, pin the command to the matching TAB instead of letting focus
// decide. Purely opt-in — no `.haltija.json` (or HALTIJA_ORIGINS) means nothing changes.
//
// Skipped when the caller already pinned a window (they own the choice), and for the diagnostic
// commands, which must describe the world rather than act on one tab.
// The local commands (which never act on a tab) plus the read-only routed ones. Derived, so
// adding a local command can't leave this set behind.
const DIAGNOSTIC = new Set([...LOCAL_COMMANDS, 'status', 'windows', 'version'])
if (!windowTarget && !DIAGNOSTIC.has(subcommand) && isSubcommand(subcommand)) {
  const declared = findProjectOrigins(process.cwd(), process.env)
  if (declared && !declared.origins.length) {
    // A config that exists but declares nothing usable silently disabled the very routing it was
    // written to enable — recreating the misroute the feature prevents. Say so.
    console.error(`hj: warning — ${declared.source} declares no usable origins, so per-tab routing is OFF and commands follow focus.`)
    console.error(`hj: expected e.g. { "origins": ["https://localhost:8030"] }`)
    if (STRICT) process.exit(1)
  }
  if (declared && declared.origins.length) {
    try {
      const token = process.env.HALTIJA_TOKEN
      const resp = await fetch(`http://localhost:${port}/windows`, {
        headers: token ? { 'X-Haltija-Token': token } : {},
        signal: AbortSignal.timeout(2500),
      })
      if (resp.ok) {
        const { windows: tabs = [], focused } = await resp.json()
        const routed = routeByDeclaredOrigin(declared.origins, tabs, focused)
        if (routed.kind === 'matched') {
          subArgs = [...subArgs, '--window', routed.windowId]
        } else if (routed.kind === 'no-match' && tabs.length) {
          // NEVER fall through silently: this project said which pages are its own, and none is
          // connected. Driving whatever happens to be focused is the exact bug the declaration was
          // added to prevent.
          const saw = routed.sawOrigins.length ? routed.sawOrigins.join(', ') : '(none with a readable origin)'
          const msg =
            `declared origins ${declared.origins.join(', ')} (from ${declared.source}) match no connected tab. ` +
            `Connected: ${saw}.`
          if (STRICT) {
            console.error(`hj: ERROR (strict) — ${msg}`)
            console.error(`hj: open one of your declared origins, fix .haltija.json, or pass --window <id> to choose explicitly.`)
            process.exit(1)
          }
          console.error(`hj: warning — ${msg}`)
          console.error(`hj: proceeding against the FOCUSED tab, which may be another project's page. Pass --window <id> to be sure.`)
        }
      }
    } catch {
      // Routing is an enhancement; never let a probe failure block the command.
    }
  }
}

if (!isSubcommand(subcommand)) {
  const suggestion = getSuggestion(subcommand)
  if (suggestion === '--help') {
    // hj help <topic> — filter help output by topic
    const topic = args[1]
    if (topic) {
      filterHelp(topic)
    } else {
      console.log(listSubcommands())
    }
    process.exit(0)
  }

  // Auto-execute if there's exactly one fuzzy match
  if (suggestion) {
    runSubcommand(suggestion, subArgs, port, { noLaunch, explicitTarget })
  } else {
    console.error(`Unknown command: '${subcommand}'`)
    console.error(`\nExamples: hj tree, hj navigate <url>, hj click @42`)
    console.error(`Run 'hj' for docs.`)
    process.exit(1)
  }
} else {
  runSubcommand(subcommand, subArgs, port, { noLaunch, explicitTarget })
}

/**
 * Help for one command, from the sources that actually define the surface: KNOWN_COMMANDS (what the
 * CLI accepts), COMMAND_HINTS (generated from api-schema at build time), and the hj-local commands.
 *
 * `filterHelp` greps a hand-maintained blurb that lists ~26 of ~66 commands, so routing
 * `hj <cmd> --help` at it made 40 commands report "No commands matching '<cmd>'" — worse than the
 * global help it replaced, because it asserts the command does not exist. `map` and `doctor` were
 * among them, which are exactly the two a reporter had already concluded were missing, and exactly
 * what this release's teachable errors tell people to run.
 *
 * Returns false when the topic isn't a command, so `hj help <topic>` can still do a text search.
 */
function commandHelp(cmd) {
  const hint = COMMAND_HINTS[cmd]
  const local = LOCAL_COMMAND_HELP[cmd]
  const known = isSubcommand(cmd) || HJ_LOCAL_COMMANDS.has(cmd)
  if (!known && !hint) return false

  console.log(`${bold('hj ' + cmd)}${hint ? '  ' + dim(hint) : ''}`)
  console.log('')

  // The endpoint's own one-line summary, generated from api-schema.ts. Only ~24 endpoints carry a
  // `hints` string, but every one carries a `summary` — so before this, 35 commands printed a
  // header and a footer with nothing in between.
  const summary = COMMAND_SUMMARIES[cmd]
  if (summary) {
    console.log(`  ${summary}`)
    console.log('')
  }

  // Any blurb lines that mention it (usage examples live there), best-effort.
  //
  // Anchored to the START of a command line, not `\b<cmd>\b` anywhere. The loose form matched
  // PROSE that happens to name the command, so `hj screenshot --help` printed the unrelated
  // "Fuzzy matching: hj evaluate = hj eval, hj screensho = hj screenshot" line as though it were
  // documentation for screenshot. Help that pads itself with near-misses is how help stops being
  // read.
  const lines = listSubcommands().split('\n')
  const shown = lines.filter((l) => {
    const plain = l.replace(/\x1b\[[0-9;]*m/g, '')
    return new RegExp(`^\\s{2,}${cmd}\\b`).test(plain)
  })
  for (const l of shown) console.log(l)
  if (shown.length) console.log('')

  if (HJ_LOCAL_COMMANDS.has(cmd)) {
    // Local commands have neither a schema-derived hint nor a listSubcommands() blurb, so without
    // this they printed a header and the words "Runs client-side" — nothing about what they do.
    // `doctor` and `where` are the two this release most wants people to reach for.
    if (local) {
      console.log(`  ${local.summary}`)
      console.log('')
      console.log(`  ${local.detail}`)
      console.log('')
    }
    console.log(dim('  Runs client-side (no page interaction).'))
  } else {
    console.log(dim(`  Full reference: hj api   |   machine-readable: hj ${cmd} --json`))
  }
  return true
}

function filterHelp(topic) {
  const needle = topic.toLowerCase()
  const helpText = listSubcommands()
  const lines = helpText.split('\n')

  const matches = []
  let currentCategory = ''

  for (const line of lines) {
    // Detect category headers (bold ANSI text with no leading spaces beyond the initial 2)
    if (line.match(/^\s{2}\x1b\[1m/)) {
      currentCategory = line
      continue
    }

    // Match content lines against topic
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase()
    if (stripped.trim() && stripped.includes(needle)) {
      matches.push({ category: currentCategory, line })
    }
  }

  if (matches.length === 0) {
    console.log(`No commands matching '${topic}'.`)
    console.log(`Run ${dim('hj help')} to see all commands.`)
    return
  }

  console.log(`\nCommands matching '${bold(topic)}':\n`)
  let lastCategory = ''
  for (const m of matches) {
    if (m.category && m.category !== lastCategory) {
      console.log(m.category)
      lastCategory = m.category
    }
    console.log(m.line)
  }

  // Also show matching hints
  const hintMatches = Object.entries(COMMAND_HINTS).filter(([cmd, hint]) =>
    cmd.toLowerCase().includes(needle) || hint.toLowerCase().includes(needle)
  )
  if (hintMatches.length > 0) {
    console.log(`\n  ${bold('Hints')}`)
    for (const [cmd, hint] of hintMatches) {
      console.log(`    ${bold(cmd.padEnd(28))} ${dim(hint)}`)
    }
  }
  console.log('')
}
