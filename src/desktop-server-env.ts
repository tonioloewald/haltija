/**
 * The environment the desktop app hands each server child it spawns.
 *
 * Extracted from `apps/desktop/main.js` because getting it wrong is silent and expensive, and it has
 * been wrong: the port was passed as `PORT`, which `src/server.ts` never reads (it reads
 * `HALTIJA_PORT` / `DEV_CHANNEL_PORT`). So a spawned child ignored the port it was given and
 * inherited the app's instead — the internal chrome server tried to bind the *public* port,
 * collided, and died. Nothing reported it; the internal widget was simply absent.
 *
 * Pure function, so the contract can be asserted without launching Electron. `main.js` calls it.
 */

export interface DesktopServerEnvOptions {
  /** Port this child should bind. Ignored for a private run, which binds ephemerally. */
  port: number | string
  /** 'public' is the server agents drive; 'internal' hosts the app's own chrome widget. */
  role: 'public' | 'internal'
  /** An isolated instance: ephemeral port, no registry, no reaching out. */
  isPrivate?: boolean
  /** Where a private child reports its ephemeral port. Required when isPrivate. */
  portFile?: string
}

export function buildServerEnv(
  base: Record<string, string | undefined>,
  opts: DesktopServerEnvOptions,
): Record<string, string> {
  const port = String(opts.port)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v

  env.PORT = port // kept for anything else that may read it
  env.HALTIJA_PORT = port // what src/server.ts ACTUALLY reads
  env.DEV_CHANNEL_PORT = port
  env.HALTIJA_DESKTOP = '1'
  // Only the PUBLIC server registers under the reserved `desktop` name, so `hj --name desktop` finds
  // the one agents drive; the internal chrome server stays out of the registry entirely.
  env.HALTIJA_DESKTOP_PUBLIC = opts.role === 'public' ? '1' : '0'

  if (opts.isPrivate) {
    // Isolation: bind ephemeral (HALTIJA_PRIVATE forces port 0), touch nothing shared, and report
    // the bound port to this child's OWN port-file — never the caller's, which the app writes once
    // with the public address.
    env.HALTIJA_PRIVATE = '1'
    env.HALTIJA_NO_RETIRE = '1'
    env.HALTIJA_NO_INSTALL = '1'
    if (opts.portFile) env.HALTIJA_PORT_FILE = opts.portFile
    // These would pin a fixed port and defeat the ephemeral binding.
    delete env.HALTIJA_PORT
    delete env.DEV_CHANNEL_PORT
  } else {
    // A non-private child must not inherit a private parent's flags.
    delete env.HALTIJA_PRIVATE
    delete env.HALTIJA_PORT_FILE
  }
  return env
}
