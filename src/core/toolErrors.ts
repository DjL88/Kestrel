/**
 * Turn a technical failure from an on-device tool into one calm sentence. The raw text, such as
 * "Failed to fetch dynamically imported module: https://…", means nothing to a photographer.
 */
export function friendlyToolError(error: unknown, tool = 'subject tools'): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  // Messages we wrote ourselves are already plain words, so keep them.
  if (/checksum|could not be loaded|Canvas unavailable/i.test(text) && !/dynamically imported|module script/i.test(text)) return text;
  if (/dynamically imported module|importing a module script|failed to fetch|networkerror|load failed|wasm|webassembly/i.test(text)) {
    return `The ${tool} could not load. Reload the page and try again. Once they have loaded they work offline.`;
  }
  return `The ${tool} hit a problem. Please try again.`;
}
