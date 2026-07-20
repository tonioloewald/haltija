# Changelog

## 1.5.0

Completes the **private-automation** feature (`--private`) begun in 1.4.1 — now for the Electron
app as well as headless — and adds two **"the instrument must not lie"** guards so a command that
lands on the wrong or sleeping tab says so instead of returning a plausible-but-wrong answer.

### New: `--private --app` — isolated Electron automation ([#1](https://github.com/tonioloewald/haltija/issues/1))

`--private` gave headless runs an isolated server + browser on an ephemeral port. `--private --app`
extends that to the desktop app: it spawns its **own** public and internal servers on ephemeral
ports (never 8700/8701), drives its **own** browser, writes the public address to `--port-file`,
and never sees, adopts, registers, or touches the shared interactive channel. The app's port
constants are now resolved *after* the private servers report their ephemeral ports, so every
downstream use — widget injection, `/status`, content tabs — follows the ephemeral instance.

### New: hidden-tab warning ([#3](https://github.com/tonioloewald/haltija/issues/3))

A backgrounded tab **answers** — `hj eval 'document.querySelectorAll("x").length'` returns `0`, not
a timeout — because browsers stop `requestAnimationFrame` and throttle timers in a hidden tab, so
anything mounted by rAF/IntersectionObserver never ran. The page looks broken when it's merely
asleep. When a command is routed to a tab that reported itself hidden, the result now carries a
warning that the number can be plausible-but-wrong, with how to target a visible tab.

### New: focus-ambiguity warning ([#2](https://github.com/tonioloewald/haltija/issues/2))

