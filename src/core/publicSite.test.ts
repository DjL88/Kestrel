import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLIC_SITE_ORIGIN, publicSiteUrl } from './publicSite.ts';

test('the app takes the website address from config/public-site.json', () => {
  const config = JSON.parse(readFileSync(new URL('../../config/public-site.json', import.meta.url), 'utf8'));
  assert.equal(PUBLIC_SITE_ORIGIN, config.origin);
  assert.equal(publicSiteUrl('/privacy.html'), `${config.origin}/privacy.html`);
  assert.equal(publicSiteUrl('#pricing'), `${config.origin}/#pricing`);
});
