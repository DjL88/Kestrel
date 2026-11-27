// Owner's scope decision, 27 Nov 2026: the site keeps cloud edits and cloud storage for your own devices, and pauses
// collaboration with other people (shared projects, invitations, client galleries) until it opens. The on-device
// "live to a client's iPad" view on your own network is not cloud collaboration and stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const site = new URL('../../site/', import.meta.url);
const read = (name) => readFileSync(new URL(name, site), 'utf8');
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
const strings = () => { const window = {}; new Function('window', read('assets/i18n-strings.js'))(window); return window.KESTREL_STRINGS; };
const COLLAB = /collaborat|edit(ing)? a project together|client galler|invite (people|clients|others)|with friends/i;

test('the home page and its English words make no collaboration claims', () => {
  assert.doesNotMatch(visible(read('index.html')), COLLAB);
  for (const code of ['en-GB', 'en-US']) {
    for (const [key, text] of Object.entries(strings()[code])) assert.doesNotMatch(text, COLLAB, `${code}.${key}`);
  }
});

test('cloud edits and cloud storage are described with their real numbers', () => {
  const g = strings()['en-GB'];
  assert.match(g.promiseCollabBody, /500 a month on Basic, 5,000 on Pro, then 0\.3p each/);
  assert.match(g.promiseCollabBody, /deleted after each run/);
  assert.match(g.promiseCollabBody, /2\.5 GB/);
  assert.match(g.proStorage, /other devices/);
  assert.doesNotMatch(g.creditBody, /friends|collaborat/i);
});

test('every language has the new wording, not the old collaboration promise', () => {
  for (const [code, words] of Object.entries(strings())) {
    assert.ok(words.promiseCollabBody.length > 80, code);
    assert.match(words.promiseCollabBody, /5[.,  ]?000/, `${code}: the Pro allowance is stated`);
  }
});

test('the local-network client view stays: it is not cloud collaboration', () => {
  const g = strings()['en-GB'];
  assert.match(g.why2Title, /client's iPad, no internet/);
});

test('the legal pages say which sharing features are coming later', () => {
  const privacy = read('privacy.html');
  for (const row of ['Coming later: you share a project with other people', 'Coming later: you publish a client gallery', 'Coming later: you see live cursors']) {
    assert.ok(privacy.includes(row), row);
  }
  assert.match(read('terms.html'), /Pro includes 2\.5 GB of online storage for photos you keep in the cloud, to open and edit on your other devices\./);
  assert.match(read('terms.html'), /client galleries are coming later; this section applies once they open/);
});
