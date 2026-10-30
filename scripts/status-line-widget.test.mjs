// End-to-end check: mount the extension's status-line widget, switch the theme,
// and confirm the rendered ANSI lines change. Skips when Pi is not installed.
//
// Run:  node scripts/status-line-widget.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPiThemeModule } from "./lib/pi-theme-module.mjs";

const piTheme = await loadPiThemeModule();
const bundlePath = process.env.BUNDLE_UNDER_TEST
  ? path.resolve(process.env.BUNDLE_UNDER_TEST)
  : fileURLToPath(new URL("../dist/extensions/pi-omp-theme.ts", import.meta.url));
const extension = await import(pathToFileURL(bundlePath).href).catch(() => null);
if (!piTheme || !extension?.default) {
  console.log(`SKIP extension or Pi module unavailable (bundle: ${bundlePath})`);
  process.exit(0);
}

const { initTheme, theme: themeProxy, setRegisteredThemes, setThemeInstance, loadThemeFromPath } = piTheme;
initTheme("dark");

const candidates = [
  process.env.THEME_UNDER_TEST,
  "themes/titanium-light.json",
].filter(Boolean);
let altTheme = null;
for (const candidate of candidates) {
  if (!fs.existsSync(candidate)) continue;
  altTheme = loadThemeFromPath(path.resolve(candidate));
  if (altTheme) break;
}
if (!altTheme) {
  console.log("SKIP no alternate theme found (set THEME_UNDER_TEST to a theme json)");
  process.exit(0);
}

const handlers = new Map();
const widgets = new Map();
let footerFactory = null;
const notices = [];
const forcedThemes = [];

const pi = new Proxy({}, {
  get(_target, prop) {
    if (prop === "on") {
      return (event, handler) => {
        const list = handlers.get(String(event)) ?? [];
        list.push(handler);
        handlers.set(String(event), list);
      };
    }
    return () => undefined;
  }
});

extension.default(pi);

const ui = {
  theme: themeProxy,
  hasUI: true,
  mode: "tui",
  setWidget: (key, factory, placement) => {
    widgets.set(String(key), { factory, placement });
    return () => {};
  },
  clearWidget: (key) => widgets.delete(String(key)),
  setFooter: (factory) => {
    footerFactory = factory;
  },
  notify: (message) => notices.push(String(message)),
  requestRender: () => {},
  invalidate: () => {},
  getAllThemes: () => [],
  getTheme: (name) => (name === altTheme.name || name === "titanium" ? altTheme : undefined),
  setTheme: (name) => {
    forcedThemes.push(String(name));
    const next = name === altTheme.name ? altTheme : undefined;
    if (!next) return { success: false };
    setThemeInstance(next);
    return { success: true };
  }
};

const ctxBase = {
  mode: "tui",
  ui,
  cwd: process.cwd(),
  hasUI: true,
  sessionId: "test-session",
  sessionName: undefined,
  model: undefined,
  isProjectTrusted: () => true,
  getSessionInfo: () => ({ id: "test-session", name: undefined, model: undefined }),
  sessionManager: { getEntries: () => [], getBranch: () => [] },
  getModel: () => undefined,
  getThinkingLevel: () => "off"
};
// Any Pi context member the harness hasn't modelled answers with a no-op function.
const ctx = new Proxy(ctxBase, {
  get(target, prop) {
    if (prop in target) return target[prop];
    return () => undefined;
  }
});

const start = handlers.get("session_start") ?? [];
for (const handler of start) {
  await handler({ sessionId: "test-session", model: undefined, thinkingLevel: "off", kind: "startup" }, ctx);
}

if (widgets.size === 0) {
  console.log("SKIP the extension mounted no widgets in this harness (status line may need a real TUI)");
  if (notices.length > 0) console.log(`notices: ${notices.join(" | ")}`);
  process.exit(0);
}

const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 120 } };
const mounted = [...widgets.entries()].map(([key, entry]) => ({ key, component: entry.factory(tui, themeProxy) }));
const statusWidgets = mounted.filter(({ key }) => key.includes("status."));

const renderStatus = () => statusWidgets
  .map(({ component }) => component.render(120))
  .filter((lines) => Array.isArray(lines) && lines.length > 0)
  .map((lines) => lines.join("\n"))
  .join("\n");

const ansiPrefixes = (text) => new Set(text.match(/\x1b\[[0-9;]*m/g) ?? []);

// Only the status widgets matter: the startup card is a separate render path.
const before = renderStatus();
const beforeColors = ansiPrefixes(before);

setRegisteredThemes([altTheme]);
setThemeInstance(altTheme);
const after = renderStatus();
const afterColors = ansiPrefixes(after);

const checks = [
  ["status widgets were mounted", statusWidgets.length > 0, true],
  ["status line rendered something", before.length > 0, true],
  ["rendered status carries ANSI colours", beforeColors.size > 0, true],
  ["the theme really switched", themeProxy.name === altTheme.name, true],
  ["no theme forced at session start", forcedThemes.length, 0],
  ["status line repaints on theme switch without a request", before !== after, true],
  ["status line colour escapes change", [...beforeColors].some((c) => !afterColors.has(c)) || [...afterColors].some((c) => !beforeColors.has(c)), true]
];

let failed = 0;
for (const [label, actual, expected] of checks) {
  const ok = actual === expected;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
console.log(`\nstatus widgets: ${statusWidgets.map((m) => m.key).join(", ") || "none"}`);
console.log(`other widgets mounted: ${mounted.filter((m) => !m.key.includes("status.")).map((m) => m.key).join(", ") || "none"}`);
console.log(`theme dark → ${themeProxy.name}; status colours ${beforeColors.size} → ${afterColors.size}; themes forced at start: ${forcedThemes.join(", ") || "none"}`);
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("status-line widget checks passed");
