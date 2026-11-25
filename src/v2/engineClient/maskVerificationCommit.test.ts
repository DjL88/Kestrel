import test from 'node:test';
import assert from 'node:assert/strict';
import { createMask } from '../../core/maskTypes';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING } from '../../core/photoFraming';
import type { PhotoFrame } from '../../core/types';
import { addSavedEditGroup } from './editGroupState';
import { maskAdvice, maskVerificationKey } from './maskVerificationCommit';
import { toggleMask } from './maskOps';

const original = { ...createMask('radial', 'mask'), edit: { exposure: -1.5 } };
const source: PhotoFrame = { id: 'bird', stableKey: 'bird.nef', filename: 'bird.nef', sequenceIndex: 1,
  decision: 'unreviewed', burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
  edit: { ...DEFAULT_EDIT, masks: [original] } };

test('the verification key changes with project, original, framing, edit group and masks', () => {
  const key = maskVerificationKey('p', source);
  const group = addSavedEditGroup(source, 'other');
  assert.ok(group);
  for (const [project, frame] of [['another', source], ['p', { ...source, stableKey: 'other.nef' }],
    ['p', { ...source, framing: { ...DEFAULT_FRAMING, turns: 1 } }], ['p', group],
    ['p', { ...source, editVersions: { version: 1, activeId: 'other', versions: [] } }],
    ['p', { ...source, removedAt: 0 }], ['p', { ...source, edit: { ...source.edit!, masks: toggleMask(source.edit!.masks, 'mask') } }],
  ] as [string, PhotoFrame][]) assert.notEqual(maskVerificationKey(project, frame), key);
});

test('the mask check advises and never proposes a rewrite of the person\'s value', () => {
  assert.equal(maskAdvice({ ok: true, reasons: [], suggestedStrengthScale: 1 }), null);
  // A comparison the verifier could not make is not shown to the person.
  assert.equal(maskAdvice({ ok: false, reasons: ['The comparison could not be verified safely.'], suggestedStrengthScale: 0 }), null);
  const advice = maskAdvice({ ok: false, reasons: ['A clear cool colour cast.'], suggestedStrengthScale: 0.7 });
  assert.match(advice ?? '', /cool colour cast\. Your setting is kept/);
});
