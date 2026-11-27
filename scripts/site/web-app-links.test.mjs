// The public site's Sign in links (owner decision 24 Nov 2026: the site opens the V2 editor). There is no public web
// editor route yet, and /V2Proto is the private test site, so the site offers the downloads and says the web editor
// is not open yet. Setting the inflight-web-app meta tag to the public path brings the sign-in links back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const site = new URL('../../site/', import.meta.url);
const read = (name) => readFileSync(new URL(name, site), 'utf8');

test('no public page links to the private test site', () => {
  for (const name of readdirSync(site).filter((n) => n.endsWith('.html') && n !== 'admin.html')) {
    assert.doesNotMatch(read(name), /href="\/?V2Proto|['"]\/V2Proto\/['"]/, name);
  }
});

test('with no public web editor, Sign in goes to the downloads and the page says why', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="inflight-web-app" content="">/);
  const links = [...html.matchAll(/<a [^>]*data-web-app="(\w+)"[^>]*>/g)];
  assert.deepEqual(links.map((m) => m[1]).sort(), ['guest', 'signin', 'signin', 'signup']);
  for (const [tag, kind] of links) {
    assert.match(tag, /href="#downloads"/, kind);
    if (kind !== 'signin') assert.match(tag, /\shidden[\s>]/, `${kind} waits for the public editor`);
  }
  assert.match(html, /id="downloads"/);
  assert.match(html, /data-web-app-closed data-i18n="webAppSoon"/);
});

test('the note is in every language the site has', () => {
  const window = {};
  new Function('window', read('assets/i18n-strings.js'))(window);
  for (const [code, words] of Object.entries(window.KESTREL_STRINGS)) {
    assert.ok(words.webAppSoon && words.webAppSoon.length > 40, code);
    assert.doesNotMatch(words.webAppSoon, /V2Proto/, code);
  }
});
