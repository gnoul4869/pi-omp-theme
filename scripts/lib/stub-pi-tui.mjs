// ANSI/width maths used by the stub Pi modules. Only what the status renderer
// needs is real; everything else in the stubs is inert.
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[K/g;
const ANSI_SPLIT = /(\x1b\[[0-9;]*m)/;
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF01-\uFF60\uFFE0-\uFFE6\u{1F000}-\u{1F9FF}\u{1FA00}-\u{1FAFF}]/u;

export function stripAnsi(value) {
  return String(value ?? "").replace(ANSI, "");
}

export function visibleWidth(value) {
  let width = 0;
  for (const char of stripAnsi(value)) width += WIDE.test(char) ? 2 : 1;
  return width;
}

export function truncateToWidth(value, maxWidth, ellipsis = "...") {
  const limit = Math.floor(maxWidth);
  const text = String(value ?? "");
  if (limit <= 0) return "";
  if (visibleWidth(text) <= limit) return text;
  const budget = Math.max(0, limit - visibleWidth(ellipsis));
  let out = "";
  let width = 0;
  // Escape sequences are kept whole and do not count toward the width.
  for (const piece of text.split(ANSI_SPLIT)) {
    if (piece === "") continue;
    if (piece.startsWith("\x1b")) {
      out += piece;
      continue;
    }
    for (const char of piece) {
      const charWidth = WIDE.test(char) ? 2 : 1;
      if (width + charWidth > budget) return `${out}${ellipsis}`;
      out += char;
      width += charWidth;
    }
  }
  return text;
}

export function wrapTextWithAnsi(text) {
  return String(text ?? "").split("\n");
}

export function hyperlink(text) {
  return String(text ?? "");
}

export function getCapabilities() {
  return {};
}

export function getKeybindings() {
  return { get: () => undefined, bind: () => {}, unbind: () => {} };
}

export class Markdown {
  render() {
    return [];
  }
}
