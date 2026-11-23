import assert from 'node:assert/strict';
import test from 'node:test';
import { photosEligibleForBackup, readBackupSelection, selectPhotosForBackup, stopBackingUpPhotos } from './cloudBackupSelection.ts';

const library = Array.from({ length: 100 }, (_, i) => ({ id: `photo-${i}` }));

test('new and corrupt libraries fail closed with zero uploads', () => {
  for (const value of [undefined, null, {}, { mode: 'selected' }, { mode: 'unknown' }, { mode: 'selected', photoIds: ['ok', '../\\u0000'] }]) {
    assert.deepEqual(photosEligibleForBackup(value, library), []);
  }
});

test('backing up one of 100 existing photos never includes the other 99', () => {
  const selection = selectPhotosForBackup({ mode: 'local-only' }, ['photo-3']);
  assert.deepEqual(selection, { mode: 'selected', photoIds: ['photo-3'] });
  assert.deepEqual(photosEligibleForBackup(selection, library), ['photo-3']);
  assert.deepEqual(photosEligibleForBackup(JSON.parse(JSON.stringify(selection)), library), ['photo-3']);
});

test('selection can grow and shrink without touching unselected photos', () => {
  const selection = selectPhotosForBackup({ mode: 'selected', photoIds: ['photo-3'] }, ['photo-3', 'photo-8', 'missing']);
  assert.deepEqual(photosEligibleForBackup(selection, library), ['photo-3', 'photo-8']);
  assert.deepEqual(photosEligibleForBackup(stopBackingUpPhotos(selection, ['photo-3']), library), ['photo-8']);
});

test('whole-library opt-in excludes removed photos and is not silently reset', () => {
  assert.deepEqual(photosEligibleForBackup({ mode: 'all' }, [{ id: 'a' }, { id: 'b', removedAt: 123 }]), ['a']);
  assert.deepEqual(selectPhotosForBackup({ mode: 'all' }, ['a']), { mode: 'all' });
});

test('unknown, invalid and duplicated stored IDs cannot expand scope', () => {
  assert.deepEqual(readBackupSelection({ mode: 'selected', photoIds: ['a', 'a'] }), { mode: 'selected', photoIds: ['a'] });
  assert.deepEqual(photosEligibleForBackup({ mode: 'selected', photoIds: ['not-here', 'a'] }, [{ id: 'a' }]), ['a']);
  assert.deepEqual(photosEligibleForBackup({ mode: 'selected', photoIds: ['a'] }, [{ id: 'a', removedAt: 1 }]), []);
});
