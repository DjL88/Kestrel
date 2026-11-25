import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandLogo } from './icons/BrandIcon';

// The V2 header and Projects hub draw their own logo. With Pro it must carry the Pro badge, like the shared logo and the
// Pro splash do (owner report, 25 Nov: the splash said Pro, the header still said Basic).
test('V2 logo shows the Pro badge only when pro', () => {
  const basic = renderToStaticMarkup(createElement(BrandLogo, { height: 38 }));
  assert.match(basic, /aria-label="InFlight"/);
  assert.doesNotMatch(basic, /<rect/);
  const pro = renderToStaticMarkup(createElement(BrandLogo, { height: 38, pro: true }));
  assert.match(pro, /aria-label="InFlight Pro"/);
  assert.match(pro, /<rect/);
  assert.match(pro, /viewBox="-37\.2 -125\.2 746\.7 184\.4"/, 'wide enough for the badge');
});

test('V2 Pro badge follows the theme', () => {
  const dark = renderToStaticMarkup(createElement(BrandLogo, { pro: true }));
  const light = renderToStaticMarkup(createElement(BrandLogo, { pro: true, light: true }));
  assert.match(dark, /#F4F6F9/);
  assert.match(light, /#8E959F/);
});
