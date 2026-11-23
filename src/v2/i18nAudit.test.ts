import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ratchet for "no hard-coded English in src/v2" (docs/V2-WORKSPACE.md 19.1). It counts words a person reads that sit in
 * a V2 component instead of the i18n area (src/i18n/areas/v2). The count may only go DOWN: move words into the area and
 * lower BASELINE in the same change. It is a heuristic (it cannot see every string), so a pass does not prove a screen is translated.
 */
const BASELINE = 171; // measured 23 Nov 2026; lower it as words move into the area

const ROOT = join(import.meta.dirname, 'ui');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

// Text between tags that starts with a capital and has a lowercase letter, or a visible-attribute string literal.
const TEXT_NODE = />\s*([A-Z][A-Za-z'’,.!?:()–-]*(?: [A-Za-z0-9'’,.!?:()–/&-]+)*)\s*</g;
const ATTRIBUTE = /\b(?:aria-label|title|placeholder|alt)="([A-Z][^"{}]*[a-z][^"{}]*)"/g;

export function findHardCodedEnglish(): string[] {
  const found: string[] = [];
  for (const file of files(ROOT)) {
    const source = readFileSync(file, 'utf8').split('\n').map((line) => (line.trim().startsWith('//') || line.trim().startsWith('*') ? '' : line)).join('\n');
    for (const pattern of [TEXT_NODE, ATTRIBUTE]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const text = match[1].trim();
        if (text === 'Promise' || text === 'InFlight' || text === 'Array') continue; // type names and the brand
        if (/[a-z]/.test(text) && !/^[A-Z][A-Za-z]*(?:\.[A-Za-z]+)+$/.test(text)) found.push(`${file.slice(ROOT.length + 1)}: ${text}`);
      }
    }
  }
  return found;
}

test('hard-coded English in V2 components does not grow (move words into src/i18n/areas/v2)', () => {
  const found = findHardCodedEnglish();
  assert.ok(found.length <= BASELINE, `${found.length} hard-coded strings, allowed ${BASELINE}:\n${found.join('\n')}`);
});
