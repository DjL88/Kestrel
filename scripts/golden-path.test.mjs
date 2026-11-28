import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHECKS, GROUPS } from './golden-path/checks.mjs';
import { STATUS, browserStatus, flattenPlaywright, headline, nodeStatus, renderDoc, score, staticStatus } from './golden-path.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('every check has a unique id, a known group, a weight of 1 to 5 and exactly one way of being proven', () => {
  const ids = new Set();
  for (const c of CHECKS) {
    assert.match(c.id, /^GP-\d{2}$/);
    assert.ok(!ids.has(c.id), `duplicate ${c.id}`);
    ids.add(c.id);
    assert.ok(GROUPS.includes(c.group), `${c.id}: unknown group ${c.group}`);
    assert.ok(Number.isInteger(c.weight) && c.weight >= 1 && c.weight <= 5, `${c.id}: weight`);
    for (const key of ['what', 'how', 'expect']) assert.ok(c[key]?.length > 10, `${c.id}: ${key}`);
    assert.equal([c.spec, c.node, c.manual, c.planned].filter(Boolean).length, 1, `${c.id}: one of spec, node, manual, planned`);
    if (c.spec) assert.ok(c.spec.projects.every((p) => ['desktop', 'phone'].includes(p)), `${c.id}: projects`);
  }
  for (const g of GROUPS) assert.ok(CHECKS.some((c) => c.group === g), `group ${g} has no checks`);
});

test('every spec file the checks name exists and holds a test whose title matches', () => {
  for (const c of CHECKS) {
    const ref = c.spec ?? c.node;
    if (!ref) continue;
    // A feature that is not on this checkout may name a spec that arrives with it.
    if (staticStatus(c)?.status === STATUS.NOT_BUILT) continue;
    assert.ok(existsSync(`${root}${ref.file}`), `${c.id}: ${ref.file} is missing`);
    assert.ok(new RegExp(ref.grep).test(readFileSync(`${root}${ref.file}`, 'utf8')), `${c.id}: no test in ${ref.file} matches /${ref.grep}/`);
  }
});

test('docs/GOLDEN-PATH.md is generated from the checks', () => {
  assert.equal(readFileSync(`${root}docs/GOLDEN-PATH.md`, 'utf8'), renderDoc(), 'run: node scripts/golden-path.mjs --write-doc');
});

test('NOT BUILT, MANUAL and planned checks are decided before anything runs', () => {
  assert.equal(staticStatus({ planned: true }).status, STATUS.NOT_BUILT);
  assert.equal(staticStatus({ requires: ['a.ts'], spec: {} }, () => false).status, STATUS.NOT_BUILT);
  assert.equal(staticStatus({ requires: ['a.ts'], spec: {} }, () => true), null);
  assert.equal(staticStatus({ manual: 'do it' }).status, STATUS.MANUAL);
});

const report = (tests) => ({ suites: [{ specs: tests.map((t) => ({ file: t.file ?? 'x.spec.ts', title: t.title, tests: [{ projectName: t.project ?? 'desktop', status: t.status, annotations: t.annotations ?? [], results: [{ duration: 1000, error: t.error ? { message: t.error } : undefined }] }] })) }] });

test('a browser check passes only when it passed on every project it names', () => {
  const check = { spec: { file: 'tests/x.spec.ts', grep: 'works', projects: ['desktop', 'phone'] } };
  const rows = (items) => flattenPlaywright(report(items));
  assert.equal(browserStatus(check, rows([{ title: 'it works', status: 'expected' }, { title: 'it works', status: 'expected', project: 'phone' }])).status, STATUS.PASS);
  assert.equal(browserStatus(check, rows([{ title: 'it works', status: 'expected' }])).status, STATUS.NOT_RUN);
  assert.equal(browserStatus(check, rows([{ title: 'it works', status: 'unexpected', error: 'boom' }, { title: 'it works', status: 'expected', project: 'phone' }])).status, STATUS.FAIL);
  assert.equal(browserStatus(check, rows([{ title: 'other', status: 'expected' }])).status, STATUS.FAIL, 'a renamed test is a failure, not a quiet pass');
  const built = { spec: { file: 'tests/x.spec.ts', grep: 'works', projects: ['desktop'] } };
  assert.equal(browserStatus(built, rows([{ title: 'it works', status: 'skipped', annotations: [{ type: 'skip', description: 'NOT BUILT: later' }] }])).status, STATUS.NOT_BUILT);
});

test('a Node check reads TAP: pass, fail, and missing', () => {
  const check = { node: { file: 'f', grep: '\\[GP-04\\]' } };
  assert.equal(nodeStatus(check, 'ok 1 - [GP-04] fine').status, STATUS.PASS);
  assert.equal(nodeStatus(check, 'not ok 1 - [GP-04] bad').status, STATUS.FAIL);
  assert.equal(nodeStatus(check, 'ok 1 - other').status, STATUS.FAIL);
});

test('the score is weighted, and everything that does not pass counts against it', () => {
  const rows = [
    { status: STATUS.PASS, weight: 4 }, { status: STATUS.PASS, weight: 1 }, { status: STATUS.FAIL, weight: 3 },
    { status: STATUS.NOT_BUILT, weight: 5 }, { status: STATUS.MANUAL, weight: 2 }, { status: STATUS.NOT_RUN, weight: 5 },
  ];
  const s = score(rows);
  assert.equal(s.passed, 2);
  assert.equal(s.pct, 25);
  assert.equal(headline(s), '2 of 6 checks pass (25% weighted)');
  assert.equal(score([]).pct, 0);
});
