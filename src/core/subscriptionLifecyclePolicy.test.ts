import assert from 'node:assert/strict';
import test from 'node:test';
import { subscriptionLifecycle, PAYMENT_RETRY_GRACE_DAYS, CLOUD_READ_ONLY_DAYS_V2 } from './subscriptionLifecyclePolicy';

const DAY = 86_400_000;
const PAID_THROUGH = Date.UTC(2026, 10, 23);

test('paid-through boundary permits uploads; retry grace never extends cloud uploads', () => {
  assert.equal(subscriptionLifecycle(PAID_THROUGH, PAID_THROUGH).cloudUploadsAllowed, true);
  const overdue = subscriptionLifecycle(PAID_THROUGH, PAID_THROUGH + 1);
  assert.equal(overdue.phase, 'retry_grace');
  assert.equal(overdue.cloudUploadsAllowed, false);
  assert.equal(overdue.cloudReadOnlyDownloadsAllowed, true);
});

test('21-day retry grace ends without withholding local work', () => {
  assert.equal(PAYMENT_RETRY_GRACE_DAYS, 21);
  assert.equal(subscriptionLifecycle(PAID_THROUGH, PAID_THROUGH + 21 * DAY).phase, 'retry_grace');
  const expired = subscriptionLifecycle(PAID_THROUGH, PAID_THROUGH + 21 * DAY + 1);
  assert.equal(expired.phase, 'downgraded');
  assert.equal(expired.localEditingAllowed, true);
  assert.equal(expired.localRecoveryAllowed, true);
  assert.equal(expired.localExportAllowed, true);
});

test('cloud copies stay read-only for 90 days, but no remote deletion is authorised', () => {
  assert.equal(CLOUD_READ_ONLY_DAYS_V2, 90);
  const end = subscriptionLifecycle(PAID_THROUGH, PAID_THROUGH + 90 * DAY);
  assert.equal(end.cloudReadOnlyDownloadsAllowed, true);
  assert.equal(end.cloudUploadsAllowed, false);
  assert.equal(end.cloudReadOnlyUntilMs, PAID_THROUGH + 90 * DAY);
  const later = subscriptionLifecycle(PAID_THROUGH, PAID_THROUGH + 90 * DAY + 1);
  assert.equal(later.cloudReadOnlyDownloadsAllowed, false);
  assert.equal(later.remoteDeletionAuthorised, false);
});

test('unverified timestamps fail closed for cloud while local editing and recovery survive', () => {
  for (const paidThrough of [null, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    const result = subscriptionLifecycle(paidThrough, PAID_THROUGH);
    assert.equal(result.phase, 'unknown');
    assert.equal(result.cloudUploadsAllowed, false);
    assert.equal(result.cloudReadOnlyDownloadsAllowed, false);
    assert.equal(result.remoteDeletionAuthorised, false);
    assert.equal(result.localEditingAllowed, true);
    assert.equal(result.localRecoveryAllowed, true);
  }
  assert.equal(subscriptionLifecycle(PAID_THROUGH, NaN).cloudUploadsAllowed, false);
});
