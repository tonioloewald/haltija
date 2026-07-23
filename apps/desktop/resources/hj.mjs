#!/usr/bin/env bun
// haltija-cli:do-not-edit v1.5.6
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// bin/cli-subcommand.mjs
import { spawn } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// bin/format-tree.mjs
var MAX_TEXT_LEN = 80;
function formatTree(node, indent = 0, { depth } = {}) {
  if (!node)
    return "";
  const lines = [];
  formatNode(node, indent, lines);
  const d = depth ?? -1;
  const depthLabel = d === -1 ? "unlimited" : String(d);
  lines.push("---");
  lines.push(`depth=${depthLabel} | -d N | -i (interactive) | --visible | --json`);
  return lines.join(`
`);
}
function formatNode(node, indent, lines) {
  if (!node)
    return;
  if (node.tag === "haltija-dev")
    return;
  const prefix = " ".repeat(indent);
  const hasChildren = node.children && node.children.length > 0 || node.shadowChildren && node.shadowChildren.length > 0;
  const line = buildLine(node);
  if (hasChildren) {
    lines.push(`${prefix}( ${line}`);
    if (node.children) {
      for (const child of node.children) {
        formatNode(child, indent + 2, lines);
      }
    }
    if (node.shadowChildren) {
      for (const child of node.shadowChildren) {
        if (child.classes && child.classes.includes("widget"))
          continue;
        formatNode(child, indent + 2, lines);
      }
    }
    lines.push(`${prefix})`);
  } else {
    lines.push(`${prefix}${line}`);
  }
}
function buildLine(node) {
  const parts = [];
  parts.push(node.ref || "?");
  let tagPart = node.tag || "?";
  if (node.id)
    tagPart += `#${node.id}`;
  if (node.classes && node.classes.length) {
    tagPart += "." + node.classes.join(".");
  }
  parts.push(tagPart);
  if (node.attrs) {
    for (const [key, val] of Object.entries(node.attrs)) {
      if (val === "" || val === "true") {
        parts.push(key);
      } else if (/\s/.test(val) || val.length > 40) {
        parts.push(`${key}="${truncate(val, 40)}"`);
      } else {
        parts.push(`${key}=${val}`);
      }
    }
  }
  if (node.value !== undefined && node.value !== "") {
    parts.push(`value="${truncate(node.value, 30)}"`);
  }
  if (node.checked !== undefined) {
    parts.push(node.checked ? "checked" : "unchecked");
  }
  const flags = formatFlags(node.flags);
  if (flags)
    parts.push(flags);
  if (node.text) {
    parts.push(`"${truncate(node.text, MAX_TEXT_LEN)}"`);
  }
  if (node.truncated && node.childCount) {
    parts.push(`(${node.childCount} children)`);
  }
  return parts.join(" ");
}
function formatFlags(flags) {
  if (!flags)
    return "";
  const parts = [];
  if (flags.interactive)
    parts.push("interactive");
  if (flags.disabled)
    parts.push("disabled");
  if (flags.required)
    parts.push("required");
  if (flags.readOnly)
    parts.push("readonly");
  if (flags.focused)
    parts.push("focused");
  if (flags.hidden && flags.hiddenReason) {
    parts.push(`hidden:${flags.hiddenReason}`);
  } else if (flags.hidden) {
    parts.push("hidden");
  }
  if (flags.offScreen && !flags.hidden)
    parts.push("offscreen");
  if (flags.customElement)
    parts.push("custom");
  if (flags.hasAria)
    parts.push("aria");
  return parts.join(" ");
}
function truncate(str, max) {
  if (!str)
    return "";
  if (str.length <= max)
    return str;
  return str.slice(0, max - 1) + "…";
}

// bin/format-events.mjs
function formatEvents(response) {
  const events = response?.events || response;
  if (!events || !Array.isArray(events) || events.length === 0) {
    return `(no events)
---
hj events --json`;
  }
  const lines = events.map((ev) => {
    const parts = [];
    parts.push(String(ev.timestamp));
    parts.push(ev.type);
    const target = formatTarget(ev.target);
    if (target)
      parts.push(target);
    const summary = extractPayloadSummary(ev);
    if (summary)
      parts.push(summary);
    return parts.join(" ");
  });
  const sinceTs = events[0].timestamp;
  lines.push("---");
  lines.push(`hj events --json --since=${sinceTs}`);
  return lines.join(`
`);
}
function formatTarget(target) {
  if (!target)
    return "";
  let result = target.tag || "";
  if (target.id) {
    result += `#${target.id}`;
  } else if (target.selector) {
    return target.selector;
  }
  return result || "";
}
function extractPayloadSummary(ev) {
  const { type, payload, target } = ev;
  if (!payload && !target)
    return "";
  if (type === "input:typed") {
    return quote(payload?.text || payload?.finalValue || "");
  }
  if (type === "interaction:click") {
    return quote(payload?.text || target?.text || "");
  }
  if (type === "interaction:submit") {
    return payload?.formAction || payload?.formId || "";
  }
  if (type?.startsWith("navigation:")) {
    return payload?.to || payload?.url || "";
  }
  if (type?.startsWith("console:")) {
    return quote(truncate2(payload?.message || "", 120));
  }
  if (type === "scroll:stop") {
    return `${payload?.direction || ""} ${payload?.distance || 0}px`;
  }
  if (type === "hover:dwell") {
    return `${payload?.duration || 0}ms`;
  }
  if (type === "mutation:change") {
    const what = payload?.changeType || "";
    const el = payload?.element || "";
    return `${what} ${el}`.trim();
  }
  if (type === "focus:focus" || type === "focus:blur") {
    return target?.text || target?.selector || "";
  }
  if (payload) {
    for (const val of Object.values(payload)) {
      if (typeof val === "string" && val.length > 0 && val.length < 200) {
        return quote(truncate2(val, 80));
      }
    }
  }
  return "";
}
function quote(s) {
  if (!s)
    return "";
  return `"${s}"`;
}
function truncate2(str, max) {
  if (!str || str.length <= max)
    return str;
  return str.slice(0, max - 1) + "…";
}

// bin/format-test.mjs
function formatTestResult(result) {
  if (!result)
    return `(no result)
---
hj test-run --json`;
  const lines = [];
  const status = result.passed ? "ok" : "FAIL";
  const name = result.test || "unnamed";
  const duration = result.duration ? `${result.duration}ms` : "";
  const counts = result.summary ? `${result.summary.passed}/${result.summary.total}` : "";
  lines.push([status, name, duration, counts].filter(Boolean).join(" "));
  if (result.steps) {
    for (const step of result.steps) {
      const stepStatus = step.passed ? "ok" : step.error === "skipped" ? "skip" : "FAIL";
      const desc = formatStepDescription(step);
      const dur = step.duration ? `${step.duration}ms` : "";
      const err = !step.passed && step.error && step.error !== "skipped" ? step.error : "";
      lines.push(`  ${step.index + 1} ${[stepStatus, desc, dur, err].filter(Boolean).join(" ")}`);
      if (!step.passed && step.context) {
        const detail = formatFailureContext(step.context);
        if (detail)
          lines.push(`    > ${detail}`);
      }
    }
  }
  if (result.patience) {
    const p = result.patience;
    lines.push(`  patience ${p.remaining}/${p.allowed} remaining streak=${p.consecutiveFailures}/${p.streak} timeout=${p.finalTimeoutMs}ms`);
  }
  lines.push("---");
  lines.push("hj test-run --json");
  return lines.join(`
`);
}
function formatSuiteResult(result) {
  if (!result)
    return `(no result)
---
hj test-run --json`;
  const lines = [];
  const status = result.summary?.failed === 0 ? "ok" : "FAIL";
  const duration = result.duration ? `${result.duration}ms` : "";
  const counts = result.summary ? `${result.summary.passed}/${result.summary.total} tests` : "";
  lines.push([status, "suite", duration, counts].filter(Boolean).join(" "));
  if (result.results) {
    for (const testResult of result.results) {
      const tStatus = testResult.passed ? "ok" : "FAIL";
      const name = testResult.test || "unnamed";
      const dur = testResult.duration ? `${testResult.duration}ms` : "";
      const tCounts = testResult.summary ? `${testResult.summary.passed}/${testResult.summary.total}` : "";
      lines.push(`  ${[tStatus, name, dur, tCounts].filter(Boolean).join(" ")}`);
      if (!testResult.passed && testResult.steps) {
        const failed = testResult.steps.find((s) => !s.passed);
        if (failed) {
          const desc = formatStepDescription(failed);
          const err = failed.error || "";
          lines.push(`    step ${failed.index + 1}: ${[desc, err].filter(Boolean).join(" ")}`);
          if (failed.context) {
            const detail = formatFailureContext(failed.context);
            if (detail)
              lines.push(`    > ${detail}`);
          }
        }
      }
    }
  }
  lines.push("---");
  lines.push("hj test-run --json");
  return lines.join(`
`);
}
function formatStepDescription(step) {
  const s = step.step || step;
  const action = s.action || step.description || "";
  switch (action) {
    case "navigate":
      return `navigate ${s.url || ""}`;
    case "click":
      return `click ${s.selector || s.ref || ""}`;
    case "type":
      return `type ${s.selector || s.ref || ""} "${truncate3(s.text || "", 30)}"`;
    case "key":
      return `key ${s.key || ""}`;
    case "wait":
      return `wait ${s.selector || s.url || (s.forWindow ? "new window" : "") || (s.duration != null ? s.duration + "ms" : "") || ""}`;
    case "assert": {
      const a = s.assertion || {};
      const sel = a.selector || "";
      const val = a.text || a.value || a.pattern || "";
      return `assert ${a.type || ""} ${sel} ${val ? '"' + truncate3(val, 30) + '"' : ""}`.trim();
    }
    case "check":
      return `check ${s.selector || ""}`;
    case "eval":
      return `eval ${truncate3(s.code || "", 40)}`;
    case "verify":
      return `verify ${truncate3(s.eval || "", 40)}`;
    case "tabs-open":
      return `tabs-open ${s.url || ""}`;
    case "tabs-close":
      return `tabs-close ${s.window || ""}`;
    case "tabs-focus":
      return `tabs-focus ${s.window || ""}`;
    default:
      return step.description || action || "unknown";
  }
}
function formatFailureContext(context) {
  const parts = [];
  if (context.reason) {
    parts.push(context.reason);
  }
  if (context.buttonsOnPage?.length) {
    parts.push(`page shows: [${context.buttonsOnPage.join(", ")}]`);
  }
  if (context.actual !== undefined && context.expected !== undefined) {
    parts.push(`expected "${context.expected}" got "${context.actual}"`);
  }
  if (context.suggestion) {
    parts.push(context.suggestion);
  }
  return parts.join(", ");
}
function truncate3(str, max) {
  if (!str || str.length <= max)
    return str;
  return str.slice(0, max - 1) + "…";
}

