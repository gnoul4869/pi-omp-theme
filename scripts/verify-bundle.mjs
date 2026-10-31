import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const bundle = "dist/extensions/pi-omp-theme.ts";
const src = fs.readFileSync(bundle, "utf8");

const checks = [
  ["autoApply no longer forces titanium", /autoApply: "off",/],
  ["no forced titanium default remains", /autoApply: "titanium",/],
  ["live theme identity helper exists", /function themeIdentityKey\(theme\) \{/],
  ["theme-dependent state refresh helper exists", /function syncThemeDependentState\(theme\) \{/],
  ["status-line cache keys on live theme identity", /themeCache && themeCache\.themeId === themeId/],
  ["status-line cache records identity", /themeCache = \{ themeId, config, resolved/],
  ["status line reads the live theme at render time", /const activeTheme = options\.host\?\.theme \?\? currentTheme;/],
  ["tool/working row refreshes captured theme state", /syncThemeDependentState\(piTheme\);/],
  ["status bar shrinks the flagged segments first", /function shrinkFirstToFit\(candidates, width, separator, padding\) \{/],
  ["project path collapses folder by folder", /function pathShrinkLevels\(value\) \{/],
  ["path segment declares its shrink ladder", /shrinkLevels: levels,/],
];

let failed = 0;
for (const [label, pattern] of checks) {
  const inverted = label.startsWith("no ");
  const present = pattern.test(src);
  const ok = inverted ? !present : present;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failed++;
}

const tmp = path.join(os.tmpdir(), "pi-omp-theme-syntax-check.mjs");
fs.writeFileSync(tmp, src);
const syntax = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
fs.unlinkSync(tmp);
console.log(`${syntax.status === 0 ? "ok  " : "FAIL"} bundle parses as ES module syntax`);
if (syntax.status !== 0) {
  console.error(syntax.stderr);
  failed++;
}

if (failed > 0) {
  console.error(`\n${failed} bundle check(s) failed`);
  process.exit(1);
}
console.log("\nall bundle checks passed");
