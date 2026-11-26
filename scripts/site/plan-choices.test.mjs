import test from 'node:test';
import assert from 'node:assert/strict';
import { publicFlag, lastDay, planChoicesView } from '../../site/assets/plan-choices.mjs';

const DAY = 86_400_000;
const FRI = Date.UTC(2026, 10, 27);
const doc = (flags) => ({ payload: { schema: 1, flags }, signature: 'x', keyId: 'k' });
const on = { default: true, rules: [] };
const promo = { default: false, rules: [{ audience: { kind: 'any' }, enabled: true, startsAtMs: FRI, endsAtMs: FRI + 4 * DAY }] };

test('the choices stay hidden unless the flag is on', () => {
  assert.equal(planChoicesView(null, FRI).showChoices, false);
  assert.equal(planChoicesView(doc({}), FRI).showChoices, false);
  assert.equal(planChoicesView(doc({ sitePlanChoices: { default: false, rules: [] } }), FRI).showChoices, false);
  assert.equal(planChoicesView(doc({ sitePlanChoices: on }), FRI).showChoices, true);
  assert.equal(planChoicesView(doc({ sitePlanChoices: { ...on, kill: true } }), FRI).showChoices, false);
});

test('the offer shows only inside its dates, and only with the choices', () => {
  const both = doc({ sitePlanChoices: on, proPromo: promo });
  assert.deepEqual(planChoicesView(both, FRI - 1), { showChoices: true, showPromo: false, promoLastDay: null });
  assert.deepEqual(planChoicesView(both, FRI), { showChoices: true, showPromo: true, promoLastDay: '2026-11-30' });
  assert.equal(planChoicesView(both, FRI + 4 * DAY).showPromo, false, 'the end is exclusive');
  assert.equal(planChoicesView(doc({ proPromo: promo }), FRI).showPromo, false);
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

test('last day is the day before the exclusive end', () => {
  assert.equal(lastDay(Date.UTC(2026, 11, 1)), '2026-11-30');
  assert.equal(lastDay(null), null);
});
