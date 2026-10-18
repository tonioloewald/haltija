/**
 * The `test:integration` lane: start a private headless haltija, point `tests/` at it, and fail
 * unless the tests actually ran.
 *
 * The lane used to be bare `bun test tests/`. Those tests refuse the shared default port (#42) and
 * skip unless HALTIJA_PORT/HALTIJA_URL names a server, and nothing set either, so release
 * attestation recorded "0 pass, 11 skip, exit 0" as a pass for every 1.13 beta (1.13.0 review).
 * The lane now starts what it needs, and treats a skip as a failure: a lane whose only job is to run
 * these tests has not done it if they skipped.
 *
 * Already pointed at a server (HALTIJA_PORT or HALTIJA_URL set)? Then it runs against that one and
 * starts nothing.
 */
import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdtempSync } from 'fs'
import { homedir, platform, tmpdir } from 'os'
import { join } from 'path'
import { isolatedServerEnv } from '../src/test-ports'

const root = join(import.meta.dir, '..')

async function startPrivateHeadless(): Promise<{ url: string; stop: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'haltija-integration-'))
  // A temp HOME keeps the instance off ~/.haltija; Playwright's browsers still live under the real one.
  const browsers = join(homedir(), platform() === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright')
  const proc = spawn('bun', [join(root, 'bin/tosijs-dev.mjs'), '--private', '--headless'], {
    cwd: root,
    env: {
      ...process.env,
      ...isolatedServerEnv(dir),
      HOME: dir,
      ...(process.env.PLAYWRIGHT_BROWSERS_PATH || !existsSync(browsers) ? {} : { PLAYWRIGHT_BROWSERS_PATH: browsers }),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const stop = () => { if (proc.exitCode === null) proc.kill('SIGTERM') }
  process.on('exit', stop)
  let out = ''
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`private headless haltija did not report ready in 60s:\n${out}`)), 60_000)
    proc.stdout!.on('data', (d) => {
      out += String(d)
      const m = out.match(/HALTIJA_PRIVATE_READY (\{.*\})/)
      if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${JSON.parse(m[1]).port}`) }
    })
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`private headless haltija exited (${code}) before ready:\n${out}`)) })
  })
  // The server reports ready before its browser connects; tests that start in that gap find no tab.
  for (let i = 0; i < 120; i++) {
    const w = await fetch(`${url}/windows`).then((r) => r.json()).catch(() => null)
    if (w?.windows?.length) return { url, stop }
    await Bun.sleep(500)
  }
  stop()
  throw new Error(`private headless haltija at ${url} never connected a browser in 60s:\n${out}`)
}

const own = process.env.HALTIJA_PORT || process.env.HALTIJA_URL ? null : await startPrivateHeadless()
const env = own ? { ...process.env, HALTIJA_URL: own.url } : process.env
const run = spawnSync('bun', ['test', 'tests/'], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
own?.stop()
const output = `${run.stdout}${run.stderr}`
process.stdout.write(output)

const count = (label: string) => Number(output.match(new RegExp(`^\\s*(\\d+) ${label}$`, 'm'))?.[1] ?? 0)
const [pass, skip] = [count('pass'), count('skip')]
if (run.status !== 0) process.exit(run.status ?? 1)
if (pass === 0 || skip > 0) {
  console.error(`\ntest:integration ran ${pass} test(s) and skipped ${skip}: a skipped integration lane is not a pass.`)
  process.exit(1)
}
