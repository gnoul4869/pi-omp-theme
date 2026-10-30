# Theme switching

Pi's **`/settings → Theme`** picker lists this package's `titanium` / `titanium-light` themes together with every other theme, so switching should be immediate and should survive a restart. In the original implementation it was neither. This document records the fixes and the Pi internals they depend on.

All edits live in `dist/extensions/pi-omp-theme.ts`, which is the shipped bundle and the only source of truth for the extension. `npm run verify` asserts every fix below is present and syntax-checks the bundle. The `piOmpTheme` configuration namespace is unchanged, so existing Pi settings carry over.

---

## Problem

This package ships its own `titanium` / `titanium-light` themes, and Pi's **`/settings → Theme`** picker lists them next to every other Pi theme, so switching between them should be free. In practice:

1. **The status line kept the previous theme's colours** until the next message was sent.
2. **The theme chosen in `/settings` was reset to `titanium`** on the next Pi start or `/reload`.
3. Quietly, **theme-provided extras** (glyphs, bash prompt colour, shimmer) kept following the theme that was active at session start.

## Root causes

### 1. Pi's theme handle is a stable proxy

Pi hands extensions a proxy whose identity never changes; only the object behind it is swapped:

```js
export const theme = new Proxy({}, {
  get(_target, prop) {
    const t = globalThis[THEME_KEY];
    if (!t) throw new Error("Theme not initialized. Call initTheme() first.");
    return t[prop];
  },
});
```

The status line cached on that object's identity:

```js
const themeFor = (activeTheme) => {
  if (themeCache && themeCache.theme === activeTheme && themeCache.config === config) return themeCache;
  // ...
  themeVersion++;
};
```

`themeCache.theme === activeTheme` is therefore always true, `themeVersion` never moves, and the line cache (`${width}|${themeVersion}|${snapshot}`) keeps replaying ANSI lines built from the old theme.

### 2. `ui.setTheme(name)` persists

`theme.autoApply` defaulted to `"titanium"` and ran at session start:

```js
const applyAutoTheme = (config, ctx) => {
  const target = config.theme.autoApply;
  if (ctx.mode !== "tui" || !target || target === "off") return;
  // ...
  ui.setTheme?.(target);
};
```

Pi's implementation writes a successful named switch into settings:

```js
setTheme: (themeOrName) => {
  if (themeOrName instanceof Theme) return this.themeController.setThemeInstance(themeOrName);
  const result = this.themeController.setThemeName(themeOrName);
  if (result.success) {
    if (this.settingsManager.getTheme() !== themeOrName) {
      this.settingsManager.setTheme(themeOrName);   // writes the theme setting
    }
  }
  return result;
},
```

So a session start silently rewrote the user's stored theme.

---

## The patches

### `theme.autoApply` no longer forces a theme

```diff
-    autoApply: "titanium",
+    autoApply: "off",
```

Pi's setting is now authoritative. To force a theme anyway, set `"piOmpTheme": { "theme": { "autoApply": "titanium" } }` or `PI_OMP_THEME_THEME=<name>`; an explicit value behaves exactly as before.

### Status-line cache keyed on live theme identity

```diff
 const themeFor = (activeTheme) => {
-  if (themeCache && themeCache.theme === activeTheme && themeCache.config === config) return themeCache;
+  const themeId = themeIdentityKey(activeTheme);
+  if (themeCache && themeCache.themeId === themeId && themeCache.config === config) return themeCache;
```

```diff
-    themeCache = { theme: activeTheme, config, resolved, separator: separatorsFor(config, resolved) };
+    themeCache = { themeId, config, resolved, separator: separatorsFor(config, resolved) };
```

### Status line resolves the theme at render time

```diff
   render(width) {
-    const lines = render(currentTheme, width, secondary);
+    const activeTheme = options.host?.theme ?? currentTheme;
+    syncThemeDependentState(activeTheme);
+    const lines = render(activeTheme, width, secondary);
```

### New helpers

```js
function themeIdentityKey(theme) {
  if (!theme) return "";
  try {
    const colors = theme.colors;
    return `${theme.name ?? ""}|${colors?.text ?? ""}|${colors?.accent ?? ""}|${colors?.border ?? ""}`;
  } catch {
    return String(theme.name ?? "");
  }
}

var lastSyncedThemeKey;
function syncThemeDependentState(theme) {
  if (!theme) return;
  const key = themeIdentityKey(theme);
  if (key === lastSyncedThemeKey) return;
  lastSyncedThemeKey = key;
  try {
    setSpecialBlockTheme(theme);
    setBashExecutionTheme(theme);
  } catch {}
}
```

`themeIdentityKey` reads the *live* theme through the proxy (name plus a few colours) and is `try/catch` guarded because `Theme.colors` can throw before themes are registered. `syncThemeDependentState` early-returns while the key is unchanged, and `setFullTheme()` inside it short-circuits on an unchanged theme name, so per-frame cost is a handful of property reads.

### Tool / working row keeps in sync

```diff
 const resolveWorkingTheme = () => {
   const piTheme = ctx.ui?.theme;
+  syncThemeDependentState(piTheme);
   return resolveTheme(...);
 };
```

---

## Untouched

Both Titanium themes, all presets, the status-line layout engine, widgets, tool rendering, glyph handling, the `/pi-omp-theme` command surface, and every other default. Only the five edits above differ from the shipped v1.0.26 bundle.

## Verification

`npm run check` covers three levels:

1. **Static** — `scripts/verify-bundle.mjs` greps the shipped bundle for every fix below and syntax-checks it.
2. **Pi internals** — `scripts/theme-switch.test.mjs` asserts that Pi's theme handle keeps one object identity while forwarding the live theme name, and that `themeIdentityKey` changes across a switch.
3. **Behaviour** — `scripts/status-line-widget.test.mjs` loads the bundle against a stubbed Pi context, mounts the real status-line widgets, switches the theme, and compares the rendered ANSI output.

The third one is the regression proof: against the original shipped bundle it fails three checks —

```text
FAIL no theme forced at session start        (got 1, expected 0)   # titanium was forced
FAIL status line repaints on theme switch    (got false, expected true)
FAIL status line colour escapes change       (got false, expected true)
```

— i.e. the status line renders byte-identical output before and after a theme switch. With the shipped bundle all seven checks pass. Point `BUNDLE_UNDER_TEST` at any bundle to reproduce:

```bash
npm install --no-save --no-package-lock @earendil-works/pi-coding-agent
BUNDLE_UNDER_TEST=<path to an unpatched bundle> npm run testWidgets
```

Manual check in a real session: pick a theme in `/settings → Theme` and watch the status row change without sending a message, then `/reload` and confirm the same theme is still selected.


## Scripts

| Command | Purpose |
|---|---|
| `npm run verify` | Assert the recorded fixes are present and the bundle parses |
| `npm run test` | Run `scripts/theme-switch.test.mjs` against the real Pi theme module (skips when Pi is not resolvable) |
| `npm run testWidgets` | Mount the status-line widget from the shipped bundle and prove it repaints on a theme change (`scripts/status-line-widget.test.mjs`) |
| `npm run check` | `verify` + `test` + `testWidgets` |