// bin/format-network.mjs
var red = (s) => `\x1B[31m${s}\x1B[0m`;
var yellow = (s) => `\x1B[33m${s}\x1B[0m`;
var green = (s) => `\x1B[32m${s}\x1B[0m`;
var dim = (s) => `\x1B[2m${s}\x1B[0m`;
function statusColor(status) {
  if (status === -1)
    return red;
  if (status >= 500)
    return red;
  if (status >= 400)
    return yellow;
  if (status >= 300)
    return dim;
  if (status >= 200)
    return green;
  return dim;
}
function formatNetwork(data) {
  if (!data || data.success === false) {
    return data?.error || "Network monitoring not available";
  }
  const entries = data.entries || data.data?.entries || [];
  const summary = data.summary || data.data?.summary || "";
  if (entries.length === 0) {
    if (summary)
      return dim(summary);
    return dim("No network entries captured. Run: hj network watch");
  }
  const lines = [];
  const errors = entries.filter((e) => e.s >= 400 || e.s === -1 || e.err);
  const ok = entries.filter((e) => e.s > 0 && e.s < 400 && !e.err);
  for (const e of errors) {
    lines.push(formatEntry(e));
  }
  if (errors.length > 0 && ok.length > 0) {
    lines.push("");
  }
  for (const e of ok) {
    lines.push(formatEntry(e));
  }
  if (summary) {
    lines.push("");
    lines.push(dim(summary));
  }
  return lines.join(`
`);
}
function formatEntry(e) {
  const method = e.m.padEnd(4);
  const colorFn = statusColor(e.s);
  const status = e.s === 0 ? dim("...") : e.s === -1 ? red("ERR") : colorFn(String(e.s));
  const url = e.url || "";
  const time = e.t ? dim(`${e.t}ms`) : "";
  const size = e.sz ? dim(e.sz) : "";
  const err = e.err ? red(` (${e.err})`) : "";
  const redirects = e.redirects ? dim(` ${e.redirects}→`) : "";
  return `${method} ${status} ${url}${redirects}${err} ${time} ${size}`.trimEnd();
}
function formatNetworkStats(data) {
  if (!data || data.success === false) {
    return data?.error || "Network monitoring not available";
  }
  const stats = data.data || data;
  if (!stats.watching) {
    return dim("Not watching. Run: hj network watch");
  }
  return stats.summary || `${stats.total} req, ${stats.failed} failed, ${stats.avgTime}ms avg`;
}

// bin/test-data.mjs
function xorshift32(state) {
  let s = state | 0;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return [s >>> 0, s >>> 0];
}

class SeededRandom {
  constructor(seed) {
    this.state = (seed === 0 ? 1 : seed) >>> 0;
  }
  next() {
    const [value, newState] = xorshift32(this.state);
    this.state = newState;
    return value / 4294967296;
  }
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }
  hex(len) {
    let s = "";
    for (let i = 0;i < len; i++)
      s += this.int(0, 15).toString(16);
    return s;
  }
}
var FIRST_NAMES = [
  "Tessia",
  "Testopher",
  "Testina",
  "Qadir",
  "Qaleen",
  "Checkov",
  "Validia",
  "Assertia",
  "Debugson",
  "Mockwell",
  "Fixturia",
  "Stubson",
  "Spectra",
  "Suitewell",
  "Runley",
  "Passandra",
  "Failsworth",
  "Edgeworth",
  "Boundara",
  "Flaxton"
];
var WORDS = [
  "quick",
  "brown",
  "fox",
  "lazy",
  "dog",
  "test",
  "data",
  "jumps",
  "over",
  "fence",
  "under",
  "bridge",
  "through",
  "forest",
  "around",
  "mountain",
  "beside",
  "river",
  "across",
  "valley",
  "between",
  "clouds",
  "above",
  "ocean",
  "below"
];
var COMPANIES = [
  "Haltija Test Corp",
  "QA Industries",
  "Assertion Labs",
  "Testify Inc",
  "Validate Co",
  "Fixture Holdings",
  "Mock & Sons",
  "Spec Systems",
  "Check Group",
  "Edge Corp"
];
var STREETS = [
  "Test Avenue",
  "QA Boulevard",
  "Assertion Lane",
  "Validate Street",
  "Debug Drive",
  "Fixture Road",
  "Mock Court",
  "Spec Way",
  "Check Circle",
  "Edge Parkway",
  "Suite Plaza",
  "Run Terrace"
];
var CITIES = [
  "Testville",
  "QA City",
  "Assertonia",
  "Validateburg",
  "Debugton",
  "Mockford",
  "Specburgh",
  "Fixtureopolis"
];
var EVIL_XSS = [
  `<script>alert('xss')</script>`,
  `"><img src=x onerror=alert('xss')>`,
  `'><svg/onload=alert('xss')>`,
  `javascript:alert('xss')`,
  `<img src="x" onerror="alert(document.cookie)">`,
  `<div onmouseover="alert('xss')">hover me</div>`,
  `<script>alert('xss')</script>`,
  `<iframe src="javascript:alert('xss')"></iframe>`,
  `<body onload=alert('xss')>`,
  `<input onfocus=alert('xss') autofocus>`
];
var EVIL_SQL = [
  `'; DROP TABLE users; --`,
  `1 OR 1=1`,
  `' UNION SELECT * FROM users --`,
  `1; UPDATE users SET role='admin' WHERE 1=1; --`,
  `' OR '1'='1`,
  `'; EXEC xp_cmdshell('whoami'); --`,
  `1' AND (SELECT COUNT(*) FROM users) > 0 --`,
  `admin'--`,
  `' OR 1=1 LIMIT 1 --`,
  `'; INSERT INTO log VALUES('pwned'); --`
];
var EVIL_UNICODE = [
  "​‌‍\uFEFF",
  "‮Reverse",
  "АВС",
  "À́̂̃̄",
  "���",
  "\u2028\u2029",
  "\x00\x01\x02",
  "\uD800",
  "a͏a",
  "‏‎"
];
var EVIL_EMOJI = [
  "\uD83D\uDC68‍\uD83D\uDC69‍\uD83D\uDC67‍\uD83D\uDC66",
  "\uD83D\uDC4B\uD83C\uDFFD",
  "\uD83C\uDDFA\uD83C\uDDF8",
  "\uD83D\uDC68‍\uD83D\uDCBB",
  "\uD83C\uDFF3️‍\uD83C\uDF08",
  "\uD83E\uDDD1‍\uD83E\uDDD1‍\uD83E\uDDD2",
  "\uD83D\uDE00\uD83D\uDE01\uD83D\uDE02\uD83D\uDE03\uD83D\uDE04",
  "#️⃣",
  "\uD83E\uDEE0",
  "\uD83D\uDE00\uD83D\uDE01\uD83D\uDE02\uD83E\uDD23\uD83D\uDE03\uD83D\uDE04\uD83D\uDE05\uD83D\uDE06\uD83D\uDE07\uD83E\uDD70"
];
var EVIL_WHITESPACE = [
  ` 	
\r\v\f`,
  "      ",
  "      ",
  "　",
  `\r
\r

\r`,
  "\t\t\t\t\t\t\t\t",
  "     ",
  "  ",
  "   ​   ",
  "᠎⁠"
];
var EVIL_NULL = [
  "null",
  "undefined",
  "NaN",
  "Infinity",
  "-Infinity",
  "true",
  "false",
  "0",
  "-0",
  "",
  "None",
  "nil",
  "NULL",
  "void",
  "[object Object]"
];
var EVIL_PATH = [
  "../../etc/passwd",
  "C:\\windows\\system32\\config\\sam",
  "/dev/null",
  "..\\..\\..\\windows\\system32",
  "file:///etc/passwd",
  "\\\\server\\share\\file",
  "/proc/self/environ",
  "CON",
  "PRN",
  "AUX",
  "NUL"
];
var EVIL_FORMAT = [
  "%s%s%s%s%s%s%s%s%s%s",
  "${7*7}",
  '{{constructor.constructor("return this")()}}',
  "#{7*7}",
  "<%= 7*7 %>",
  "{{7*7}}",
  "${toString}",
  "$(whoami)",
  "`whoami`",
  "{${<%[%'\"}}%\\."
];
var ALIASES = {
  "NAME.FIRST": "PERSON.FIRST",
  "NAME.LAST": "PERSON.LAST",
  "NAME.FULL": "PERSON.FULL",
  NAME: "PERSON.FULL",
  "TEXT.SENTENCE": "TEXT",
  WORD: "TEXT.SHORT",
  INT: "NUMBER",
  "ADDRESS.POSTAL": "ADDRESS.ZIP"
};
function createTestDataGenerator(seed) {
  const actualSeed = seed ?? (Date.now() ^ Math.random() * 4294967296) >>> 0;
  const rng = new SeededRandom(actualSeed);
  const tag = rng.hex(4);
  const cache = new Map;
  function canonicalize(type) {
    const upper = type.toUpperCase();
    return ALIASES[upper] ?? upper;
  }
  function generate(type) {
    const key = canonicalize(type);
    if (cache.has(key))
      return cache.get(key);
    const value = generateFresh(key);
    cache.set(key, value);
    return value;
  }
  function generateFresh(upper) {
    if (upper === "PERSON.FIRST")
      return rng.pick(FIRST_NAMES);
    if (upper === "PERSON.LAST")
      return `Haltija-${tag}`;
    if (upper === "PERSON.FULL")
      return `${generate("PERSON.FIRST")} ${generate("PERSON.LAST")}`;
    if (upper === "EMAIL")
      return `${generate("PERSON.FIRST").toLowerCase()}.${tag}@haltija-test.example`;
    if (upper === "PHONE")
      return `+1-555-0${rng.int(100, 199)}`;
    if (upper === "USERNAME")
      return `test_${generate("PERSON.FIRST").toLowerCase()}_${tag}`;
    if (upper === "PASSWORD")
      return `Test!Pass#${tag}${rng.hex(2)}`;
    if (upper === "TEXT") {
      const len = rng.int(5, 10);
      const words = Array.from({ length: len }, () => rng.pick(WORDS));
      words[0] = words[0][0].toUpperCase() + words[0].slice(1);
      return words.join(" ") + ".";
    }
    if (upper === "TEXT.SHORT")
      return rng.pick(WORDS);
    if (upper === "TEXT.PARAGRAPH") {
      return Array.from({ length: rng.int(3, 6) }, () => generateFresh("TEXT")).join(" ");
    }
    if (upper === "NUMBER")
      return String(rng.int(1, 9999));
    const rangeMatch = upper.match(/^NUMBER\.RANGE\((\d+),\s*(\d+)\)$/);
    if (rangeMatch)
      return String(rng.int(parseInt(rangeMatch[1]), parseInt(rangeMatch[2])));
    if (upper === "UUID")
      return `hj-${rng.hex(8)}-${rng.hex(4)}-${rng.hex(4)}-${rng.hex(4)}-${rng.hex(12)}`;
    if (upper === "DATE") {
      const y = rng.int(2024, 2026), m = rng.int(1, 12), d = rng.int(1, 28);
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    if (upper === "DATE.FUTURE")
      return new Date(Date.now() + rng.int(1, 365) * 86400000).toISOString().slice(0, 10);
    if (upper === "DATE.PAST")
      return new Date(Date.now() - rng.int(1, 365) * 86400000).toISOString().slice(0, 10);
    if (upper === "URL")
      return `https://haltija-test.example/${tag}`;
    if (upper === "COMPANY")
      return `${rng.pick(COMPANIES)} ${tag}`;
    if (upper === "ADDRESS.STREET")
      return `${rng.int(1, 9999)} ${rng.pick(STREETS)}`;
    if (upper === "ADDRESS.CITY")
      return rng.pick(CITIES);
    if (upper === "ADDRESS.ZIP")
      return `555${String(rng.int(0, 99)).padStart(2, "0")}`;
    if (upper === "ADDRESS.FULL")
      return `${generateFresh("ADDRESS.STREET")}, ${generateFresh("ADDRESS.CITY")} ${generateFresh("ADDRESS.ZIP")}`;
    if (upper === "EVIL.XSS")
      return rng.pick(EVIL_XSS);
    if (upper === "EVIL.SQL")
      return rng.pick(EVIL_SQL);
    if (upper === "EVIL.UNICODE")
      return rng.pick(EVIL_UNICODE);
    if (upper === "EVIL.EMOJI")
      return rng.pick(EVIL_EMOJI);
    if (upper === "EVIL.WHITESPACE")
      return rng.pick(EVIL_WHITESPACE);
    if (upper === "EVIL.LONG")
      return "A".repeat(1e4);
    if (upper === "EVIL.EMPTY")
      return "";
    if (upper === "EVIL.NULL")
      return rng.pick(EVIL_NULL);
    if (upper === "EVIL.PATH")
      return rng.pick(EVIL_PATH);
    if (upper === "EVIL.FORMAT")
      return rng.pick(EVIL_FORMAT);
    if (upper === "EVIL") {
      const cats = ["XSS", "SQL", "UNICODE", "EMOJI", "WHITESPACE", "NULL", "PATH", "FORMAT"];
      return generateFresh(`EVIL.${rng.pick(cats)}`);
    }
    return `[unknown:${upper}]`;
  }
  return { generate, seed: actualSeed };
}
function substituteGeneratedVars(text, seed) {
  const gen = createTestDataGenerator(seed);
  const generated = {};
  const result = text.replace(/\$\{GEN\.([^}]+)\}/g, (_match, type) => {
    const value = gen.generate(type.trim());
    generated[`GEN.${type.trim()}`] = value;
    return value;
  });
  return { result, seed: gen.seed, generated };
}

