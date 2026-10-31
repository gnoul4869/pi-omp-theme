#!/usr/bin/env node
// Behaviour test: as the terminal narrows, the project path gives way first —
// it collapses level by level to the folder name before any other status-bar
// segment compacts or moves to the second row. Rendered against stub Pi modules
// so it runs without a Pi install.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { stripAnsi, visibleWidth } from "./lib/stub-pi-tui.mjs";

const CWD = "D:\\Google Drive\\Projects\\Python\\J.A.D.A.I v2";
const BASE = "J.A.D.A.I v2";
const MODEL_FULL = "\u25d5 xhigh";
const PATH_GLYPH = "\u{1F4C1}";
const SEPARATOR = " | ";

const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-omp-theme-test-"));
process.env.PI_OMP_THEME_TEST_AGENT_DIR = agentDir;
fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ piOmpTheme: { preset: "claude-code" } }));

register("./lib/stub-loader.mjs", import.meta.url);

function anyObject() {
  const fn = function noop() {};
  return new Proxy(fn, {
    get: (_target, prop) => (prop === "then" || prop === "catch" || prop === "finally" ? undefined : anyObject()),
    apply: () => undefined
  });
}

const handlers = new Map();
const widgets = new Map();
const pi = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "on") {
        return (event, handler) => {
          const list = handlers.get(String(event)) ?? [];
          list.push(handler);
          handlers.set(String(event), list);
        };
      }
      if (prop === "exec") return async () => ({ stdout: "", stderr: "", code: 0 });
      return anyObject();
    }
  }
);

const theme = {
  name: "test-dark",
  colors: { text: "#d6d6d6", accent: "#7aa2f7", border: "#3b3f55" },
  fg: (_token, text) => `\x1b[38;2;150;160;180m${text ?? ""}\x1b[0m`,
  bold: (text) => `\x1b[1m${text ?? ""}\x1b[0m`,
  borderColor: (text) => `\x1b[38;2;90;100;120m${text ?? ""}\x1b[0m`
};

const uiBase = {
  theme,
  hasUI: true,
  mode: "tui",
  terminal: { rows: 24, columns: 120 },
  setWidget: (key, factory) => {
    widgets.set(String(key), factory);
    return () => {};
  },
  clearWidget: (key) => widgets.delete(String(key)),
  setFooter: () => {},
  notify: () => {},
  requestRender: () => {},
  invalidate: () => {},
  getAllThemes: () => [],
  getTheme: () => void 0,
  setTheme: () => ({ success: false })
};
const ui = new Proxy(uiBase, { get: (target, prop) => (prop in target ? target[prop] : () => undefined) });

const ctxBase = {
  mode: "tui",
  ui,
  theme,
  cwd: CWD,
  hasUI: true,
  sessionId: "test",
  model: { name: "Qwen 3.8 FN - Gyro M" },
  thinkingLevel: "xhigh",
  projectTrusted: true,
  isProjectTrusted: () => true,
  getContextUsage: () => ({ tokens: 0, contextWindow: 204800, percent: 0 }),
  gitRunner: {
    run: async (args) => {
      const list = Array.isArray(args) ? args : String(args ?? "").split(",");
      if (list.includes("--branch")) return { stdout: "## master...origin/master\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    }
  },
  getModel: () => ctxBase.model,
  getThinkingLevel: () => "xhigh",
  getSessionInfo: () => ({ id: "test", model: ctxBase.model }),
  sessionManager: { getEntries: () => [], getBranch: () => [] }
};
const ctx = new Proxy(ctxBase, { get: (target, prop) => (prop in target ? target[prop] : () => undefined) });

const mod = await import(new URL("../dist/extensions/pi-omp-theme.ts", import.meta.url).href);
const extension = mod.default ?? mod.extension;
if (typeof extension !== "function") {
  console.error(`FAIL bundle exports no extension factory (keys: ${Object.keys(mod).join(", ")})`);
  process.exit(1);
}

extension(pi);
for (const handler of handlers.get("session_start") ?? []) {
  await handler({ sessionId: "test", model: ctxBase.model, thinkingLevel: "xhigh", kind: "startup" }, ctx);
}
await new Promise((resolve) => setTimeout(resolve, 300));

const statusFactory = widgets.get("pi-omp-theme.status.primary");
if (!statusFactory) {
  console.error(`FAIL no status widget was mounted (got: ${[...widgets.keys()].join(", ") || "none"})`);
  process.exit(1);
}

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 120 } };
const rows = [];
for (let width = 140; width >= 60; width -= 5) {
  const lines = statusFactory(tui, theme).render(width).filter((line) => line !== "");
  rows.push({ width, line: lines[0] === void 0 ? "" : stripAnsi(lines[0]) });
}

console.log("primary status row while the terminal narrows:");
for (const row of rows) console.log(`  w=${String(row.width).padStart(3)}  ${row.line}`);

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

const rendered = rows.filter((row) => row.line !== "");
check("status row renders at every width", rendered.length === rows.length, `${rendered.length}/${rows.length}`);
check("widest width keeps the full path", rows[0].line.includes(CWD), `w=${rows[0].width}`);
check("row never overflows the terminal", rows.every((row) => visibleWidth(row.line) <= row.width));

const collapsed = rendered.filter((row) => row.line.includes(BASE) && !row.line.includes("Python"));
check("path eventually collapses to the folder name", collapsed.length > 0, collapsed.length ? `from w=${collapsed[0].width}` : "never");

const intermediate = rendered.find((row) => row.line.includes("\u2026"));
check("path collapses level by level, not all at once", Boolean(intermediate), intermediate ? `w=${intermediate.width} shows \u2026` : "no \u2026 step");

const pathStillFull = rendered.filter((row) => row.line.includes(CWD)).map((row) => row.width);
const modelCompacted = rendered.filter((row) => row.line.includes("Qwen") && !row.line.includes(MODEL_FULL)).map((row) => row.width);
check(
  "other segments only compact after the path is exhausted",
  pathStillFull.length > 0 && modelCompacted.length > 0 && Math.max(...modelCompacted) < Math.max(...pathStillFull),
  `path full down to w=${pathStillFull.length ? Math.max(...pathStillFull) : "-"}, model compacted from w=${modelCompacted.length ? Math.max(...modelCompacted) : "-"}`
);

const pathWidths = rendered.map((row) => {
  // The widget pads the row with a leading gutter, so measure the segment itself.
  const segment = row.line.split(SEPARATOR).find((part) => part.includes(PATH_GLYPH));
  return segment === void 0 ? 0 : visibleWidth(segment.trim());
});
check(
  "path segment never grows as the terminal shrinks",
  pathWidths.every((width, index) => index === 0 || width <= pathWidths[index - 1]),
  pathWidths.join(" ")
);

fs.rmSync(agentDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} status shrink check(s) failed`);
  process.exit(1);
}
console.log("\nstatus shrink checks passed");
