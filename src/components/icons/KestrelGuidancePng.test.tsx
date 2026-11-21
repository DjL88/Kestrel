import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { KestrelGuidancePng } from './KestrelGuidancePng';

test('guidance marks resolve to transparent PNG asset paths', () => {
  for (const mode of ['soar', 'glide', 'fly-solo'] as const) {
    const html = renderToStaticMarkup(<KestrelGuidancePng mode={mode} />);
    assert.match(html, new RegExp('/icons/guidance/' + mode + '\\.png'));
    assert.match(html, /alt=""/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /width="24"/);
  }
});
test('standalone mark is accessible and can scale', () => {
  const html = renderToStaticMarkup(<KestrelGuidancePng mode="fly-solo" label="Fly Solo" size={40} />);
  assert.match(html, /alt="Fly Solo"/);
  assert.match(html, /width="40"/);
  assert.doesNotMatch(html, /aria-hidden="true"/);
});
