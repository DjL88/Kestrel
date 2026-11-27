// Owner's scope decision, 27 Nov 2026: the site keeps cloud edits and cloud storage for your own devices, and pauses
// collaboration with other people (shared projects, invitations, client galleries) until it opens. The on-device
// "live to a client's iPad" view and tether claims were taken off the site until they are verified (owner, 27 Nov 2026).
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

test('unverified claims stay off the site until they are proven (owner, 27 Nov 2026)', () => {
  const UNVERIFIED = /tether|live to a client|client's iPad|shoot live|Wi-Fi \(FTP\)|Nikon Z|supported catalogue|larger checks|refunded at any time/i;
  for (const page of ['index.html', 'press.html']) assert.doesNotMatch(visible(read(page)), UNVERIFIED, page);
  for (const [code, words] of Object.entries(strings())) {
    for (const [key, text] of Object.entries(words)) assert.doesNotMatch(text, UNVERIFIED, `${code}.${key}`);
  }
});

test('the press page writes no price: they come from the pricing source', () => {
  assert.doesNotMatch(visible(read('press.html')), /[£$€]\s?\d/);
});

test('every language carries the same keys as English', () => {
  const all = strings(), en = Object.keys(all['en-GB']).sort();
  for (const [code, words] of Object.entries(all)) {
    assert.deepEqual(Object.keys(words).sort(), en, `${code} has the same keys as en-GB`);
  }
});

test('the reworded lines are translated in every other language, not left in English', () => {
  const all = strings();
  for (const key of ['heroLeadNew', 'why3Body', 'matrixRowCloudRunner', 'proCloud', 'creditBody']) {
    for (const [code, words] of Object.entries(all)) {
      if (code.startsWith('en')) continue;
      assert.notEqual(words[key], all['en-GB'][key], `${code}.${key} is translated`);
    }
  }
});

test('the legal pages say which sharing features are coming later', () => {
  const privacy = read('privacy.html');
  for (const row of ['Coming later: you share a project with other people', 'Coming later: you publish a client gallery', 'Coming later: you see live cursors']) {
    assert.ok(privacy.includes(row), row);
  }
  assert.match(read('terms.html'), /Pro includes 2\.5 GB of online storage for photos you keep in the cloud, to open and edit on your other devices\./);
  assert.match(read('terms.html'), /client galleries are coming later; this section applies once they open/);
});
