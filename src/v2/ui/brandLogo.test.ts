import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandLogo } from './icons/BrandIcon';

// The V2 header and Projects hub draw their own logo. With Pro it must be the brand pack's silver Pro logo, the one the
// Pro splash ends on (owner reports, 25 Nov: first the header still said Basic, then it showed the red logo with only a
// small Pro pill).
test('V2 logo is the standard logo without Pro, and the pack\'s silver Pro logo with it', () => {
  const basic = renderToStaticMarkup(createElement(BrandLogo, { height: 38 }));
  assert.match(basic, /aria-label="InFlight"/);
  assert.doesNotMatch(basic, /inflight-pro/);
  const pro = renderToStaticMarkup(createElement(BrandLogo, { height: 38, pro: true }));
  assert.match(pro, /alt="InFlight Pro"/, 'keeps the accessible name');
  assert.match(pro, /src="[^"]*\/inflight-pro-silver-horizontal-dark\.svg"/);
  assert.match(pro, /width="154"/, 'wide enough for the Pro pill (746.7 × 184.4 artwork at 38 px)');
  assert.doesNotMatch(pro, /var\(--brand-accent\)/, 'no red standard kite under the Pro logo');
});

test('V2 Pro logo follows the theme', () => {
  const dark = renderToStaticMarkup(createElement(BrandLogo, { pro: true }));
  const light = renderToStaticMarkup(createElement(BrandLogo, { pro: true, light: true }));
  assert.match(dark, /inflight-pro-silver-horizontal-dark\.svg/);
  assert.match(light, /inflight-pro-silver-horizontal-light\.svg/);
});
