/** ⚠️  AUTO-GENERATED FROM src/semver.ts — DO NOT EDIT. Run: bun run build */
// src/semver.ts
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m)
    return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : []
  };
}
function comparePrerelease(a, b) {
  if (!a.length && !b.length)
    return 0;
  if (!a.length)
    return 1;
  if (!b.length)
    return -1;
  for (let i = 0;i < Math.max(a.length, b.length); i++) {
    if (i >= a.length)
      return -1;
    if (i >= b.length)
      return 1;
    const x = a[i];
    const y = b[i];
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0)
        return diff < 0 ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else {
      if (x !== y)
        return x < y ? -1 : 1;
    }
  }
  return 0;
}
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb)
    return null;
  if (pa.major !== pb.major)
    return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor)
    return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch)
    return pa.patch < pb.patch ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}
function isOlderThan(a, b) {
  return compareVersions(a, b) === -1;
}
function differsBeyondPatch(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb)
    return false;
  return pa.major !== pb.major || pa.minor !== pb.minor;
}
export {
  parseVersion,
  isOlderThan,
  differsBeyondPatch,
  compareVersions
};
