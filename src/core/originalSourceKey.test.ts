import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyOriginalKey, linkedPathIdentity, originalSourceKey } from './originalSourceKey';

const photo = { name: '_DSC0001.NEF', size: 32_000_000, lastModified: 1763568000000 };

test('browser imports and old catalogue identity remain byte-for-byte compatible', () => {
  const old = 'local-file://_DSC0001.NEF::32000000::1763568000000';
  assert.equal(legacyOriginalKey(photo), old);
  assert.equal(originalSourceKey(photo), old);
  assert.equal(originalSourceKey({ ...photo, path: undefined }), old);
});

test('same camera name, size and time from two folders never share a source key', () => {
  const a = originalSourceKey({ ...photo, path: 'D:\\Z8\\Morning\\_DSC0001.NEF' });
  const b = originalSourceKey({ ...photo, path: 'D:\\Z5II\\Evening\\_DSC0001.NEF' });
  assert.notEqual(a, b);
  assert.match(a, /^local-linked:\/\//);
  assert.equal(a.split('::').at(-2), String(photo.size));
  assert.equal(a.split('::').at(-1), String(photo.lastModified));
});

test('Windows slash differences and drive-letter case preserve identity without case-folding names', () => {
  const a = originalSourceKey({ ...photo, path: 'D:\\Birds\\_DSC0001.NEF' });
  const b = originalSourceKey({ ...photo, path: 'd:/Birds/_DSC0001.NEF' });
  assert.equal(a, b);
  const uncA = linkedPathIdentity('\\\\NAS\\Photos\\Birds\\bird.NEF');
  const uncB = linkedPathIdentity('//NAS/Photos/Birds/bird.NEF');
  assert.equal(uncA, uncB);
  assert.notEqual(linkedPathIdentity('//NAS/Photos/Bird.NEF'), linkedPathIdentity('//NAS/Photos/bird.NEF'),
    'a case-sensitive NAS may contain distinct originals');
});

test('case-sensitive Unix paths do not silently alias different originals', () => {
  assert.notEqual(linkedPathIdentity('/mnt/Birds/a.NEF'), linkedPathIdentity('/mnt/birds/a.NEF'));
  assert.notEqual(linkedPathIdentity('/mnt/a.NEF'), linkedPathIdentity('C:/mnt/a.NEF'));
});

test('500 different capture folders stay distinct with repeated DSLR names and metadata', () => {
  const keys = Array.from({ length: 500 }, (_, index) =>
    originalSourceKey({ ...photo, path: `E:/shoot-${index}/_DSC0001.NEF` }));
  assert.equal(new Set(keys).size, 500);
});

test('new linked metadata suffix remains available to the old rehydration parser', () => {
  const key = originalSourceKey({ ...photo, path: '//NAS/photos/Z8/_DSC0001.NEF' });
  assert.equal(Number(key.split('::').at(-2)), photo.size);
  assert.equal(Number(key.split('::').at(-1)), photo.lastModified);
});
