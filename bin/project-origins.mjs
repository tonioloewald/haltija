/** ⚠️  AUTO-GENERATED FROM src/project-origins.ts — DO NOT EDIT. Run: bun run build */
// src/project-origins.ts
import { existsSync, readFileSync } from "fs";
import { dirname, join, parse as parsePath } from "path";
function normalizeOrigin(value) {
  const v = String(value || "").trim();
  if (!v)
    return null;
  const parse = (candidate) => {
    try {
      const origin = new URL(candidate).origin;
      return origin && origin !== "null" ? origin : null;
    } catch {
      return null;
    }
  };
  return parse(v) ?? parse(`http://${v}`);
}
function findProjectOrigins(cwd, env = process.env) {
  const fromEnv = env.HALTIJA_ORIGINS;
  if (fromEnv && fromEnv.trim()) {
    const origins = fromEnv.split(",").map(normalizeOrigin).filter((o) => !!o);
    if (origins.length)
      return { origins, source: "HALTIJA_ORIGINS env" };
  }
  let dir = cwd;
  const { root } = parsePath(cwd);
  for (let depth = 0;depth < 64; depth++) {
    const file = join(dir, ".haltija.json");
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf-8"));
        const raw = Array.isArray(parsed?.origins) ? parsed.origins : [];
        const origins = raw.map(normalizeOrigin).filter((o) => !!o);
        return { origins, source: file };
      } catch {
        return { origins: [], source: `${file} (unreadable or invalid JSON)` };
      }
    }
    if (dir === root)
      break;
    const parent = dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  return null;
}
function routeByDeclaredOrigin(declared, tabs, focusedWindowId) {
  if (!declared.length)
    return { kind: "no-declaration" };
  const wanted = new Set(declared);
  const topLevel = tabs.filter((t) => (t.windowType || "tab") === "tab");
  const matches = topLevel.filter((t) => {
    const o = normalizeOrigin(t.url || "");
    return o !== null && wanted.has(o);
  });
  if (!matches.length) {
    const sawOrigins = [...new Set(topLevel.map((t) => normalizeOrigin(t.url || "")).filter((o) => !!o))];
    return { kind: "no-match", declared, sawOrigins };
  }
  const visible = matches.filter((t) => t.active !== false);
  const pool = visible.length ? visible : matches;
  const focused = pool.find((t) => t.id === focusedWindowId);
  const chosen = focused || pool[0];
  return {
    kind: "matched",
    windowId: chosen.id,
    origin: normalizeOrigin(chosen.url || ""),
    candidates: matches.length
  };
}
export {
  routeByDeclaredOrigin,
  normalizeOrigin,
  findProjectOrigins
};
