import assert from 'node:assert/strict';
import test from 'node:test';
import { endFromLastDay, fieldsFromRule, flagFromForm, lastDayText, NEVER_GATED, ruleFromFields, ruleSummary, startFromDay } from '../../site/assets/admin-flags.js';

const DAY = 86_400_000;
const base = { kind: 'plan', plan: 'basic', text: '', enabled: true, trial: false, firstDay: '', lastDay: '', percent: '' };

test('the last day is inclusive: the rule ends at the start of the day after it, and empty means until stopped', () => {
  assert.equal(startFromDay('2026-11-22'), Date.UTC(2026, 10, 22));
  assert.equal(endFromLastDay('2026-11-24'), Date.UTC(2026, 10, 25));
  assert.equal(endFromLastDay(''), null);
  assert.equal(startFromDay('not a date'), null);
  assert.equal(lastDayText(Date.UTC(2026, 10, 25)), '2026-11-24');
});

test('a trial rule is built from the fields, with a trial only when it is switched on', () => {
  const { rule } = ruleFromFields({ ...base, trial: true, firstDay: '2026-11-22', lastDay: '2026-11-24', percent: '25' });
  assert.deepEqual(rule, { audience: { kind: 'plan', plan: 'basic' }, enabled: true, trial: true, startsAtMs: Date.UTC(2026, 10, 22), endsAtMs: Date.UTC(2026, 10, 25), percent: 25 });
  assert.equal(ruleFromFields({ ...base, enabled: false, trial: true }).rule.trial, undefined, 'a switch-off rule is never a trial');
  assert.equal('endsAtMs' in ruleFromFields(base).rule, false, 'no last day means until stopped');
});

test('mistakes are refused in plain words and nothing is built', () => {
  assert.match(ruleFromFields({ ...base, kind: 'corporate', text: ' ' }).error, /organisation name/);
  assert.match(ruleFromFields({ ...base, kind: 'user', text: '' }).error, /email/);
  assert.match(ruleFromFields({ ...base, firstDay: '2026-11-24', lastDay: '2026-11-22' }).error, /before the first day/);
  assert.match(ruleFromFields({ ...base, percent: '150' }).error, /0 to 100/);
  assert.match(ruleFromFields({ ...base, percent: '2.5' }).error, /whole number/);
  assert.match(ruleFromFields({ ...base, kind: 'nobody' }).error, /Choose who/);
});

test('rules read back into the form unchanged, including a stored user hash', () => {
  const rule = { audience: { kind: 'user', email: 'a'.repeat(64) }, enabled: true, trial: true, startsAtMs: Date.UTC(2026, 10, 22), endsAtMs: Date.UTC(2026, 10, 25), percent: 10 };
  const fields = fieldsFromRule(rule);
  assert.equal(fields.lastDay, '2026-11-24');
  assert.deepEqual(ruleFromFields(fields).rule, rule);
});

test('each rule reads as a plain sentence', () => {
  assert.equal(ruleSummary({ audience: { kind: 'any' }, enabled: true, trial: true, startsAtMs: Date.UTC(2026, 10, 22), endsAtMs: Date.UTC(2026, 10, 25) }),
    'Everyone: on (trial), from 22 Nov 2026, last day 24 Nov 2026');
  assert.equal(ruleSummary({ audience: { kind: 'plan', plan: 'unknown' }, enabled: false }), 'People without an account: off, until stopped');
  assert.equal(ruleSummary({ audience: { kind: 'user', email: 'x' }, enabled: true, percent: 30 }), 'One named user: on, 30% of devices, until stopped');
  assert.equal(ruleSummary({ audience: { kind: 'corporate', name: 'Acme Ltd' }, enabled: true }), 'Organisation Acme Ltd: on, until stopped');
});

test('the whole form becomes the body the server expects', () => {
  const result = flagFromForm({ key: ' smartCulling ', defaultOn: false, kill: true, minAppVersion: '26.12.0', rules: [{ ...base, plan: 'pro' }] });
  assert.deepEqual(result, { key: 'smartCulling', flag: { default: false, kill: true, minAppVersion: '26.12.0', rules: [{ audience: { kind: 'plan', plan: 'pro' }, enabled: true }] } });
  assert.match(flagFromForm({ key: '9bad', defaultOn: true, rules: [] }).error, /must start with a letter/);
  assert.match(flagFromForm({ key: 'ok', defaultOn: true, minAppVersion: 'latest', rules: [] }).error, /26\.11\.2/);
  assert.match(flagFromForm({ key: 'ok', defaultOn: true, rules: [base, { ...base, percent: '999' }] }).error, /^Rule 2:/);
});

test('the never-switched-off list matches the app', () => {
  assert.deepEqual([...NEVER_GATED].sort(), ['basicEditing', 'cropAndStraighten', 'export', 'import', 'localBackup']);
});
