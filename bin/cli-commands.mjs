/** ⚠️  AUTO-GENERATED FROM src/cli-commands.ts — DO NOT EDIT. Run: bun run build */
// src/cli-commands.ts
var ROUTED_COMMANDS = [
  "tree",
  "map",
  "query",
  "inspect",
  "inspectAll",
  "styles",
  "find",
  "form",
  "wait",
  "click",
  "type",
  "key",
  "drag",
  "scroll",
  "call",
  "navigate",
  "refresh",
  "location",
  "events",
  "events-watch",
  "events-unwatch",
  "console",
  "mutations-watch",
  "mutations-unwatch",
  "mutations-status",
  "eval",
  "fetch",
  "screenshot",
  "snapshot",
  "highlight",
  "unhighlight",
  "select-start",
  "select-result",
  "select-cancel",
  "select-clear",
  "windows",
  "tabs-open",
  "tabs-close",
  "tabs-focus",
  "video-start",
  "video-stop",
  "video-status",
  "network",
  "network-watch",
  "network-unwatch",
  "network-stats",
  "recording",
  "recording-start",
  "recording-stop",
  "recording-generate",
  "recordings",
  "test-run",
  "test-validate",
  "test-suite",
  "session-attach",
  "session-read",
  "session-write",
  "session-detach",
  "send",
  "send-message",
  "send-selection",
  "send-recording",
  "status",
  "version",
  "docs",
  "api",
  "stats",
  "where"
];
var LOCAL_COMMANDS = ["where", "servers", "ls", "doctor", "shutdown", "quit"];
var LOCAL_COMMAND_HELP = {
  where: {
    summary: "Which server this shell targets, and why",
    detail: `Prints the resolved port, WHICH rule chose it (--port > --name/HALTIJA_NAME > HALTIJA_PORT >
` + `  cwd match > the 8700 default), and what is actually alive there — version, tab count,
` + `  declared origins. Start here when a command drove the wrong browser: a misroute is silent
` + `  and looks like a flaky test rather than an error.

` + "  Flags: --json"
  },
  servers: {
    summary: "Every live haltija, with the one you would drive marked",
    detail: `Enumerates registry entries, the well-known defaults 8700/8701 (probed, to catch anything
` + `  unregistered), and this shell's resolved target — port, name, version, tab count, and
` + "  whether it is the desktop app. The one `hj` would talk to is marked with ▸.\n" + "  Target another with `hj --port <n>` or `hj --name <name>`.\n\n" + "  Alias: hj ls    Flags: --json"
  },
  ls: { summary: "Alias for `hj servers`", detail: "See `hj servers --help`." },
  doctor: {
    summary: "Preflight: is this thing drivable? (exits non-zero if not)",
    detail: `Checks the server is reachable, a browser is connected, a tab is drivable, and the client
` + `  and server versions agree. Reports THREE verdicts, not two:

` + `    ✓  checked, and fine
` + `    ✗  checked, and broken   → exits 1
` + `    ?  could NOT be checked  → not a pass; use --strict to make it exit 1 too

` + `  The third state exists because "I verified this" and "I could not verify this" are
` + `  different facts, and collapsing them into ✓ is how a preflight reports green on a server
` + `  it never reached.

` + "  Flags: --json, --strict (also HALTIJA_STRICT=1)"
  },
  shutdown: {
    summary: "Ask the target server to stop, cleanly",
    detail: `POSTs /shutdown, so the server releases its port and removes its registry entry itself.
` + `  This is a request, not a signal — haltija never maps a port to a pid and kills it, because
` + "  `lsof -i :PORT` matches CONNECTED CLIENTS as well as listeners and would happily return a\n" + `  browser that has been open since login.

` + `  On a private desktop instance this tears down the whole app (server + Electron).

` + "  Alias: hj quit"
  },
  quit: { summary: "Alias for `hj shutdown`", detail: "See `hj shutdown --help`." }
};
var ALL = new Set([...ROUTED_COMMANDS, ...LOCAL_COMMANDS]);
function isKnownCommand(name) {
  return ALL.has(name);
}
function cliNameForEndpoint(path) {
  const name = path.replace(/^\//, "").replace(/\//g, "-");
  return isKnownCommand(name) ? name : null;
}
export {
  LOCAL_COMMANDS,
  LOCAL_COMMAND_HELP,
  ROUTED_COMMANDS,
  cliNameForEndpoint,
  isKnownCommand
};