// bin/version.mjs
var HJ_VERSION = "1.5.6";

// bin/semver.mjs
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
function differsBeyondPatch(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb)
    return false;
  return pa.major !== pb.major || pa.minor !== pb.minor;
}

// bin/cli-subcommand.mjs
var __dirname2 = dirname(fileURLToPath(import.meta.url));
var hintsPath = join(__dirname2, "hints.json");
var COMMAND_HINTS = existsSync(hintsPath) ? JSON.parse(readFileSync(hintsPath, "utf-8")) : {};
var warnedAboutSkew = false;
function warnOnVersionSkew(resp) {
  if (warnedAboutSkew)
    return;
  if (process.env.HALTIJA_NO_SKEW_WARN === "1")
    return;
  const serverVersion = resp.headers?.get?.("X-Haltija-Version");
  if (!serverVersion)
    return;
  if (!differsBeyondPatch(serverVersion, HJ_VERSION))
    return;
  warnedAboutSkew = true;
  console.error(`hj: warning — hj ${HJ_VERSION} is driving haltija server ${serverVersion}.`);
  console.error(`hj: that gap is wide enough to route or format wrongly. This hj is ${process.argv[1]}`);
  console.error(`hj: silence with HALTIJA_NO_SKEW_WARN=1`);
}
var GET_ENDPOINTS = new Set([
  "location",
  "events",
  "console",
  "windows",
  "recordings",
  "status",
  "version",
  "docs",
  "api",
  "stats",
  "network"
]);
var COMPOUND_PATHS = {
  styles: "/inspect",
  "mutations-watch": "/mutations/watch",
  "mutations-unwatch": "/mutations/unwatch",
  "mutations-status": "/mutations/status",
  "events-watch": "/events/watch",
  "events-unwatch": "/events/unwatch",
  "events-stats": "/events/stats",
  "select-start": "/select/start",
  "select-cancel": "/select/cancel",
  "select-status": "/select/status",
  "select-result": "/select/result",
  "select-clear": "/select/clear",
  "tabs-open": "/tabs/open",
  "tabs-close": "/tabs/close",
  "tabs-focus": "/tabs/focus",
  "video-start": "/video/start",
  "video-stop": "/video/stop",
  "video-status": "/video/status",
  "recording-start": "/recording/start",
  "recording-stop": "/recording/stop",
  "recording-generate": "/recording/generate",
  "test-run": "/test/run",
  "test-suite": "/test/suite",
  "test-validate": "/test/validate",
  "send-message": "/send/message",
  "send-selection": "/send/selection",
  "send-recording": "/send/recording",
  "network-watch": "/network/watch",
  "network-unwatch": "/network/unwatch",
  "network-stats": "/network/stats"
};
var GET_COMPOUND = new Set([
  "mutations-status",
  "events-stats",
  "select-status",
  "select-result",
  "video-status",
  "network-stats"
]);
var ARG_MAPS = {
  click: (args) => parseClickArgs(args),
  type: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), text: args.slice(1).join(" ") }),
  key: (args) => ({ key: args[0], ...parseModifiers(args.slice(1)) }),
  drag: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), deltaX: num(args[1]), deltaY: num(args[2]) }),
  scroll: (args) => parseScrollArgs(args),
  navigate: (args) => ({ url: args[0] }),
  eval: (args) => ({ code: args.join(" ") }),
  query: (args) => ({ selector: args[0] }),
  inspect: (args) => parseInspectArgs(args),
  inspectAll: (args) => parseInspectArgs(args),
  styles: (args) => ({ ...parseTargetArgs(args), matchedRules: true }),
  tree: (args) => parseTreeArgs(args),
  highlight: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), label: args[1] }),
  unhighlight: () => ({}),
  find: (args) => ({ text: args.join(" ") }),
  form: (args) => parseFormArgs(args),
  wait: (args) => parseWaitArgs(args),
  call: (args) => ({ ...parseTargetArgs(args.slice(0, 1)), method: args[1], args: args.slice(2).map(tryParseJSON) }),
  fetch: (args) => ({ url: args[0], prompt: args.slice(1).join(" ") || undefined }),
  screenshot: (args) => {
    const body = { file: true };
    const positional = [];
    for (let i = 0;i < args.length; i++) {
      const a = args[i];
      if (a === "--data-url") {
        body.file = false;
        continue;
      }
      if (a === "--format") {
        body.format = args[++i];
        continue;
      }
      if (a === "--quality") {
        const q = num(args[++i]);
        if (q != null && !Number.isNaN(q))
          body.quality = q > 1 ? q / 100 : q;
        continue;
      }
      if (a === "--scale") {
        body.scale = num(args[++i]);
        continue;
      }
      if (a === "--maxWidth" || a === "--max-width") {
        body.maxWidth = num(args[++i]);
        continue;
      }
      if (a === "--maxHeight" || a === "--max-height") {
        body.maxHeight = num(args[++i]);
        continue;
      }
      if (a === "--delay") {
        body.delay = num(args[++i]);
        continue;
      }
      if (a === "--no-chyron") {
        body.chyron = false;
        continue;
      }
      if (!a.startsWith("-")) {
        positional.push(a);
      }
    }
    return { ...body, ...parseTargetArgs(positional) };
  },
  snapshot: (args) => ({ context: args.join(" ") || undefined }),
  select: (args) => ({ action: args[0] }),
  "select-start": () => ({}),
  "select-cancel": () => ({}),
  "select-clear": () => ({}),
  refresh: (args) => args.includes("--soft") ? { soft: true } : {},
  "tabs-open": (args) => ({ url: args[0] }),
  "tabs-close": (args) => ({ window: args[0] }),
  "tabs-focus": (args) => ({ window: args[0] }),
  "video-start": (args) => {
    const body = {};
    for (let i = 0;i < args.length; i++) {
      if (args[i] === "--maxDuration" || args[i] === "--max-duration")
        body.maxDuration = num(args[++i]);
    }
    return body;
  },
  "video-stop": () => ({}),
  "events-watch": (args) => ({ preset: args[0] || "interactive" }),
  "mutations-watch": (args) => ({ preset: args[0] || "smart" }),
  "network-watch": (args) => ({ preset: args[0] || "standard" }),
  "test-run": (args) => {
    if (!args.length) {
      console.error("Usage: hj test-run <file.json> [--vars JSON] [--seed N] [--timeoutMs N] [--allow-failures N]");
      process.exit(1);
    }
    const { files, options, vars } = parseTestArgs(args);
    if (!files.length) {
      console.error("Usage: hj test-run <file.json>");
      process.exit(1);
    }
    const { seed, ...restOptions } = options;
    return { ...readTestFile(files[0], vars, seed), ...restOptions };
  },
  "test-validate": (args) => {
    if (!args.length) {
      console.error("Usage: hj test-validate <file.json> [--vars JSON]");
      process.exit(1);
    }
    const { files, vars, options } = parseTestArgs(args);
    if (!files.length) {
      console.error("Usage: hj test-validate <file.json>");
      process.exit(1);
    }
    return readTestFile(files[0], vars, options.seed);
  },
  "test-suite": (args) => {
    if (!args.length) {
      console.error("Usage: hj test-suite <dir|file...> [--vars JSON] [--seed N] [--timeoutMs N] [--allow-failures N]");
      process.exit(1);
    }
    const { files: rawFiles, options, vars } = parseTestArgs(args);
    const files = expandTestFiles(rawFiles);
    if (!files.length) {
      console.error("Error: No test files found");
      process.exit(1);
    }
    const { seed, ...restOptions } = options;
    const tests = files.map((f) => readTestFile(f, vars, seed).test);
    return { tests, ...restOptions };
  },
  "send-message": (args) => {
    const noSubmit = args.includes("--no-submit");
    const filtered = args.filter((a) => a !== "--no-submit");
    return { agent: filtered[0], message: filtered.slice(1).join(" "), submit: !noSubmit };
  },
  "send-selection": (args) => {
    const noSubmit = args.includes("--no-submit");
    const filtered = args.filter((a) => a !== "--no-submit");
    return { agent: filtered[0], submit: !noSubmit };
  },
  "send-recording": (args) => {
    const noSubmit = args.includes("--no-submit");
    const filtered = args.filter((a) => a !== "--no-submit");
    return { agent: filtered[0], description: filtered.slice(1).join(" ") || undefined, submit: !noSubmit };
  },
  recording: (args) => {
    const action = args[0] || "status";
    if (action === "replay") {
      return { action, id: args[1] };
    }
    if (action === "generate" || action === "start") {
      return { action, name: args.slice(1).join(" ") || undefined };
    }
    return { action };
  }
};
function parseTargetArgs(args) {
  if (!args.length || !args[0])
    return {};
  const target = args[0];
  if (/^@?\d+$/.test(target))
    return { ref: target.replace("@", "") };
  return { selector: target };
}
function parseTreeArgs(args) {
  const body = {};
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    if (a === "--depth" || a === "-d") {
      body.depth = num(args[++i]);
      continue;
    }
    if (a === "--selector" || a === "-s") {
      body.selector = args[++i];
      continue;
    }
    if (a === "--compact" || a === "-c") {
      body.compact = true;
      continue;
    }
    if (a === "--interactive" || a === "-i") {
      body.interactiveOnly = true;
      continue;
    }
    if (a === "--visible" || a === "-v") {
      body.visibleOnly = true;
      continue;
    }
    if (a === "--text") {
      body.includeText = true;
      continue;
    }
    if (a === "--no-text") {
      body.includeText = false;
      continue;
    }
    if (a === "--shadow") {
      body.pierceShadow = true;
      continue;
    }
    if (a === "--frames") {
      body.pierceFrames = true;
      continue;
    }
    if (a === "--no-frames") {
      body.pierceFrames = false;
      continue;
    }
    if (!a.startsWith("-")) {
      body.selector = a;
      continue;
    }
  }
  return Object.keys(body).length ? body : undefined;
}
function parseScrollArgs(args) {
  if (!args.length)
    return {};
  const first = args[0];
  if (first.startsWith(".") || first.startsWith("#") || first.startsWith("[")) {
    return { selector: first };
  }
  if (args.length >= 2 && !isNaN(args[0]) && !isNaN(args[1])) {
    return { deltaX: num(args[0]), deltaY: num(args[1]) };
  }
  if (!isNaN(first))
    return { deltaY: num(first) };
  return parseTargetArgs(args);
}
function parseWaitArgs(args) {
  if (!args.length)
    return { ms: 1000 };
  const first = args[0];
  if (!isNaN(first))
    return { ms: num(first) };
  return { ...parseTargetArgs([first]), timeout: args[1] ? num(args[1]) : undefined };
}
function parseClickArgs(args) {
  const body = {};
  const positional = [];
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    if (a === "--diff") {
      body.diff = true;
      continue;
    }
    if (a === "--delay" && args[i + 1]) {
      body.diffDelay = num(args[++i]);
      continue;
    }
    if (!a.startsWith("-")) {
      positional.push(a);
      continue;
    }
  }
  if (positional.length) {
    const target = positional[0];
    if (/^@?\d+$/.test(target)) {
      body.ref = target.replace("@", "");
    } else {
      body.selector = target;
    }
  }
  return Object.keys(body).length ? body : {};
}
function parseFormArgs(args) {
  const body = {};
  const positional = [];
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    if (a === "--include-disabled") {
      body.includeDisabled = true;
      continue;
    }
    if (a === "--include-hidden") {
      body.includeHidden = true;
      continue;
    }
    if (!a.startsWith("-")) {
      positional.push(a);
      continue;
    }
  }
  if (positional.length)
    body.selector = positional[0];
  return Object.keys(body).length ? body : undefined;
}
function parseInspectArgs(args) {
  const body = {};
  const positional = [];
  for (let i = 0;i < args.length; i++) {
    const a = args[i];
    if (a === "--full-styles" || a === "--styles") {
      body.fullStyles = true;
      continue;
    }
    if (a === "--matched-rules" || a === "--rules") {
      body.matchedRules = true;
      continue;
    }
    if (a === "--ancestors") {
      body.ancestors = true;
      continue;
    }
    if (!a.startsWith("-")) {
      positional.push(a);
      continue;
    }
  }
  if (positional.length) {
    const target = positional[0];
    if (/^@?\d+$/.test(target)) {
      body.ref = target.replace("@", "");
    } else {
      body.selector = target;
    }
  }
  return Object.keys(body).length ? body : undefined;
}
function parseModifiers(args) {
  const mods = {};
  for (const a of args) {
    if (a === "--ctrl" || a === "-c")
      mods.ctrl = true;
    if (a === "--shift" || a === "-s")
      mods.shift = true;
    if (a === "--alt" || a === "-a")
      mods.alt = true;
    if (a === "--meta" || a === "-m")
      mods.meta = true;
  }
  return Object.keys(mods).length ? mods : {};
}
function substituteVars(text, vars = {}, seed) {
  let genInfo = null;
  if (/\$\{GEN\./i.test(text)) {
    genInfo = substituteGeneratedVars(text, seed);
    text = genInfo.result;
  }
  const result = text.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const trimmed = varName.trim();
    if (trimmed in vars)
      return vars[trimmed];
    if (trimmed in process.env)
      return process.env[trimmed];
    return match;
  });
  return { text: result, genInfo };
}
function readTestFile(filePath, vars = {}, seed) {
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    const { text: processed, genInfo } = substituteVars(content, vars, seed);
    if (genInfo && Object.keys(genInfo.generated).length > 0) {
      const dim2 = (s) => `\x1B[2m${s}\x1B[0m`;
      console.error(dim2(`[test-data] seed: ${genInfo.seed}`));
      for (const [key, value] of Object.entries(genInfo.generated)) {
        const display = value.length > 60 ? value.slice(0, 57) + "..." : value;
        console.error(dim2(`  ${key} = ${JSON.stringify(display)}`));
      }
    }
    const parsed = JSON.parse(processed);
    return { test: parsed };
  } catch (err) {
    console.error(`Error: Failed to parse ${filePath}: ${err.message}`);
    process.exit(1);
  }
}
function parseTestArgs(args) {
  const files = [];
  const options = {};
  let vars = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--timeoutMs" && args[i + 1]) {
      options.timeout = parseInt(args[i + 1], 10);
      i += 2;
    } else if (arg === "--allow-failures" && args[i + 1]) {
      options.patience = parseInt(args[i + 1], 10);
      i += 2;
    } else if (arg === "--allow-failures-streak" && args[i + 1]) {
      options.patienceStreak = parseInt(args[i + 1], 10);
      i += 2;
    } else if (arg === "--step-delay" && args[i + 1]) {
      options.stepDelay = parseInt(args[i + 1], 10);
      i += 2;
    } else if (arg === "--seed" && args[i + 1]) {
      options.seed = parseInt(args[i + 1], 10);
      i += 2;
    } else if (arg === "--vars" && args[i + 1]) {
      try {
        vars = { ...vars, ...JSON.parse(args[i + 1]) };
      } catch (err) {
        console.error(`Error: Invalid JSON for --vars: ${args[i + 1]}`);
        process.exit(1);
      }
      i += 2;
    } else if (arg.startsWith("--")) {
      i++;
    } else {
      files.push(arg);
      i++;
    }
  }
  return { files, options, vars };
}
function expandTestFiles(args) {
  const files = [];
  for (const arg of args) {
    if (!existsSync(arg)) {
      console.error(`Error: Not found: ${arg}`);
      process.exit(1);
    }
    const stat = statSync(arg);
    if (stat.isDirectory()) {
      const jsonFiles = readdirSync(arg).filter((f) => f.endsWith(".json")).sort().map((f) => join(arg, f));
      files.push(...jsonFiles);
    } else {
      files.push(arg);
    }
  }
  return files;
}
function num(s) {
  return s != null ? Number(s) : undefined;
}
function tryParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
function clean(obj) {
  if (!obj)
    return;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined)
      result[k] = v;
  }
  return Object.keys(result).length ? result : undefined;
}
async function isServerRunning(port) {
  try {
    const resp = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(1000)
    });
    return resp.ok;
  } catch {
    return false;
  }
}
function resolveServerPath() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const execDir = dirname(process.execPath);
  const candidates = [
    { type: "bundled", path: join(execDir, `haltija-server-${arch}`) },
    { type: "dev", path: join(__dirname2, "../dist/server.js") },
    { type: "app", path: `/Applications/Haltija.app/Contents/Resources/haltija-server-${arch}` },
    { type: "app", path: join(homedir(), `Applications/Haltija.app/Contents/Resources/haltija-server-${arch}`) }
  ];
  for (const c of candidates) {
    if (existsSync(c.path))
      return c;
  }
  return null;
}
async function startServerInBackground(port) {
  const resolved = resolveServerPath();
  if (!resolved) {
    console.error("Error: no haltija server found.");
    console.error("");
    console.error("Install one of these:");
    console.error("  • Haltija desktop app: https://github.com/tonioloewald/haltija/releases");
    console.error("  • Or run a server in another shell: bunx haltija --server");
    console.error("  • Or, if you are developing haltija from source: bun run build");
    process.exit(1);
  }
  let command, cmdArgs;
  if (resolved.type === "bundled") {
    command = resolved.path;
    cmdArgs = [];
  } else {
    command = "bun";
    cmdArgs = ["run", resolved.path];
    try {
      const { execSync } = await import("child_process");
      execSync("bun --version", { stdio: "ignore" });
    } catch {
      command = "node";
      cmdArgs = [resolved.path];
    }
  }
  const child = spawn(command, cmdArgs, {
    env: { ...process.env, DEV_CHANNEL_PORT: String(port) },
    stdio: "ignore",
    detached: true
  });
  child.unref();
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await isServerRunning(port))
      return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
