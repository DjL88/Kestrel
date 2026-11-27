/**
 * The figures behind the admin console's "Today" summary (GET /v1/admin/overview), and the plain-English switch names.
 * A figure that cannot be read is null, never zero, so the page can say "not known".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySpendGuard } from '../src/spendGuard.ts';
import { SWITCHES } from '../src/appShared.ts';
import { startHarness } from './helpers.ts';

test('the overview gives Pro subscribers by plan and this month’s cloud spend against the cap', async () => {
  const guard = new MemorySpendGuard();
  await guard.reserve(Date.UTC(2026, 10, 5), 412, 1500);
  const h = await startHarness(undefined, undefined, {
    spend: { guard, ceilingPence: 1500, cloudJobPence: 2, aiCallPence: 1 },
    proSubscriberCounts: async () => ({ monthly: 5, annual: 3 }),
  });
  try {
    assert.equal((await h.call('GET', '/v1/admin/overview', { token: h.user.token })).status, 403);
    const r = await h.call('GET', '/v1/admin/overview', { token: h.adminToken });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.proSubscribers, { monthly: 5, annual: 3 });
    assert.deepEqual(r.body.spend, { month: '2026-11', spentPence: 412, ceilingPence: 1500 });
  } finally { await h.close(); }
});

test('figures that cannot be read are null, not zero', async () => {
  const h = await startHarness(undefined, undefined, { proSubscriberCounts: async () => { throw new Error('Firestore down'); } });
  try {
    const r = await h.call('GET', '/v1/admin/overview', { token: h.adminToken });
    assert.equal(r.status, 200);
    assert.equal(r.body.proSubscribers, null);
    assert.equal(r.body.spend, null);
  } finally { await h.close(); }
});

test('switch names are plain English, with no engineering jargon', () => {
  for (const w of SWITCHES) {
    assert.doesNotMatch(w.label + ' ' + w.note, /metadata-free|thumbnail|kill switch|FCM|SMTP|Vertex|shadow file|Learning signal|Managed Gemini/i, w.key);
    assert.ok(w.note.length <= 220, `${w.key} note is short`);
  }
});