cwd routing gets an untargeted `hj` command to the right shared *server* and then stops — which
*tab* answers falls back to focus. So two agents each staying in their own project can drive each
other's pages once both have a tab on the shared server. When a command isn't pinned to a window
and the server spans more than one origin, the result now warns that *focus*, not your directory,
chose the tab — and lists the other tabs as `--window` pins. It deliberately does **not** guess
which tab is "yours" (there's no reliable origin→directory map); ranking waits for one that can
justify itself.

### Fixed

- **`hj --window <id> <cmd>`** — the documented leading form printed the usage banner instead of
  targeting the window (`--window` wasn't pre-parsed like `--port`/`--name`). Both positions work now.
- **Desktop-spawned servers get their port** via the env the server actually reads
  (`HALTIJA_PORT`/`DEV_CHANNEL_PORT`, not `PORT`) — the app couldn't control its servers' ports before.

## 1.4.1

Five cross-project bugs, all of the same shape: **haltija reaching out and disrupting a healthy
peer.** If you run more than one project on a machine, this is the release that stops your
browser channel vanishing.

### Behavior changes (no API breaks)

Nothing was removed or renamed — no endpoint, export, or flag — so nothing should fail to compile
or resolve. Two *runtime* behaviors changed, and in both the old behavior was the bug:

- **The desktop app attaches to an existing server instead of replacing it.** If you relied on a
  launch always giving you a pristine embedded server, set `HALTIJA_SERVER_MODE=builtin`.
- **`--https` (https-only) now exits if it cannot bind its port**, instead of silently starting on
  an ephemeral one. The old "success" produced a channel no widget could reach.

### New: `--private` — isolated automation instances ([#1](https://github.com/tonioloewald/haltija/issues/1))

haltija plays two roles that were conflated. A **shared interactive** browser on the default port
is a feature — whatever window is focused is what `hj` drives, across projects. But **ephemeral
automation** (a test lane that spawns a browser, drives fixed pages, and exits) was consulting
that shared server and, if any was reachable, *adopting and navigating it* — so one project's
doc-test lane yanked another project's live browser to different pages, and then failed on a
timeout. Intermittent and baffling, because it only bit when a foreign haltija happened to be up.

`haltija --private` (pair with `--headless`) is isolated by construction:

- binds an **ephemeral port, never 8700** — it can't collide with or be mistaken for the shared server;
- is **not registered** in the shared registry, so interactive `hj` / cwd-routing can't adopt it;
- **never reaches out** — it retires nothing and touches no other server;
- **reports its address** on stdout (`HALTIJA_PRIVATE_READY {json}`) and to `--port-file` — since
  it's not in the registry, that's how you find it.

A consumer's test lane should request a private instance and drive *that* by the port it reports,
instead of an unscoped `hj windows` check that races whatever else is on the machine.

### Fixed: the desktop app killed other projects' channels

Its default was to stop any server on 8700/8701 and start fresh — so launching the app (`bunx
haltija`, an `hj` auto-launch, `--ci`, the integration test) silently took down a live channel
another project was using, and made its widget vanish. It now **attaches to a healthy existing
server and says so**. Force the old behavior with `HALTIJA_SERVER_MODE=builtin`.

### Fixed: a half-dead `--both` channel (HTTPS silently on the wrong port)

When the HTTPS port was busy (a fast restart racing the previous server), the HTTPS side quietly
fell back to an **ephemeral** port. But a widget on an https page connects to the *known* port —
so 8701 sat empty, the page couldn't connect, and the server looked healthy because HTTP was fine.
HTTPS now retries its intended port and, failing that, **fails loudly** rather than relocating;
the startup banner never advertises a port it didn't bind.

### Fixed: silent HTTP port relocation

When the wanted HTTP port was taken, the server bound an ephemeral one without a word — so a
caller probing a fixed port had no idea why nothing was there. It now says
`<port> was taken; bound HTTP on <n> instead. Find it with \`hj where\`.`

### Fixed: the test suite disrupted other servers

`bun test` bound fixed 87xx ports — the range real servers live in — and on a collision would
`POST /shutdown` whatever was there, including another project's channel. The suite now uses
high, per-process-unique ports and can never stop a server it didn't start.

### Docs

A "tab that reads as unreachable" troubleshooting section in `DOCS.md` and `llms.txt`: a hidden,
backgrounded, minimized, or occluded tab (and an active WebXR session) suspends
`requestAnimationFrame` and throttles timers, so the tab can stop answering even though the page
is fine. Bring it forward, or target it explicitly with `hj --window <id>`.


## 1.4.0

**`hj` now routes to the server that owns your current directory.** If you run more than one
project, this changes where your commands go — for the better, but read the first section.

### Fixed: `hj` drove the wrong browser across projects

`hj` never looked at your working directory. Every invocation, in every project, fell back to
port 8700 and drove whatever browser was focused there — silently, with no error. The only way
to target a project's own server was per-shell environment variables that agents spawning fresh
shells routinely lose.

Servers now record the directory they were started in, and `hj` picks the live server whose
directory is the nearest ancestor of your cwd. Inside a project with its own server, plain
`hj tree` just works — no flags, no env vars.

- Falling back to the shared default port while other servers are running now **warns** on
  stderr instead of quietly misrouting.
- **`hj where`** tells you which port you're targeting, *why* it was chosen, and what's alive
  there. Reach for it first when a command seems to hit the wrong page.
- Precedence is unchanged and still wins: `--port` > `--name`/`HALTIJA_NAME` > `HALTIJA_PORT` >
  `DEV_CHANNEL_PORT` > cwd match > port 8700.

### Fixed: a stale server could hand every project an old `hj`

`hj` is a single binary on your `PATH`, and every haltija server used to overwrite it on
startup — so the last server to boot decided which `hj` *every project on the machine* ran. One
forgotten `bunx haltija@beta` could silently downgrade the CLI for an unrelated, up-to-date
project.

- A **symlinked `hj` is never touched.** Point it at your own build and it stays put.
- Servers **only bootstrap or repair** `hj` — they write it when nothing is there, or when
  what's there is strictly older. They never downgrade it, and never rewrite it just because
  the bytes differ. To find out what's installed they ask it (`hj --version`).
- **`hj --version`**, and `hj` now warns when its version differs from the server it's driving.
- `HALTIJA_NO_INSTALL=1` opts out of the install entirely.

### New: pre-1.4.0 servers are retired on startup

Older servers have none of the guards above and cannot be fixed in code that already shipped, so
a 1.4.0+ server **asks** any haltija server **below 1.4.0** to stop when it starts, and says what
it did. Retirement is `POST /shutdown` — an endpoint every haltija has understood since 0.1.7 —
so it needs no process IDs and does no killing.

This is deliberately narrow: it never stops a peer (1.4.0 and 1.4.1 coexist, and once 1.3.x is
gone it never fires again), never touches a running desktop app, and never touches anything it
cannot identify as haltija. When it can't stop a server, it complains rather than failing
silently.

`HALTIJA_NO_RETIRE=1` opts out. See "Housekeeping" in the README.

### Also

- HTTPS-only servers no longer advertise an HTTP port they aren't listening on.
- Every REST response carries `X-Haltija-Version`.
- **`hj` exits non-zero when an operation fails** (`success:false`) — not just with `--json`, but on action commands too (`hj click`, `navigate`, `key`, …). A click that didn't land, or any command with no browser connected, now exits 1 instead of 0, so an agent checking the exit code can't read a failed step as success. (Commands with their own human formatting were already this way; this closes the gap for the rest.)
- `HALTIJA_REGISTRY_DIR` overrides the instance-registry location.
- `hj` no longer auto-spawns a server against an **explicitly targeted** port (`--port`/`--name`/`HALTIJA_PORT`) or under `--no-launch` — a read-only command against a server you manage will not start a colliding one; it errors instead. Auto-spawn remains only for the bare default port.

### Platform

macOS and Linux. Native Windows is not supported — use WSL, where all of this works unmodified.
