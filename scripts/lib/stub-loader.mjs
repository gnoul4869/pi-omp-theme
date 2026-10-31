// Module-load hook: swaps the Pi host modules for the stubs in this directory.
export function resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-tui") {
    return { url: new URL("./stub-pi-tui.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier === "@earendil-works/pi-coding-agent") {
    return { url: new URL("./stub-pi-agent.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
