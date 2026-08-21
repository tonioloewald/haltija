/** ⚠️  AUTO-GENERATED FROM src/private-state.ts — DO NOT EDIT. Run: bun run build */
// src/private-state.ts
function stalePrivateEntries(names, deps) {
  const out = [];
  for (const name of names) {
    const m = /^haltija-private-(\d+)(\.json)?$/.exec(name);
    if (!m)
      continue;
    const pid = parseInt(m[1], 10);
    if (!pid || pid === deps.selfPid)
      continue;
    if (deps.isAlive(pid))
      continue;
    out.push(name);
  }
  return out;
}
function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}
export {
  pidIsAlive,
  stalePrivateEntries
};
