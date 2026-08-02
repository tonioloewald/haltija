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
var ALL = new Set([...ROUTED_COMMANDS, ...LOCAL_COMMANDS]);
function isKnownCommand(name) {
  return ALL.has(name);
}
function cliNameForEndpoint(path) {
  const name = path.replace(/^\//, "").replace(/\//g, "-");
  return isKnownCommand(name) ? name : null;
}
export {
  isKnownCommand,
  cliNameForEndpoint,
  ROUTED_COMMANDS,
  LOCAL_COMMANDS
};
