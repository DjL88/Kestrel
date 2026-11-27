import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudJobError, cloudJobProblem } from './cloudJobProblem.ts';

test('a used-up month offers a top-up and says nothing was sent or charged', () => {
  const p = cloudJobProblem('start', 429, 'CLOUD_QUOTA_EXHAUSTED');
  assert.equal(p.topUp, true);
  assert.match(p.message, /Top up/);
  assert.match(p.message, /Nothing was sent or charged/);
});

test('every refusal the control plane sends for a cloud job has its own plain words', () => {
  for (const code of ['CONSENT_REQUIRED', 'CLOUD_NOT_CONFIGURED', 'CLOUD_DISABLED', 'CLOUD_RECIPE_DISABLED', 'CLOUD_NOT_ENTITLED',
    'CLOUD_INPUT_TOO_LARGE', 'CLOUD_RUNNER_FAILED', 'CLOUD_INPUT_MISSING', 'SPEND_CEILING_REACHED', 'RATE_LIMITED', 'NOT_FOUND']) {
    const p = cloudJobProblem('start', 503, code);
    assert.doesNotMatch(p.message, /[A-Z]{2,}_[A-Z]/, `${code} must not show a code`);
    assert.doesNotMatch(p.message, /\(\d{3}\)|\b50\d\b/, `${code} must not show a status number`);
    assert.doesNotMatch(p.message, /\bAI\b/);
  }
});

test('an expired sign-in says to sign in again; an unknown code falls back to the step, never the raw code', () => {
  assert.equal(cloudJobProblem('start', 401, 'AUTH_TOKEN_INVALID').signIn, true);
  const unknown = cloudJobProblem('status', 500, 'SOMETHING_NEW');
  assert.doesNotMatch(unknown.message, /SOMETHING_NEW|500/);
  assert.match(unknown.message, /Nothing was changed on this device/);
});

test('a failed run says the person was not charged (the control plane refunds it)', () => {
  assert.match(cloudJobProblem('failed').message, /not charged/);
  const error = new CloudJobError(cloudJobProblem('timeout'));
  assert.equal(error.message, error.problem.message);
  assert.ok(error instanceof Error);
});
