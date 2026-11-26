import test from 'node:test';
import assert from 'node:assert/strict';
import { needsYou, viewForHash, VIEWS } from '../../site/assets/admin-needs.mjs';

const NOW = Date.parse('2026-11-26T09:00:00Z');
const quiet = {
  refunds: [], messages: [{ status: 'answered' }], safety: { cases: [{ kind: 'ai-flag', status: 'released' }], notices: [{ status: 'decided' }] },
  paddleKey: { lastRunOk: true, expiresAt: '2027-02-01T00:00:00Z' }, learning: { runs: [{ status: 'succeeded' }] }, mail: { warn: false },
  tax: { turnover: { state: 'ok' } },
};

test('nothing to act on gives an empty list and nothing unknown', () => {
  assert.deepEqual(needsYou(quiet, NOW), { items: [], unknown: [] });
});

test('each kind of chore appears once, urgent first', () => {
  const { items } = needsYou({
    ...quiet,
    refunds: [{ pence: 412 }, { pence: 88 }],
    messages: [{ status: 'new' }, { status: 'read' }],
    safety: { cases: [{ kind: 'ai-flag', status: 'review' }, { kind: 'hash-match', status: 'held', ncmec: { error: '503' } }], notices: [{ status: 'open', urgent: false }] },
    paddleKey: { lastRunOk: false, lastRunReason: 'Paddle answered 503' },
    learning: { runs: [{ status: 'failed' }, { status: 'failed' }] },
  }, NOW);
  assert.deepEqual(items.map(i => i.id), ['safety-report', 'paddle-key', 'refunds', 'safety-held', 'safety-notices', 'messages', 'learning']);
  assert.match(items.find(i => i.id === 'refunds').detail, /£5\.00/);
  assert.match(items[0].detail, /failed for 1/);
});

test('things that sort themselves out stay off the list', () => {
  const r = needsYou({ ...quiet, learning: { runs: [{ status: 'failed' }, { status: 'succeeded' }] }, mail: { warn: true, sent: 400, cap: 450 }, tax: { turnover: { state: 'warning' } } }, NOW);
  assert.deepEqual(r.items, []);
});

test('a source that could not be read is unknown, never all good', () => {
  const r = needsYou({ ...quiet, refunds: null, safety: null }, NOW);
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.unknown, ['refunds owed', 'safety']);
});

test('a Paddle key close to expiry is flagged; VAT breach is urgent', () => {
  const r = needsYou({ ...quiet, paddleKey: { lastRunOk: true, expiresAt: '2026-12-01T00:00:00Z' }, tax: { turnover: { forward: { notificationDue: '2026-12-30' } } } }, NOW);
  assert.deepEqual(r.items.map(i => [i.id, i.urgent]), [['paddle-key', true], ['vat', true]]);
});

test('old section links still open the view that holds them', () => {
  assert.equal(viewForHash('#flags'), 'service');
  assert.equal(viewForHash('#grant'), 'licences');
  assert.equal(viewForHash('#money'), 'money');
  assert.equal(viewForHash(''), null);
  assert.equal(viewForHash('#nope'), null);
  const all = Object.values(VIEWS).flatMap(v => v.sections);
  assert.equal(new Set(all).size, all.length);
});
