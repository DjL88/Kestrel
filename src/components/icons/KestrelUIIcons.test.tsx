import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Check, Settings2, Search, AlertTriangle, Loader2, Image, Bird, GlideIcon } from './KestrelUIIcons';

test('shared action icons have consistent optical strokes and round joins', () => {
  for (const Icon of [Check, Settings2, Search, AlertTriangle, Loader2, Image, Bird]) {
    const svg = renderToStaticMarkup(<Icon aria-label="Action" />);
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, /stroke-width="1.85"/);
    assert.match(svg, /stroke-linecap="round"/);
    assert.match(svg, /aria-label="Action"/);
  }
});
test('caller stroke and size overrides remain available', () => {
  const svg = renderToStaticMarkup(<Settings2 size={32} strokeWidth={2.5} aria-hidden="true" />);
  assert.match(svg, /width="32"/);
  assert.match(svg, /stroke-width="2.5"/);
});
test('guidance silhouettes coexist with action marks', () => {
  const svg = renderToStaticMarkup(<GlideIcon aria-label="Glide" />);
  assert.match(svg, /aria-label="Glide"/);
  assert.match(svg, /stroke-width="2"/);
});
