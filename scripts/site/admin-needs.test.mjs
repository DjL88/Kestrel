import test from 'node:test';
import assert from 'node:assert/strict';
import { needsYou, viewForHash, VIEWS } from '../../site/assets/admin-needs.mjs';

const NOW = Date.parse('2026-11-26T09:00:00Z');
const quiet = {
  refunds: [], messages: [{ status: 'answered' }], safety: { notices: [{ status: 'decided' }] },
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
    safety: { notices: [{ status: 'open', urgent: false }] },
    paddleKey: { lastRunOk: false, lastRunReason: 'Paddle answered 503' },
    learning: { runs: [{ status: 'failed' }, { status: 'failed' }] },
  }, NOW);
  assert.deepEqual(items.map(i => i.id), ['paddle-key', 'refunds', 'safety-notices', 'messages', 'learning']);
  assert.match(items.find(i => i.id === 'refunds').detail, /£5\.00/);
  assert.match(items[0].detail, /Paddle answered 503/);
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

test('links open the page that holds them, older names still work, and anything else is Today', () => {
  assert.equal(viewForHash('#flags'), 'advanced');
  assert.equal(viewForHash('#grant'), 'people');
  assert.equal(viewForHash('#refunds'), 'money');
  assert.equal(viewForHash('#safety'), 'messages');
  assert.equal(viewForHash('#service'), 'advanced');
  assert.equal(viewForHash('#licences'), 'people');
  assert.equal(viewForHash(''), 'today');
  assert.equal(viewForHash('#nope'), 'today');
  const all = Object.values(VIEWS).flatMap(v => v.sections);
  assert.equal(new Set(all).size, all.length);
});

test('each chore links to the section where it is done', () => {
  const { items } = needsYou({ ...quiet, refunds: [{ pence: 1 }], messages: [{ status: 'new' }], safety: { notices: [{ status: 'open' }] },
    learning: { runs: [{ status: 'failed' }, { status: 'failed' }] }, tax: { turnover: { backward: { notificationDue: '2026-12-30' } } } }, NOW);
  const sections = Object.values(VIEWS).flatMap(v => v.sections);
  for (const item of items) assert.ok(sections.includes(item.view) || VIEWS[item.view], item.id + ' → ' + item.view);
});

test('a safety answer without a notices list is not a crash', () => {
  assert.deepEqual(needsYou({ ...quiet, safety: { cases: [] } }, NOW).items, []);
});
