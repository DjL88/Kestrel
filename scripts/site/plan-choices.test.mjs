import test from 'node:test';
import assert from 'node:assert/strict';
import { publicFlag, planChoicesView } from '../../site/assets/plan-choices.mjs';

const FRI = Date.UTC(2026, 10, 27);
const doc = (flags) => ({ payload: { schema: 1, flags }, signature: 'x', keyId: 'k' });
const on = { default: true, rules: [] };

test('the choices stay hidden unless the flag is on', () => {
  assert.equal(planChoicesView(null, FRI).showChoices, false);
  assert.equal(planChoicesView(doc({}), FRI).showChoices, false);
  assert.equal(planChoicesView(doc({ sitePlanChoices: { default: false, rules: [] } }), FRI).showChoices, false);
  assert.equal(planChoicesView(doc({ sitePlanChoices: on }), FRI).showChoices, true);
  assert.equal(planChoicesView(doc({ sitePlanChoices: { ...on, kill: true } }), FRI).showChoices, false);
});

test('the offer banner follows the Paddle discount, and only with the choices', () => {
  const choices = doc({ sitePlanChoices: on });
  const live = { live: true, lastDay: '2026-11-30' };
  assert.deepEqual(planChoicesView(choices, FRI, live), { showChoices: true, showPromo: true, promoLastDay: '2026-11-30' });
  assert.equal(planChoicesView(choices, FRI, { live: false, lastDay: null }).showPromo, false);
  assert.equal(planChoicesView(choices, FRI, null).showPromo, false, 'offer unreadable: no banner');
  assert.equal(planChoicesView(choices, FRI, { live: true, lastDay: null }).showPromo, false, 'no end date: no "buy by" banner');
  assert.equal(planChoicesView(choices, FRI, { live: true, lastDay: '<b>x' }).showPromo, false);
  assert.equal(planChoicesView(doc({}), FRI, live).showPromo, false);
});

test('rules for accounts do not apply to website visitors; off wins a tie', () => {
  const proOnly = { default: false, rules: [{ audience: { kind: 'plan', plan: 'pro' }, enabled: true }] };
  assert.equal(publicFlag(doc({ k: proOnly }), 'k', FRI).on, false);
  const tie = { default: false, rules: [{ audience: { kind: 'any' }, enabled: true }, { audience: { kind: 'any' }, enabled: false }] };
  assert.equal(publicFlag(doc({ k: tie }), 'k', FRI).on, false);
  const visitorsOff = { default: false, rules: [{ audience: { kind: 'any' }, enabled: true }, { audience: { kind: 'plan', plan: 'unknown' }, enabled: false }] };
  assert.equal(publicFlag(doc({ k: visitorsOff }), 'k', FRI).on, false);
  assert.deepEqual(publicFlag(doc({ k: { default: false, rules: [{ audience: { kind: 'any' }, enabled: true }] } }), 'k', FRI), { on: true, endsAtMs: null });
  assert.equal(publicFlag(doc({ k: 'nonsense' }), 'k', FRI).on, false);
  assert.equal(publicFlag(doc({ constructor: on }), 'toString', FRI).on, false);
});
