import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { SoarIcon, GlideIcon, FlySoloIcon, KestrelMotifIcon } from './KestrelFlightIcons';

test('flight icons share 24px, currentColor, 2px round Lucide geometry', () => {
  for (const Icon of [SoarIcon, GlideIcon, FlySoloIcon, KestrelMotifIcon]) {
    const svg = renderToStaticMarkup(<Icon />);
    assert.match(svg, /width="24"/);
    assert.match(svg, /height="24"/);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, /stroke-width="2"/);
    assert.match(svg, /stroke-linecap="round"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.doesNotMatch(svg, /<text|<image/);
  }
});
test('icons support named accessibility and flexible size/weight', () => {
  const svg = renderToStaticMarkup(<GlideIcon aria-label="Glide — quiet suggestions" size={32} strokeWidth={1.75} />);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Glide/);
  assert.match(svg, /width="32"/);
  assert.match(svg, /stroke-width="1.75"/);
  assert.doesNotMatch(svg, /aria-hidden="true"/);
});
test('each guidance mode has a distinct bird silhouette', () => {
  const icons = [SoarIcon, GlideIcon, FlySoloIcon].map(Icon => renderToStaticMarkup(<Icon />));
  assert.equal(new Set(icons).size, 3);
});
