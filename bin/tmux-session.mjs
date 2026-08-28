/** ⚠️  AUTO-GENERATED FROM src/tmux-session.ts — DO NOT EDIT. Run: bun run build */
// src/tmux-session.ts
var state = { target: null, attachedAt: null, allowInput: false, writeKey: null };
function sessionState() {
  return { ...state };
}
async function listSessions(run) {
  const res = await run(["list-sessions", "-F", "#{session_name}"]);
  if (!res.ok)
    return [];
  return res.stdout.split(`
`).map((l) => l.trim()).filter(Boolean);
}
function tokenAdvisory(hasToken) {
  if (hasToken)
    return;
  return "this server has no token, so anything that can reach its port can now read the agent's " + "terminal — not just drive the browser. Fine on a laptop; NOT fine over a tunnel. Start the " + "server with `--token <secret>` (and set HALTIJA_TOKEN for clients) if the port is reachable " + "from anywhere else.";
}
async function attachSession(run, target, hasToken = false, allowInput = false) {
  const available = await listSessions(run);
  if (!available.length) {
    return {
      ok: false,
      error: "no tmux sessions are running. Start your agent inside one — `tmux new -s agent` then run " + "it there — or attach to an existing session by name.",
      available: []
    };
  }
  if (!available.includes(target)) {
    return {
      ok: false,
      error: `no tmux session named "${target}"`,
      available
    };
  }
  state.target = target;
  state.attachedAt = Date.now();
  state.allowInput = allowInput;
  state.writeKey = allowInput ? mintKey() : null;
  return { ok: true, target, available, allowInput, writeKey: state.writeKey ?? undefined, warning: tokenAdvisory(hasToken) };
}
function detachSession() {
  state.target = null;
  state.attachedAt = null;
  state.allowInput = false;
  state.writeKey = null;
}
async function readSession(run, lines = 200) {
  if (!state.target) {
    return {
      ok: false,
      error: "no session attached. `hj session attach <tmux-session>` first — mirroring is opt-in because " + "it exposes everything the agent prints."
    };
  }
  const safeLines = Math.max(1, Math.min(1e4, Math.floor(lines) || 200));
  const res = await run(["capture-pane", "-t", state.target, "-p", "-S", `-${safeLines}`]);
  if (!res.ok) {
    return {
      ok: false,
      target: state.target,
      error: `could not read tmux session "${state.target}": ${res.stderr.trim() || "unknown error"}`
    };
  }
  return { ok: true, target: state.target, text: res.stdout.replace(/\s+$/, "") };
}
function newTailOnly(previous, current) {
  if (!previous)
    return current;
  if (current.startsWith(previous))
    return current.slice(previous.length);
  const lastLine = previous.trimEnd().split(`
`).pop() || "";
  if (lastLine) {
    const idx = current.lastIndexOf(lastLine);
    if (idx !== -1)
      return current.slice(idx + lastLine.length);
  }
  return current;
}
function mintKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function keyMatches(provided, expected) {
  if (provided.length !== expected.length)
    return false;
  let diff = 0;
  for (let i = 0;i < provided.length; i++)
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
async function writeSession(run, text, submit = true, writeKey = "") {
  if (!state.target) {
    return { ok: false, error: "no session attached. `hj session attach <tmux-session>` first." };
  }
  if (!state.allowInput || !state.writeKey) {
    return {
      ok: false,
      target: state.target,
      error: "this session was attached for reading only; writing is a separate grant made at attach time."
    };
  }
  if (!keyMatches(writeKey, state.writeKey)) {
    return {
      ok: false,
      target: state.target,
      error: "missing or invalid write key. The handle is returned once, to the caller that attached " + "with input permitted; pass it as `writeKey`."
    };
  }
  if (!text)
    return { ok: false, target: state.target, error: "nothing to send" };
  const args = ["send-keys", "-t", state.target, "-l", "--", text];
  const res = await run(args);
  if (res.ok && submit) {
    const nl = await run(["send-keys", "-t", state.target, "Enter"]);
    if (!nl.ok) {
      return { ok: false, target: state.target, error: nl.stderr.trim() || "send-keys Enter failed" };
    }
  }
  return res.ok ? { ok: true, target: state.target } : { ok: false, target: state.target, error: res.stderr.trim() || "send-keys failed" };
}
export {
  attachSession,
  detachSession,
  listSessions,
  newTailOnly,
  readSession,
  sessionState,
  tokenAdvisory,
  writeSession
};
