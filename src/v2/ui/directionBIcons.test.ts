import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { DIRECTION_B_PATHS } from './icons/directionBPaths.ts';

const folder = new URL('../../../public/v2-icons/b/', import.meta.url);

test('the inline Direction B icons match the SVG files, path for path', () => {
  const files = readdirSync(folder).filter((name) => name.endsWith('.svg'));
  assert.deepEqual(Object.keys(DIRECTION_B_PATHS).sort(), files.map((name) => name.slice(0, -4)).sort());
  for (const file of files) {
    const svg = readFileSync(new URL(file, folder), 'utf8');
    const drawn = [...svg.matchAll(/<path ([^>]*)\/>/g)].map((m) => m[1]).map((attrs) => {
      const opacity = /opacity="([^"]*)"/.exec(attrs)?.[1];
      return { d: /\bd="([^"]*)"/.exec(attrs)![1], ...(opacity ? { opacity: Number(opacity) } : {}) };
    });
    assert.deepEqual(DIRECTION_B_PATHS[file.slice(0, -4)], drawn, file);
    assert.match(svg, /viewBox="0 0 24 24"/, file);
    assert.match(svg, /stroke-width="1\.65"/, file);
    // A filled path only ever uses the transparent "paper", so drawing it unfilled is the same picture.
    for (const fill of svg.matchAll(/fill="([^"]*)"/g)) assert.ok(['none', 'var(--paper)'].includes(fill[1]), file);
  }
});
