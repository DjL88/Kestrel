import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoShootState } from './cullingEngine';
import { encodeProjectBackup, restoreProjectBackup } from './projectBackup';

test('portable backup retains valid whole-number keeper target after cold JSON restart', () => {
  const project = createDemoShootState(3);
  project.keeperTarget = 20;
  const bytes = new TextEncoder().encode(encodeProjectBackup(project));
  const reopened = restoreProjectBackup(new TextDecoder().decode(bytes), 'reopened', 1234);
  assert.equal(reopened.keeperTarget, 20);
  assert.equal(reopened.shoot.id, 'reopened');
  assert.equal(project.shoot.id !== reopened.shoot.id, true);
});

test('portable restore refuses fractional, nonpositive and out-of-range keeper targets without mutating live project', () => {
  const project = createDemoShootState(2);
  project.keeperTarget = 2;
  const valid = JSON.parse(encodeProjectBackup(project));
  for (const invalid of [0, -1, 0.5, 1.5, 20.25, 9999.5, 10000, null, '20']) {
    const damaged = structuredClone(valid);
    damaged.project.keeperTarget = invalid;
    assert.throws(
      () => restoreProjectBackup(JSON.stringify(damaged), 'restored'),
      /invalid catalogue data/,
      String(invalid),
    );
    assert.equal(project.keeperTarget, 2, 'rejected restore must not modify active project');
  }
});

test('valid upper-bound keeper target restores, while malformed backup cannot replace an existing project', () => {
  const project = createDemoShootState(1);
  project.keeperTarget = 9999;
  const saved = encodeProjectBackup(project);
  assert.equal(restoreProjectBackup(saved, 'copy').keeperTarget, 9999);
  const damaged = JSON.parse(saved);
  damaged.project.keeperTarget = 9998.75;
  assert.throws(() => restoreProjectBackup(JSON.stringify(damaged), 'copy'), /invalid catalogue data/);
  assert.equal(project.keeperTarget, 9999);
});
