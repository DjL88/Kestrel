import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_SETTINGS, WIZARD_DEFAULTS, parseSettings, parseTarget } from './projectSettings';
import { createEmptyProject } from './projects';
import { encodeProjectBackup, restoreProjectBackup } from './projectBackup';

test('the wizard starts with both helpers on, and old projects keep them off', () => {
  assert.deepEqual(WIZARD_DEFAULTS, { autoCull: true, autoEdit: true });
  assert.deepEqual(parseSettings(undefined), LEGACY_SETTINGS);
  assert.deepEqual(parseSettings({ autoCull: true, autoEdit: 'yes' }), { autoCull: true, autoEdit: false });
  assert.deepEqual(parseSettings('nope'), LEGACY_SETTINGS);
});

test('the target accepts whole numbers from 1 to 9999 only', () => {
  assert.equal(parseTarget('50'), 50);
  assert.equal(parseTarget(' 120 '), 120);
  for (const bad of ['', '0', '10000', '-3', '2.5', 'fifty', '1e3']) assert.equal(parseTarget(bad), null, bad);
});

test('a new project carries its target and settings, and a backup keeps them', () => {
  const project = createEmptyProject('p', 'Wedding', { keeperTarget: 75, settings: { autoCull: true, autoEdit: false } });
  assert.equal(project.keeperTarget, 75);
  assert.deepEqual(project.settings, { autoCull: true, autoEdit: false });
  const restored = restoreProjectBackup(encodeProjectBackup(project), 'r');
  assert.equal(restored.keeperTarget, 75);
  assert.deepEqual(restored.settings, { autoCull: true, autoEdit: false });
});

test('a project made without options keeps the default target and no settings', () => {
  const project = createEmptyProject('p', 'Old style');
  assert.equal(project.settings, undefined);
});
