import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSample, SCENARIOS, rehearseDelivery } from '../../site/assets/admin-monitoring.mjs';

test('normal, surge, outage and budget samples stay distinct', () => {
  assert.deepEqual(evaluateSample(SCENARIOS.normal), { state: 'evaluated', alerts: [] });
  for (const [name, id, severity] of [['surge', 'traffic', 'Notice'], ['outage', 'errors', 'Critical'], ['budget', 'budget', 'Critical']]) {
    const { alerts } = evaluateSample(SCENARIOS[name]);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].id, id);
    assert.equal(alerts[0].severity, severity);
  }
});
test('threshold boundaries and low sample sizes', () => {
  assert.deepEqual(evaluateSample({ requests: 99, baseline: 1, errors: 99, budgetPercent: 79 }).alerts, []);
  const alerts = evaluateSample({ requests: 300, baseline: 100, errors: 15, budgetPercent: 80 }).alerts;
  assert.deepEqual(alerts.map(a => [a.id, a.severity]), [['traffic', 'Notice'], ['errors', 'Critical'], ['budget', 'Warning']]);
});
test('missing baseline is partial and invalid samples are unavailable, never healthy', () => {
  assert.equal(evaluateSample({ ...SCENARIOS.normal, baseline: 0 }).state, 'partial');
  assert.equal(evaluateSample({ ...SCENARIOS.normal, errors: 121 }).state, 'unavailable');
  assert.equal(evaluateSample({ ...SCENARIOS.normal, requests: NaN }).state, 'unavailable');
  assert.equal(evaluateSample(null).state, 'unavailable');
});
test('delivery rehearsal never reports a real notification', () => {
  const { alerts } = evaluateSample(SCENARIOS.outage);
  assert.equal(rehearseDelivery(alerts)[0].delivery, 'Simulated only — no push sent');
  assert.equal(rehearseDelivery([]).length, 0);
  assert.equal('delivery' in alerts[0], false);
});
