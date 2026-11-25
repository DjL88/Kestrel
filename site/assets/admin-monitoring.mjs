// Local-only operational alert rehearsal. No network, persistence or FCM delivery.
export const RULES = Object.freeze([
  { id: 'traffic', label: 'Traffic surge', threshold: '3× expected requests and at least 100 requests in 15 minutes' },
  { id: 'errors', label: 'API failures', threshold: '5% server errors with at least 100 requests in 15 minutes' },
  { id: 'budget', label: 'Cloud spending', threshold: '80% warning / 100% critical of monthly budget' },
]);
export const SCENARIOS = Object.freeze({
  normal: { requests: 120, baseline: 100, errors: 1, budgetPercent: 20 },
  surge: { requests: 360, baseline: 100, errors: 2, budgetPercent: 20 },
  outage: { requests: 120, baseline: 100, errors: 12, budgetPercent: 20 },
  budget: { requests: 120, baseline: 100, errors: 1, budgetPercent: 102 },
});
export function evaluateSample(sample) {
  if (!sample || !['requests', 'baseline', 'errors', 'budgetPercent'].every(key =>
    Number.isFinite(sample[key]) && sample[key] >= 0) ||
    !['requests', 'baseline', 'errors'].every(key => Number.isSafeInteger(sample[key])) ||
    sample.errors > sample.requests) return { state: 'unavailable', alerts: [] };
  const alerts = [];
  if (sample.baseline > 0 && sample.requests >= 100 && sample.requests / sample.baseline >= 3)
    alerts.push({ id: 'traffic', severity: 'Notice', message: 'Request volume is at least three times the expected level.' });
  if (sample.requests >= 100 && sample.errors / sample.requests >= 0.05)
    alerts.push({ id: 'errors', severity: 'Critical', message: 'Server error rate is at least five per cent.' });
  if (sample.budgetPercent >= 80)
    alerts.push({ id: 'budget', severity: sample.budgetPercent >= 100 ? 'Critical' : 'Warning', message: 'Cloud spending reached a configured budget threshold.' });
  return { state: sample.baseline === 0 ? 'partial' : 'evaluated', alerts };
}
export function rehearseDelivery(alerts) {
  // A transport stub must never imply that FCM accepted or delivered a message.
  return alerts.map(alert => ({ ...alert, delivery: 'Simulated only — no push sent' }));
}
