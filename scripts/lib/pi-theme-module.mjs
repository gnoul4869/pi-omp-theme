// Resolve Pi's internal theme module without depending on its package exports map.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELATIVE = path.join("dist", "modes", "interactive", "theme", "theme.js");

export async function loadPiThemeModule() {
  const roots = [];
  if (process.env.PI_CODING_AGENT_DIR) roots.push(process.env.PI_CODING_AGENT_DIR);
  try {
    const entry = await import.meta.resolve("@earendil-works/pi-coding-agent");
    roots.push(path.dirname(path.dirname(fileURLToPath(entry))));
  } catch {
    // Peer dependency not installed.
  }
  try {
    roots.push(path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")))));
  } catch {
    // Not a bundled install.
  }
  for (const root of roots) {
    const candidate = path.join(root, RELATIVE);
    if (!fs.existsSync(candidate)) continue;
    try {
      return await import(pathToFileURL(candidate).href);
    } catch {
      // Try the next root.
    }
  }
  return null;
}
