// Runtime check for the fork's theme-switch fix.
//
// Reproduces Pi's real theme plumbing: the theme Pi hands extensions is a Proxy
// whose identity never changes, while the object behind it is swapped on every
// theme switch. The fork keys its caches on that live identity instead.
//
// Run:  node scripts/theme-switch.test.mjs
// Optional: PI_CODING_AGENT_DIR=<path to @earendil-works/pi-coding-agent>
import fs from "node:fs";
import path from "node:path";
import { loadPiThemeModule } from "./lib/pi-theme-module.mjs";

const bundlePath = "dist/extensions/pi-omp-theme.ts";
const src = fs.readFileSync(bundlePath, "utf8");
const match = src.match(/function themeIdentityKey\(theme\) \{[\s\S]*?\n\}/);
if (!match) {
  console.error("FAIL themeIdentityKey not found in the bundle");
  process.exit(1);
}
const themeIdentityKey = new Function(`return (${match[0].replace(/^function themeIdentityKey/, "function")});`)();

const piTheme = await loadPiThemeModule();
if (!piTheme) {
  console.log("SKIP Pi theme module unavailable (install @earendil-works/pi-coding-agent or set PI_CODING_AGENT_DIR)");
  process.exit(0);
}

const { initTheme, theme, setRegisteredThemes, setThemeInstance, loadThemeFromPath } = piTheme;
initTheme("dark");
const proxy = theme;
const first = proxy.name;

const themePath = process.env.THEME_UNDER_TEST ?? process.argv[2] ?? "themes/titanium-light.json";
const alt = fs.existsSync(themePath) ? loadThemeFromPath(path.resolve(themePath)) : null;
if (!alt) {
  console.log(`SKIP no second theme found at ${themePath}`);
  process.exit(0);
}
setRegisteredThemes([alt]);
setThemeInstance(alt);

const identityStable = theme === proxy;
const nameNow = proxy.name;
const keyBefore = themeIdentityKey({ name: first, colors: undefined });
const keyAfter = themeIdentityKey(proxy);

const checks = [
  ["Pi's theme handle keeps one object identity", identityStable, true],
  ["the handle forwards the live theme name", nameNow, alt.name],
  ["identity key changes when the theme changes", keyBefore !== keyAfter, true],
  ["identity key is stable for the same theme", themeIdentityKey(proxy) === keyAfter, true],
  ["identity key survives a throwing colors getter", themeIdentityKey({ get colors() { throw new Error("not ready"); }, name: "x" }), "x"],
];

let failed = 0;
for (const [label, actual, expected] of checks) {
  const ok = actual === expected;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
console.log(`\ntheme under test: ${alt.name} (was ${first})`);
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("theme-switch checks passed");
