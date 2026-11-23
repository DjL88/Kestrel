import test from 'node:test';
import assert from 'node:assert/strict';
import type { PhotoFrame } from '../../core/types';
import { addSavedEditGroup, readEditGroups, renameSavedEditGroup, selectSavedEditGroup, syncEditGroup } from './editGroupState';

function frame(): PhotoFrame {
  return { id: 'photo-a', stableKey: 'original-a', filename: 'test.jpg', sequenceIndex: 0,
    decision: 'unreviewed', edit: { exposure: 0.2 } } as PhotoFrame;
}

test('add, rename and select edit groups survive catalogue JSON roundtrip', () => {
  const original = frame();
  const added = addSavedEditGroup(original, 'group-second');
  assert.ok(added);
  assert.equal(readEditGroups(added).activeId, 'group-second');
  assert.equal(readEditGroups(added).groups.length, 2);
  const renamed = renameSavedEditGroup(added, 'group-second', '  Birds  ');
  assert.ok(renamed);
  assert.equal(readEditGroups(renamed).groups[1].name, 'Birds');
  const saved = JSON.parse(JSON.stringify(renamed)) as PhotoFrame;
  assert.equal(readEditGroups(saved).groups[1].name, 'Birds');
  assert.equal(readEditGroups(saved).activeId, 'group-second');
  assert.equal(readEditGroups(original).groups.length, 1);
});

test('switching groups preserves independently edited recipes and never alters identity', () => {
  const original = frame();
  const second = addSavedEditGroup(original, 'group-second')!;
  const editedSecond = syncEditGroup({ ...second, edit: { exposure: 1.1 } });
  const first = selectSavedEditGroup(editedSecond, 'group-primary')!;
  assert.equal(first.edit?.exposure, 0.2);
  const editedFirst = syncEditGroup({ ...first, edit: { exposure: -0.6 } });
  const restored = selectSavedEditGroup(editedFirst, 'group-second')!;
  assert.equal(restored.edit?.exposure, 1.1);
  assert.equal(selectSavedEditGroup(restored, 'group-primary')!.edit?.exposure, -0.6);
  assert.equal(restored.id, original.id);
  assert.equal(restored.stableKey, original.stableKey);
});

test('reject invalid IDs and names; malformed state fails closed', () => {
  const f = frame();
  assert.equal(addSavedEditGroup(f, '../../bad'), null);
  assert.equal(selectSavedEditGroup(f, 'missing'), null);
  assert.equal(renameSavedEditGroup(f, 'group-primary', ' '), null);
  assert.equal(renameSavedEditGroup(f, 'group-primary', 'a'.repeat(81)), null);
  const corrupted = { ...f, v2EditGroups: { activeId: 'missing', groups: [{ id: 'group-primary', name: 'Good' }] } };
  assert.deepEqual(readEditGroups(corrupted), readEditGroups(f));
});
