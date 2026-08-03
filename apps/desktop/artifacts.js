/** ⚠️  AUTO-GENERATED FROM src/artifacts.ts — DO NOT EDIT. Run: bun run build */
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/artifacts.ts
var exports_artifacts = {};
__export(exports_artifacts, {
  saveDataUrl: () => saveDataUrl,
  pruneKind: () => pruneKind,
  pruneArtifacts: () => pruneArtifacts,
  parseDataUrl: () => parseDataUrl,
  artifactDir: () => artifactDir,
  RETENTION: () => RETENTION
});
module.exports = __toCommonJS(exports_artifacts);
var import_promises = require("fs/promises");
var import_path = require("path");
var import_os = require("os");
function artifactDir(kind) {
  return import_path.join(process.env.HALTIJA_ARTIFACT_DIR || import_os.tmpdir(), `haltija-${kind}`);
}
function parseDataUrl(dataUrl) {
  const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || "");
  if (!match)
    return null;
  return { ext: match[1] === "jpeg" ? "jpg" : match[1], base64: match[2] };
}
var RETENTION = {
  screenshots: { maxAgeMs: 24 * 60 * 60 * 1000, keep: 200 },
  schematics: { maxAgeMs: 24 * 60 * 60 * 1000, keep: 200 },
  videos: { maxAgeMs: 24 * 60 * 60 * 1000, keep: 20 }
};
function pruneKind(kind) {
  return pruneArtifacts(artifactDir(kind), RETENTION[kind]);
}
async function pruneArtifacts(dir, { maxAgeMs = 24 * 60 * 60 * 1000, keep = 200 } = {}) {
  let removed = 0;
  try {
    const names = await import_promises.readdir(dir);
    const entries = [];
    for (const name of names) {
      const path = import_path.join(dir, name);
      try {
        const st = await import_promises.stat(path);
        if (st.isFile())
          entries.push({ path, mtime: st.mtimeMs });
      } catch {}
    }
    const now = Date.now();
    const survivors = [];
    for (const e of entries) {
      if (now - e.mtime > maxAgeMs) {
        try {
          await import_promises.unlink(e.path);
          removed++;
        } catch {}
      } else {
        survivors.push(e);
      }
    }
    survivors.sort((a, b) => b.mtime - a.mtime);
    for (const e of survivors.slice(keep)) {
      try {
        await import_promises.unlink(e.path);
        removed++;
      } catch {}
    }
  } catch {}
  return removed;
}
async function saveDataUrl(dataUrl, opts) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed)
    return { error: "not a base64 image data URL" };
  const dir = artifactDir(opts.kind);
  try {
    await import_promises.mkdir(dir, { recursive: true });
    const shortId = Math.random().toString(36).slice(2, 6);
    const path = import_path.join(dir, `${opts.prefix || "hj"}-${Date.now()}-${shortId}.${parsed.ext}`);
    await import_promises.writeFile(path, Buffer.from(parsed.base64, "base64"));
    pruneKind(opts.kind);
    return { path, ext: parsed.ext };
  } catch (err) {
    return { error: err.message };
  }
}