async function launchElectronApp() {
  const { execSync, spawn: spawnChild } = await import("child_process");
  if (process.platform === "darwin") {
    const appPaths = [
      "/Applications/Haltija.app",
      `${process.env.HOME}/Applications/Haltija.app`
    ];
    for (const p of appPaths) {
      if (existsSync(p)) {
        spawnChild("open", ["-a", p], { stdio: "ignore", detached: true }).unref();
        return true;
      }
    }
    try {
      const result = execSync('mdfind "kMDItemCFBundleIdentifier == com.electron.haltija" | head -1', { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
      if (result) {
        spawnChild("open", ["-a", result], { stdio: "ignore", detached: true }).unref();
        return true;
      }
    } catch {}
    return false;
  }
  return false;
}
async function ensureBrowserConnected(port, { explicitTarget = false } = {}) {
  let status;
  try {
    const resp = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(2000)
    });
    status = await resp.json();
    if (status.ok)
      return true;
  } catch {
    return false;
  }
  if (status?.desktopApp)
    return true;
  if (explicitTarget) {
    process.stderr.write(`\x1B[2mNo browser connected to the haltija server on port ${port}. Open your app/page with the widget injected (script tag or bookmarklet), or run \`hj --no-launch\` to skip this check.\x1B[0m
`);
    return false;
  }
  try {
    const quitMarker = join(homedir(), ".haltija", "last-quit");
    if (existsSync(quitMarker)) {
      process.stderr.write(`\x1B[2m(Haltija was quit by user; not auto-launching. Open Haltija manually to resume.)\x1B[0m
`);
      return false;
    }
  } catch {}
  if (process.platform !== "darwin")
    return false;
  process.stderr.write("\x1B[2mLaunching Haltija browser...\x1B[0m");
  const launched = await launchElectronApp();
  if (!launched) {
    process.stderr.write(`\x1B[2m not found\x1B[0m
`);
    return false;
  }
  const maxWait = 1e4;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const resp = await fetch(`http://localhost:${port}/status`, {
        signal: AbortSignal.timeout(1000)
      });
      const status2 = await resp.json();
      if (status2.ok) {
        process.stderr.write(`\x1B[2m ready\x1B[0m
`);
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stderr.write(`\x1B[2m timeout\x1B[0m
`);
  return false;
}
var INFO_COMMANDS = new Set(["status", "windows", "version", "help"]);
var UNWRAP_DATA_SUBCOMMANDS = new Set([
  "eval",
  "call",
  "fetch",
  "location",
  "query",
  "inspect",
  "inspectAll",
  "find",
  "console",
  "form"
]);
var GLOBAL_FLAGS = ["--json", "--window", "--port", "--name", "--token", "--no-launch", "--help"];
var KNOWN_FLAGS = {
  tree: ["--depth", "-d", "--selector", "-s", "--compact", "-c", "--interactive", "-i", "--visible", "-v", "--text", "--no-text", "--shadow", "--frames", "--no-frames"],
  click: ["--diff", "--delay"],
  form: ["--include-disabled", "--include-hidden"],
  inspect: ["--full-styles", "--styles", "--matched-rules", "--rules", "--ancestors"],
  inspectAll: ["--full-styles", "--styles", "--matched-rules", "--rules", "--ancestors"],
  key: ["--ctrl", "-c", "--shift", "-s", "--alt", "-a", "--meta", "-m"],
  screenshot: ["--data-url", "--format", "--quality", "--scale", "--maxWidth", "--max-width", "--maxHeight", "--max-height", "--delay", "--no-chyron"],
  "video-start": ["--maxDuration", "--max-duration"],
  refresh: ["--soft"],
  "test-run": ["--vars", "--seed", "--timeoutMs", "--allow-failures", "--allow-failures-streak", "--step-delay"],
  "test-validate": ["--vars", "--seed", "--timeoutMs", "--allow-failures", "--allow-failures-streak", "--step-delay"],
  "test-suite": ["--vars", "--seed", "--timeoutMs", "--allow-failures", "--allow-failures-streak", "--step-delay"]
};
function normalizeEqualsFlags(args) {
  const out = [];
  for (const a of args) {
    if (a.startsWith("--") && a.includes("=")) {
      const eq = a.indexOf("=");
      out.push(a.slice(0, eq), a.slice(eq + 1));
    } else {
      out.push(a);
    }
  }
  return out;
}
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0;j <= n; j++)
    d[0][j] = j;
  for (let i = 1;i <= m; i++) {
    for (let j = 1;j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}
function closestFlag(input, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const dist = editDistance(input, c);
    if (dist < bestD) {
      bestD = dist;
      best = c;
    }
  }
  return bestD <= 3 ? best : null;
}
function warnUnknownFlags(subcommand, args) {
  const known = KNOWN_FLAGS[subcommand];
  if (!known)
    return;
  const allowed = new Set([...known, ...GLOBAL_FLAGS]);
  const dim2 = (s) => `\x1B[2m${s}\x1B[0m`;
  for (const a of args) {
    if (!a.startsWith("-"))
      continue;
    if (/^-\d/.test(a))
      continue;
    if (allowed.has(a))
      continue;
    const suggestion = closestFlag(a, known);
    const hint = suggestion ? ` (did you mean ${suggestion}?)` : "";
    process.stderr.write(dim2(`[hj] warning: unknown flag "${a}" ignored${hint}`) + `
`);
  }
}
async function runSubcommand(subcommand, subArgs, port = "8700", options = {}) {
  const baseUrl = `http://localhost:${port}`;
  const jsonOutput = subArgs.includes("--json");
  const noLaunch = options.noLaunch || false;
  const explicitTarget = options.explicitTarget || false;
  let filteredArgs = subArgs.filter((a) => a !== "--json");
  let targetWindowId = undefined;
  const windowIdx = filteredArgs.indexOf("--window");
  if (windowIdx !== -1) {
    targetWindowId = filteredArgs[windowIdx + 1];
    filteredArgs = [...filteredArgs.slice(0, windowIdx), ...filteredArgs.slice(windowIdx + 2)];
  }
  if (KNOWN_FLAGS[subcommand]) {
    filteredArgs = normalizeEqualsFlags(filteredArgs);
    warnUnknownFlags(subcommand, filteredArgs);
  }
  if (!await isServerRunning(port)) {
    if (noLaunch || explicitTarget) {
      console.error(`Error: nothing is answering on the haltija server you targeted (port ${port}).`);
      console.error(explicitTarget ? "That port is yours to manage — haltija will not spawn a server against a target you named." : "Start it yourself: `haltija --server`  (or drop --no-launch to let hj start one on the default port).");
      console.error("`hj where` shows what a shell is targeting and why.");
      process.exit(1);
    }
    try {
      const quitMarker = join(homedir(), ".haltija", "last-quit");
      if (existsSync(quitMarker)) {
        console.error("Haltija was quit by user; not auto-launching.");
        console.error("Open Haltija manually to resume — or run `hj --no-launch` to bypass this check.");
        process.exit(1);
      }
    } catch {}
    process.stderr.write("\x1B[2mStarting Haltija server...\x1B[0m");
    const started = await startServerInBackground(port);
    if (started) {
      process.stderr.write(`\x1B[2m done\x1B[0m
`);
    } else {
      process.stderr.write(`
`);
      console.error("Error: Could not start server. Run `haltija --server` in another terminal.");
      process.exit(1);
    }
  }
  if (!noLaunch && !INFO_COMMANDS.has(subcommand)) {
    await ensureBrowserConnected(port, { explicitTarget });
  }
  if (subcommand === "send") {
    const firstArg = filteredArgs[0]?.toLocaleLowerCase();
    if (firstArg === "selection") {
      subcommand = "send-selection";
      filteredArgs.shift();
    } else if (firstArg === "recording") {
      subcommand = "send-recording";
      filteredArgs.shift();
    } else {
      subcommand = "send-message";
    }
  }
  const path = COMPOUND_PATHS[subcommand] || `/${subcommand}`;
  const isGet = GET_ENDPOINTS.has(subcommand) || GET_COMPOUND.has(subcommand);
  let body = undefined;
  if (!isGet) {
    const mapper = ARG_MAPS[subcommand];
    if (mapper) {
      body = clean(mapper(filteredArgs));
    } else if (filteredArgs.length) {
      const joined = filteredArgs.join(" ");
      try {
        body = JSON.parse(joined);
      } catch {
        body = parseTargetArgs(filteredArgs);
      }
    }
  }
  if (targetWindowId) {
    if (isGet) {
      const url2 = new URL(path, baseUrl);
      url2.searchParams.set("window", targetWindowId);
      return doRequest(url2.toString(), "GET", undefined, { subcommand, jsonOutput });
    } else {
      if (!body)
        body = {};
      body.window = targetWindowId;
    }
  }
  const url = `${baseUrl}${path}`;
  return doRequest(url, isGet ? "GET" : "POST", body, { subcommand, jsonOutput });
}
async function doRequest(url, method, body, context = {}) {
  const { subcommand, jsonOutput } = context;
  try {
    const headers = {};
    if (process.env.HALTIJA_TOKEN)
      headers["X-Haltija-Token"] = process.env.HALTIJA_TOKEN;
    const opts = { method, headers };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    warnOnVersionSkew(resp);
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await resp.json();
      if (json && typeof json.warning === "string" && json.warning) {
        console.error(`hj: warning — ${json.warning}`);
      }
      if (!jsonOutput && subcommand === "tree" && json.success && json.data) {
        console.log(formatTree(json.data, 0, { depth: body?.depth }));
      } else if (!jsonOutput && subcommand === "events" && (json.events || Array.isArray(json))) {
        console.log(formatEvents(json));
      } else if (!jsonOutput && subcommand === "test-run" && json.test) {
        console.log(formatTestResult(json));
      } else if (!jsonOutput && subcommand === "test-suite" && json.results) {
        console.log(formatSuiteResult(json));
      } else if (!jsonOutput && subcommand === "screenshot" && json.data?.path) {
        const bold = (s) => `\x1B[1m${s}\x1B[0m`;
        const dim2 = (s) => `\x1B[2m${s}\x1B[0m`;
        console.log(bold(json.data.path));
        const meta = [json.data.width && json.data.height ? `${json.data.width}×${json.data.height}` : null, json.data.format, json.data.source].filter(Boolean).join(", ");
        if (meta)
          console.log(dim2(meta));
      } else if (!jsonOutput && (subcommand === "network" || subcommand === "network-watch") && (json.entries || json.data?.entries || json.summary || json.data?.summary)) {
        console.log(formatNetwork(json));
      } else if (!jsonOutput && subcommand === "network-stats") {
        console.log(formatNetworkStats(json));
      } else if (!jsonOutput && subcommand === "video-stop" && json.data?.path) {
        const bold = (s) => `\x1B[1m${s}\x1B[0m`;
        const dim2 = (s) => `\x1B[2m${s}\x1B[0m`;
        console.log(bold(json.data.path));
        const meta = [json.data.duration ? `${json.data.duration.toFixed(1)}s` : null, json.data.size ? `${(json.data.size / 1024).toFixed(0)}KB` : null, json.data.format].filter(Boolean).join(", ");
        if (meta)
          console.log(dim2(meta));
      } else if (!jsonOutput && UNWRAP_DATA_SUBCOMMANDS.has(subcommand)) {
        if (json.success === false) {
          console.error(`${subcommand} failed: ${json.error || "unknown error"}`);
          process.exit(1);
        }
        const result = json.data;
        if (result === null || result === undefined) {} else if (typeof result === "string") {
          process.stdout.write(result);
          if (!result.endsWith(`
`))
            process.stdout.write(`
`);
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        console.log(JSON.stringify(json, null, 2));
        if (json && json.success === false)
          process.exit(1);
      }
    } else {
      const text = await resp.text();
      console.log(text);
    }
    if (resp.ok && !jsonOutput && !UNWRAP_DATA_SUBCOMMANDS.has(subcommand)) {
      const hint = COMMAND_HINTS[subcommand];
      if (hint) {
        const dim2 = (s) => `\x1B[2m${s}\x1B[0m`;
        console.log(dim2(`
hj ${subcommand} : ${hint}`));
      }
    }
    if (!resp.ok) {
      process.exit(1);
    }
  } catch (err) {
    if (err.cause?.code === "ECONNREFUSED") {
      console.error("Error: Cannot connect to Haltija server.");
      console.error("Start the server with: haltija --server");
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}
var KNOWN_COMMANDS = new Set([
  "tree",
  "query",
  "inspect",
  "inspectAll",
  "styles",
  "find",
  "form",
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
]);
var COMMAND_ALIASES = {
  open: "navigate",
  goto: "navigate",
  go: "navigate",
  url: "navigate",
  load: "navigate",
  get: "tree",
  dom: "tree",
  page: "tree",
  input: "type",
  write: "type",
  enter: "key",
  press: "key",
  run: "eval",
  js: "eval",
  exec: "eval",
  evaluate: "eval",
  execute: "eval",
  shot: "screenshot",
  capture: "screenshot",
  ls: "tree",
  list: "tree",
  show: "tree",
  help: "--help",
  nav: "navigate",
  reload: "refresh",
  snap: "snapshot",
  log: "console",
  logs: "console"
};
function isSubcommand(arg) {
  if (!arg || arg.startsWith("-"))
    return false;
  if (/^\d+$/.test(arg))
    return false;
  return KNOWN_COMMANDS.has(arg);
}
function getSuggestion(cmd) {
  if (COMMAND_ALIASES[cmd]) {
    return COMMAND_ALIASES[cmd];
  }
  const lower = cmd.toLowerCase();
  for (const [alias, target] of Object.entries(COMMAND_ALIASES)) {
    if (alias.toLowerCase() === lower)
      return target;
  }
  const prefixMatches = [...KNOWN_COMMANDS].filter((k) => k.startsWith(lower));
  if (prefixMatches.length === 1)
    return prefixMatches[0];
  let bestMatch = null;
  let bestDist = 3;
  for (const known of KNOWN_COMMANDS) {
    const d = levenshtein(lower, known);
    if (d < bestDist) {
      bestDist = d;
      bestMatch = known;
    }
  }
  if (bestMatch)
    return bestMatch;
  if (lower.length >= 3) {
    for (const known of KNOWN_COMMANDS) {
      if (known.startsWith(lower.slice(0, 3)))
        return known;
    }
  }
  return null;
}
function levenshtein(a, b) {
  if (a.length === 0)
    return b.length;
  if (b.length === 0)
    return a.length;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1;i <= a.length; i++) {
    for (let j = 1;j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}
function listSubcommands() {
  return `
  ${bold("See the page")}
    tree [selector] [-d N] [-i] [-v]  DOM tree (-i=interactive, -v=visible)
    screenshot [@ref|selector]        Screenshot (saves to /tmp)
    inspect <@ref|selector>           Detailed element info
    console                           Console output

  ${bold("Interact")}
    click <@ref|selector|"text">      Click element
    type <@ref|selector> <text>       Type text
    key <key> [--ctrl --shift]        Press key
    drag <@ref|selector> <dx> <dy>    Drag element
    scroll [selector|dy]              Scroll page or element

  ${bold("Watch")}
    events ${dim2("watch|unwatch|stats")}       Semantic events (default: show recent)
    mutations ${dim2("watch|unwatch|status")}   DOM changes
    network ${dim2("watch|unwatch|stats")}      HTTP requests (CDP, desktop only)
    console                           Console output

  ${bold("Control")}
    navigate <url>                    Go to URL
    refresh [--soft]                  Reload page
    tabs ${dim2("open|close|focus")}            Tab management (default: list)
    eval <code>                       Run JS in browser

  ${bold("Test")}
    test ${dim2("run|suite|validate")} <file>   Run tests (default: run)
    recording ${dim2("start|stop|generate")}    Record user actions
    select ${dim2("start|cancel|status|result|clear")}

  ${bold("More")}
    find <text>                       Find elements by text
    highlight <@ref> [label]          Highlight element
    snapshot [context]                Full page state
    video ${dim2("start|stop|status")}          Video capture
    fetch <url> [prompt]              Fetch and process URL
    send <agent> <message>            Message an agent

  ${bold("Info")}
    status | version | docs | api

  ${bold("Options")}
    --window <id>    Target specific window
    --port <n>       Server port (default: 8700)

  Space-separated sub-commands work: ${dim2("hj test run = hj test-run")}
  Fuzzy matching: ${dim2("hj evaluate = hj eval, hj screensho = hj screenshot")}
`;
}
function bold(s) {
  return `\x1B[1m${s}\x1B[0m`;
}
function dim2(s) {
  return `\x1B[2m${s}\x1B[0m`;
}

// bin/arg-utils.mjs
function extractWindowTarget(args) {
  const i = args.indexOf("--window");
  if (i === -1 || args[i + 1] === undefined) {
    return { windowTarget: null, args: [...args] };
  }
  const rest = [...args];
  rest.splice(i, 2);
  return { windowTarget: args[i + 1], args: rest };
}

// bin/hj.mjs
import { existsSync as existsSync2, readFileSync as readFileSync2, readdirSync as readdirSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var args = process.argv.slice(2);
var REGISTRY_DIR = process.env.HALTIJA_REGISTRY_DIR || join2(homedir2(), ".haltija", "servers");
if (args[0] === "--version" || args[0] === "-v") {
  console.log(HJ_VERSION);
  process.exit(0);
}
async function runWhere(port, portSource, jsonOutput) {
  let serverInfo = null;
  let serverError = null;
  try {
    const resp = await fetch(`http://localhost:${port}/status`, {
      signal: AbortSignal.timeout(2000)
    });
    if (resp.ok) {
      serverInfo = await resp.json();
    } else {
      serverError = `HTTP ${resp.status}`;
    }
  } catch (err) {
    serverError = err.code === "ConnectionRefused" || err.cause?.code === "ECONNREFUSED" ? "no server is listening on this port" : err.message;
  }
  let instanceName = null;
  try {
    const dir = REGISTRY_DIR;
    if (existsSync2(dir)) {
      for (const file of readdirSync2(dir)) {
        if (!file.endsWith(".json"))
          continue;
        try {
          const entry = JSON.parse(readFileSync2(join2(dir, file), "utf-8"));
          if (entry.port === Number(port)) {
            try {
              process.kill(entry.pid, 0);
              instanceName = entry.name;
            } catch {}
          }
        } catch {}
      }
    }
  } catch {}
  const focused = serverInfo?.windows?.find((w) => w.focused) || serverInfo?.windows?.[0];
  const tabs = serverInfo?.windows?.length ?? 0;
  if (jsonOutput) {
    console.log(JSON.stringify({
      port: Number(port),
      portSource,
      reachable: !!serverInfo,
      error: serverError,
      client: HJ_VERSION,
      versionSkew: serverInfo ? differsBeyondPatch(serverInfo.serverVersion || "", HJ_VERSION) : null,
      server: serverInfo ? {
        version: serverInfo.serverVersion,
        instanceName,
        desktopApp: !!serverInfo.desktopApp,
        tabs,
        agents: serverInfo.agents,
        focused: focused ? { id: focused.id, url: focused.url, title: focused.title } : null
      } : null
    }, null, 2));
    return;
  }
  const bold2 = (s) => `\x1B[1m${s}\x1B[0m`;
  const dim3 = (s) => `\x1B[2m${s}\x1B[0m`;
  console.log(`${bold2("port:")}   ${port} ${dim3(`(${portSource})`)}`);
  if (!serverInfo) {
    console.log(`${bold2("server:")} ${dim3(`unreachable — ${serverError}`)}`);
    return;
  }
  const desc = [
    `haltija ${serverInfo.serverVersion}`,
    instanceName ? `name=${instanceName}` : null,
    serverInfo.desktopApp ? "desktop app" : null,
    `${tabs} tab${tabs === 1 ? "" : "s"}`,
    serverInfo.agents > 0 ? `${serverInfo.agents} agent${serverInfo.agents === 1 ? "" : "s"}` : null
  ].filter(Boolean).join(", ");
  console.log(`${bold2("server:")} ${desc}`);
  console.log(`${bold2("client:")} hj ${HJ_VERSION}`);
  if (focused) {
    console.log(`${bold2("focused:")} ${focused.title || dim3("(no title)")} ${dim3(`— ${focused.url}`)}`);
  } else if (tabs === 0) {
    console.log(`${bold2("focused:")} ${dim3("no tabs connected")}`);
  }
  if (serverInfo.serverVersion && differsBeyondPatch(serverInfo.serverVersion, HJ_VERSION)) {
    console.log(`
${bold2("warning:")} hj ${HJ_VERSION} is driving server ${serverInfo.serverVersion}.`);
    console.log(dim3(`  That gap is wide enough to route or format wrongly.`));
    console.log(dim3(`  This hj is ${process.argv[1]}`));
  }
}
async function runServers(resolvedPort) {
  const bold2 = (s) => `\x1B[1m${s}\x1B[0m`;
  const dim3 = (s) => `\x1B[2m${s}\x1B[0m`;
  const green2 = (s) => `\x1B[32m${s}\x1B[0m`;
  const token = process.env.HALTIJA_TOKEN;
  const byPort = new Map;
  for (const e of listLiveInstances()) {
    byPort.set(String(e.port), { port: String(e.port), name: e.name, cwd: e.cwd });
  }
  for (const p of ["8700", "8701", String(resolvedPort)]) {
    if (!byPort.has(p))
      byPort.set(p, { port: p, name: null, cwd: null });
  }
  const rows = await Promise.all([...byPort.values()].map(async (c) => {
    try {
      const resp = await fetch(`http://localhost:${c.port}/status`, {
        headers: token ? { "X-Haltija-Token": token } : {},
        signal: AbortSignal.timeout(2000)
      });
      if (!resp.ok)
        return { ...c, up: false };
      const s = await resp.json();
      return {
        ...c,
        up: true,
        version: s.serverVersion || "?",
        desktopApp: !!s.desktopApp,
        tabs: Array.isArray(s.windows) ? s.windows.length : s.browsers ?? 0
      };
    } catch {
      return { ...c, up: false };
    }
  }));
  const up = rows.filter((r) => r.up).sort((a, b) => Number(a.port) - Number(b.port));
  if (!up.length) {
    console.log("No haltija servers are running.");
    console.log(dim3("Start one:  bunx haltija --server   (or the desktop app:  bunx haltija)"));
    return;
  }
  console.log(bold2("Live haltija servers") + dim3("  (▸ = what this shell targets)"));
  for (const r of up) {
    const here = String(r.port) === String(resolvedPort) ? green2("▸") : " ";
    const name = r.desktopApp ? "desktop" : r.name || "(unnamed)";
    const tabs = `${r.tabs} tab${r.tabs === 1 ? "" : "s"}`;
    const kind = r.desktopApp ? "desktop app" : r.cwd || "";
    console.log(`  ${here} ${String(r.port).padEnd(6)} ${name.padEnd(14)} v${String(r.version).padEnd(8)} ${tabs.padEnd(9)} ${dim3(kind)}`);
  }
  if (!up.some((r) => String(r.port) === String(resolvedPort))) {
    console.log(dim3(`
This shell targets :${resolvedPort}, but nothing is listening there.`));
  }
  console.log(dim3(`
Pick one:  `) + `hj --port <n> <cmd>` + dim3("  or  ") + `hj --name <name> <cmd>`);
}
function lookupNamedInstance(name) {
  const path = join2(REGISTRY_DIR, `${name}.json`);
  if (!existsSync2(path))
    return null;
  let entry;
  try {
    entry = JSON.parse(readFileSync2(path, "utf-8"));
  } catch {
    return null;
  }
  if (entry?.pid) {
    try {
      process.kill(entry.pid, 0);
    } catch {
      return null;
    }
  }
  return entry;
}
function listLiveInstances() {
  const dir = REGISTRY_DIR;
  if (!existsSync2(dir))
    return [];
  const out = [];
  for (const file of readdirSync2(dir)) {
    if (!file.endsWith(".json"))
      continue;
    const entry = lookupNamedInstance(file.slice(0, -".json".length));
    if (entry)
      out.push(entry);
  }
  return out;
}
function isAncestorOf(dir, p) {
  if (!dir || !p)
    return false;
  if (dir === p)
    return true;
  return p.startsWith(dir.endsWith("/") ? dir : dir + "/");
}
function resolveByCwd(cwd, instances) {
  const candidates = instances.filter((e) => e.cwd && e.cwd !== "/" && e.cwd !== homedir2() && isAncestorOf(e.cwd, cwd));
  if (!candidates.length)
    return null;
  candidates.sort((a, b) => b.cwd.length - a.cwd.length || (b.startedAt || 0) - (a.startedAt || 0));
  return candidates[0];
}
if (!args.length || args.includes("--help") || args.includes("-h")) {
  const bold2 = (s) => `\x1B[1m${s}\x1B[0m`;
  const dim3 = (s) => `\x1B[2m${s}\x1B[0m`;
  console.log(`
${bold2("hj")} - Haltija command-line interface

Usage: hj <command> [args...]

${dim3("Which server does hj talk to?")}
  ${dim3("By default, the one that owns the directory you are in: a haltija server")}
  ${dim3("records where it was started, and hj picks the one whose directory is the")}
  ${dim3("nearest ancestor of your cwd. So inside a project with its own server,")}
  ${dim3("plain `hj tree` just works. Otherwise it falls back to port 8700.")}
  ${dim3("Run `hj where` to see the port, WHY it was chosen, and what is alive there.")}

${dim3("Overriding that (per-shell):")}
  ${dim3("haltija --name api --server")}   # in another shell: register as "api"
  ${dim3("export HALTIJA_NAME=api")}       # all hj calls in this shell talk to "api"
  ${dim3("hj --name api tree")}            # one-off name override
  ${dim3("export HALTIJA_PORT=9123")}      # bypass the registry; talk to a port directly
  ${dim3("hj --port 9123 tree")}           # one-off port override
  ${dim3("export HALTIJA_TOKEN=secret")}   # required when server was started with HALTIJA_TOKEN
  ${dim3("hj --token secret tree")}        # one-off token override
  ${dim3("hj --version")}                  # which hj is this?

${dim3("Lifecycle:")}
  ${dim3("hj where")}                       # which server this shell targets + what is alive there
  ${dim3("hj servers")}                     # list ALL live servers (pick one with --port/--name)
  ${dim3("hj shutdown")}                    # stop the targeted server (a private --app: Electron + all)
${listSubcommands()}
Run ${dim3("hj --help")} for this help.
Run ${dim3("haltija --help")} for server/app options.
`);
  process.exit(0);
}
var resolvedName = process.env.HALTIJA_NAME || "";
var nameSource = resolvedName ? "HALTIJA_NAME env" : "";
var nameIdx = args.indexOf("--name");
if (nameIdx !== -1 && args[nameIdx + 1]) {
  resolvedName = args[nameIdx + 1];
  nameSource = "--name flag";
  args.splice(nameIdx, 2);
}
var portFlag = "";
var portIdx = args.indexOf("--port");
if (portIdx !== -1 && args[portIdx + 1]) {
  portFlag = args[portIdx + 1];
  args.splice(portIdx, 2);
}
var port;
var portSource;
if (portFlag) {
  port = portFlag;
  portSource = "--port flag";
} else if (resolvedName) {
  const entry = lookupNamedInstance(resolvedName);
  if (!entry) {
    console.error(`hj: no live haltija instance named "${resolvedName}".`);
    console.error(`Start one with:  haltija --name ${resolvedName} --server`);
    process.exit(1);
  }
  port = String(entry.port);
  portSource = `name "${resolvedName}" via ${nameSource}`;
} else if (process.env.HALTIJA_PORT) {
  port = process.env.HALTIJA_PORT;
  portSource = "HALTIJA_PORT env";
} else if (process.env.DEV_CHANNEL_PORT) {
  port = process.env.DEV_CHANNEL_PORT;
  portSource = "DEV_CHANNEL_PORT env (legacy)";
} else {
  const live = listLiveInstances();
  const cwdMatch = resolveByCwd(process.cwd(), live);
  if (cwdMatch) {
    port = String(cwdMatch.port);
    portSource = `cwd match: ${cwdMatch.name}`;
  } else {
    port = "8700";
    portSource = "8700 (default)";
    if (live.length) {
      const names = live.map((e) => `${e.name} (${e.cwd})`).join(", ");
      console.error(`hj: warning — targeting the default port 8700, but these haltija servers are running: ${names}`);
      console.error(`hj: if you meant one of them, cd into its directory, or use --name/--port. See \`hj where\`.`);
    }
  }
}
var tokenIdx = args.indexOf("--token");
if (tokenIdx !== -1 && args[tokenIdx + 1]) {
  process.env.HALTIJA_TOKEN = args[tokenIdx + 1];
  args.splice(tokenIdx, 2);
}
var noLaunch = false;
var noLaunchIdx = args.indexOf("--no-launch");
if (noLaunchIdx !== -1) {
  noLaunch = true;
  args.splice(noLaunchIdx, 1);
}
var { windowTarget, args: argsWithoutWindow } = extractWindowTarget(args);
args.length = 0;
args.push(...argsWithoutWindow);
var explicitTarget = portSource !== "8700 (default)";
if (args.length >= 2 && isSubcommand(`${args[0]}-${args[1]}`)) {
  args.splice(0, 2, `${args[0]}-${args[1]}`);
}
var NOUN_DEFAULTS = {
  test: "test-run",
  events: "events",
  mutations: "mutations-status",
  network: "network",
  select: "select-status",
  tabs: "windows",
  video: "video-status",
  send: "send"
};
if (args.length === 1 && !isSubcommand(args[0]) && NOUN_DEFAULTS[args[0]]) {
  args[0] = NOUN_DEFAULTS[args[0]];
}
var subcommand = args[0];
var subArgs = args.slice(1);
if (windowTarget)
  subArgs = [...subArgs, "--window", windowTarget];
if (subcommand === "where") {
  await runWhere(port, portSource, subArgs.includes("--json"));
  process.exit(0);
}
if (subcommand === "servers" || subcommand === "ls") {
  await runServers(port);
  process.exit(0);
}
if (subcommand === "shutdown" || subcommand === "quit") {
  const token = process.env.HALTIJA_TOKEN;
  try {
    const resp = await fetch(`http://localhost:${port}/shutdown`, {
      method: "POST",
      headers: token ? { "X-Haltija-Token": token } : {},
      signal: AbortSignal.timeout(3000)
    });
    if (resp.ok) {
      const j = await resp.json().catch(() => ({}));
      console.log(j.message || `Shutdown requested on port ${port}.`);
      process.exit(0);
    }
    console.error(`hj ${subcommand}: server on port ${port} returned HTTP ${resp.status}`);
    process.exit(1);
  } catch (err) {
    if (err.code === "ConnectionRefused" || err.cause?.code === "ECONNREFUSED") {
      console.log(`No server listening on port ${port} (already stopped).`);
      process.exit(0);
    }
    console.error(`hj ${subcommand}: ${err.message}`);
    process.exit(1);
  }
}
if (!isSubcommand(subcommand)) {
  const suggestion = getSuggestion(subcommand);
  if (suggestion === "--help") {
    const topic = args[1];
    if (topic) {
      filterHelp(topic);
    } else {
      console.log(listSubcommands());
    }
    process.exit(0);
  }
  if (suggestion) {
    runSubcommand(suggestion, subArgs, port, { noLaunch, explicitTarget });
  } else {
    console.error(`Unknown command: '${subcommand}'`);
    console.error(`
Examples: hj tree, hj navigate <url>, hj click @42`);
    console.error(`Run 'hj' for docs.`);
    process.exit(1);
  }
} else {
  runSubcommand(subcommand, subArgs, port, { noLaunch, explicitTarget });
}
function filterHelp(topic) {
  const bold2 = (s) => `\x1B[1m${s}\x1B[0m`;
  const dim3 = (s) => `\x1B[2m${s}\x1B[0m`;
  const needle = topic.toLowerCase();
  const helpText = listSubcommands();
  const lines = helpText.split(`
`);
  const matches = [];
  let currentCategory = "";
  for (const line of lines) {
    if (line.match(/^\s{2}\x1b\[1m/)) {
      currentCategory = line;
      continue;
    }
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, "").toLowerCase();
    if (stripped.trim() && stripped.includes(needle)) {
      matches.push({ category: currentCategory, line });
    }
  }
  if (matches.length === 0) {
    console.log(`No commands matching '${topic}'.`);
    console.log(`Run ${dim3("hj help")} to see all commands.`);
    return;
  }
  console.log(`
Commands matching '${bold2(topic)}':
`);
  let lastCategory = "";
  for (const m of matches) {
    if (m.category && m.category !== lastCategory) {
      console.log(m.category);
      lastCategory = m.category;
    }
    console.log(m.line);
  }
  const hintMatches = Object.entries(COMMAND_HINTS).filter(([cmd, hint]) => cmd.toLowerCase().includes(needle) || hint.toLowerCase().includes(needle));
  if (hintMatches.length > 0) {
    console.log(`
  ${bold2("Hints")}`);
    for (const [cmd, hint] of hintMatches) {
      console.log(`    ${bold2(cmd.padEnd(28))} ${dim3(hint)}`);
    }
  }
  console.log("");
}
