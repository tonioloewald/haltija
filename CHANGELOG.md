# Changelog

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
- `hj … --json` now exits non-zero when the response reports failure (`success:false`), matching the human-output path — so an agent checking the exit code can no longer read a failed probe as success.
- `HALTIJA_REGISTRY_DIR` overrides the instance-registry location.
- `hj` no longer auto-spawns a server against an **explicitly targeted** port (`--port`/`--name`/`HALTIJA_PORT`) or under `--no-launch` — a read-only command against a server you manage will not start a colliding one; it errors instead. Auto-spawn remains only for the bare default port.

### Platform

macOS and Linux. Native Windows is not supported — use WSL, where all of this works unmodified.
