import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { todaySummary, collapseAudit, auditText, isPageView } from '../../site/assets/admin-words.mjs';
import { FLAG_INFO, KNOWN_FLAGS, NEVER_GATED, flagName } from '../../site/assets/admin-flags.js';

const NOW = Date.parse('2026-11-27T09:00:00Z');
const overview = { accounts: 42, licences: 12, activations: 15, proSubscribers: { monthly: 5, annual: 3 }, spend: { month: '2026-11', spentPence: 412, ceilingPence: 1500 } };
const payments = { connected: true, transactions: [
  { paidAt: '2026-11-26T12:00:00Z', status: 'paid', totalPence: 299 },
  { paidAt: '2026-11-20T12:00:00Z', status: 'partially_refunded', totalPence: 2999 },
  { paidAt: '2026-11-21T12:00:00Z', status: 'refunded', totalPence: 2999 },
  { paidAt: '2026-10-30T12:00:00Z', status: 'paid', totalPence: 299 },
] };
const text = (lines, id) => lines.find(l => l.id === id).text;

test('Today says each figure as one plain sentence', () => {
  const lines = todaySummary({ overview, payments, needs: 0 }, NOW);
  assert.deepEqual(lines.map(l => l.id), ['people', 'pro', 'payments', 'spend', 'needs']);
  assert.equal(text(lines, 'people'), '42 people have an InFlight account. 15 devices use a Pro licence.');
  assert.equal(text(lines, 'pro'), '8 people subscribe to Pro: 5 monthly and 3 yearly.');
  assert.equal(text(lines, 'payments'), '2 payments so far this month, £32.98 in all.', 'refunded and last month’s payments are left out');
  assert.equal(text(lines, 'spend'), '£4.12 of the £15.00 monthly cap used (27%).');
  assert.equal(lines.find(l => l.id === 'spend').meter, 27);
  assert.equal(text(lines, 'needs'), 'Nothing needs you.');
});

test('singular words, nothing yet, and closeness to the cap read naturally', () => {
  const lines = todaySummary({ overview: { ...overview, accounts: 1, activations: 0, proSubscribers: { monthly: 0, annual: 0 }, spend: { spentPence: 1300, ceilingPence: 1500 } },
    payments: { connected: true, transactions: [] }, needs: 1 }, NOW);
  assert.equal(text(lines, 'people'), '1 person has an InFlight account. No device uses a Pro licence yet.');
  assert.equal(text(lines, 'pro'), 'Nobody subscribes to Pro yet.');
  assert.equal(text(lines, 'payments'), 'No payments yet this month.');
  assert.match(text(lines, 'spend'), /87%\)\. Close to the cap/);
  assert.equal(lines.find(l => l.id === 'spend').warn, true);
  assert.equal(text(lines, 'needs'), '1 thing needs you: see below.');
});

test('a figure that could not be read is not known, never zero', () => {
  const lines = todaySummary({ overview: null, payments: null, needs: 0, unknown: true }, NOW);
  for (const id of ['people', 'pro', 'payments', 'spend']) assert.match(text(lines, id), /^Not known/);
  assert.match(text(lines, 'needs'), /could not be checked/);
  assert.match(text(todaySummary({ overview, payments: { connected: false, transactions: [] } }, NOW), 'payments'), /not connected/);
});

test('repeated identical audit entries fold into one row with a count; different ones stay apart', () => {
  const at = (m) => Date.parse('2026-11-26T19:46:00Z') - m * 60_000;
  const signin = (m) => ({ at_ms: at(m), actor: 'acc_a', action: 'user.signin', outcome: 'allowed', detail: 'firebase' });
  const rows = collapseAudit([signin(0), signin(2), signin(4), { ...signin(6), detail: 'firebase attached=1' }, signin(8)]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].newestMs, at(0));
  assert.equal(rows[0].oldestMs, at(4));
  assert.equal(rows[1].count, 1);
  assert.equal(rows[2].count, 1);
});

test('audit actions read as plain words; page look-ups are recognised', () => {
  assert.equal(auditText('user.signin'), 'Signed in to the app');
  assert.equal(auditText('switch.set'), 'Changed a switch');
  assert.equal(auditText('messages.read'), 'Looked at messages');
  assert.equal(auditText('something.new'), 'something.new');
  assert.ok(isPageView('overview') && isPageView('flags.read') && isPageView('compliance.list') && isPageView('pricing.review.read'));
  assert.ok(!isPageView('switch.set') && !isPageView('user.signin'));
});

test('every feature the app knows has a plain name, and the always-on list matches the app', () => {
  const source = readFileSync(new URL('../../src/core/features.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('export const FEATURES = {'), source.indexOf('} as const;'));
  const features = [...block.matchAll(/^\s+(\w+): '(?:free|paid|flagged)'/gm)].map(m => m[1]);
  assert.ok(features.length > 20);
  for (const key of features) assert.ok(FLAG_INFO[key], key + ' has a plain name');
  const never = /NEVER_GATED[^=]*= new Set<Feature>\(\[([^\]]+)\]/.exec(source)[1].match(/'(\w+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual([...NEVER_GATED].sort(), never.sort());
  assert.equal(flagName('accountData'), 'Delete my account and export my data');
  assert.equal(flagName('cloudRecipe'), 'Cloud editing');
  assert.equal(flagName('notKnown'), 'notKnown');
  assert.deepEqual(KNOWN_FLAGS, Object.keys(FLAG_INFO));
});
