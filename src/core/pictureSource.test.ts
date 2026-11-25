import assert from 'node:assert/strict';
import test from 'node:test';
import { isRawCodec, pictureProvenance } from './pictureSource';

test('a camera preview and a RAW develop are told apart, with the develop size', () => {
  assert.deepEqual(pictureProvenance('camera-preview', undefined), { kind: 'camera' });
  assert.deepEqual(pictureProvenance('raw-review', undefined), { kind: 'raw', size: 'screen' });
  assert.deepEqual(pictureProvenance('raw-full', 'other'), { kind: 'raw', size: 'full' });
});

test('Nikon HE and HE* are named only when the headers said so', () => {
  assert.deepEqual(pictureProvenance('raw-full', 'nikon-he'), { kind: 'raw', size: 'full', codec: 'nikon-he' });
  assert.deepEqual(pictureProvenance('camera-preview', 'nikon-he-star'), { kind: 'camera', codec: 'nikon-he-star' });
  assert.equal(pictureProvenance('raw-review', 'other')?.codec, undefined);
});

test('a JPEG or a picture with no recorded source gets no label', () => {
  assert.equal(pictureProvenance('original', 'nikon-he'), undefined);
  assert.equal(pictureProvenance(undefined, 'nikon-he'), undefined);
});

test('only known codecs are accepted from a saved project', () => {
  assert.ok(isRawCodec('nikon-he-star'));
  assert.ok(isRawCodec('other'));
  assert.equal(isRawCodec('nikon-he-plus'), false);
  assert.equal(isRawCodec(undefined), false);
});
