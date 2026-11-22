import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeDenoiseUpload, encodeMaskUpload, encodeResult, decodeUpload, decodeResult,
} from './cloudJobCodec.ts';
import type { Pixels } from '../core/colourCheck';
import type { Mask } from '../core/maskTypes';

function flat(width: number, height: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return { data, width, height };
}

const radial = (id: string, edit: Mask['edit'] = {}): Mask =>
  ({ kind: 'radial', id, invert: false, feather: 0.3, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, edit });

describe('cloud job codec - denoise upload', () => {
  it('round-trips the original image and denoise strengths, with no subject alpha plane when none is given', () => {
    const original = flat(4, 3, [10, 20, 30]);
    const bytes = encodeDenoiseUpload(original, 0.8, 0.3);
    const decoded = decodeUpload(bytes);
    assert.equal(decoded.header.capability, 'denoise');
    assert.equal(decoded.header.backgroundDenoise, 0.8);
    assert.equal(decoded.header.subjectDenoise, 0.3);
    assert.equal(decoded.header.hasSubjectAlpha, false);
    assert.equal(decoded.subjectAlpha, undefined);
    assert.deepEqual([...decoded.original.data], [...original.data]);
    assert.equal(decoded.original.width, 4);
    assert.equal(decoded.original.height, 3);
  });

  it('round-trips a subject alpha plane alongside the image', () => {
    const original = flat(2, 2, [1, 2, 3]);
    const alpha = new Float32Array([0, 0.5, 1, 0.25]);
    const bytes = encodeDenoiseUpload(original, 1, 0.4, alpha);
    const decoded = decodeUpload(bytes);
    assert.equal(decoded.header.hasSubjectAlpha, true);
    assert.deepEqual([...decoded.subjectAlpha!], [...alpha]);
  });

  it('refuses an original whose pixel buffer does not match its declared width/height', () => {
    const bad: Pixels = { data: new Uint8ClampedArray(10), width: 4, height: 4 };
    assert.throws(() => encodeDenoiseUpload(bad, 1));
  });

  it('refuses a subject alpha whose length does not match the image', () => {
    const original = flat(2, 2, [0, 0, 0]);
    assert.throws(() => encodeDenoiseUpload(original, 1, 0.5, new Float32Array([1, 2, 3])));
  });
});

describe('cloud job codec - mask upload', () => {
  it('round-trips the original image and the masks exactly as given, with no re-derivation', () => {
    const original = flat(3, 2, [5, 6, 7]);
    const masks = [radial('sky', { exposure: -0.4 }), { ...radial('subject-1'), limit: { id: 'sky', mode: 'subtract' as const } }];
    const bytes = encodeMaskUpload(original, masks);
    const decoded = decodeUpload(bytes);
    assert.equal(decoded.header.capability, 'mask');
    assert.deepEqual(decoded.header.masks, masks);
    assert.deepEqual([...decoded.original.data], [...original.data]);
  });
});

describe('cloud job codec - result', () => {
  it('round-trips a processed picture', () => {
    const picture = flat(5, 4, [200, 150, 100]);
    const bytes = encodeResult('denoise', picture);
    const decoded = decodeResult(bytes);
    assert.equal(decoded.header.capability, 'denoise');
    assert.equal(decoded.header.width, 5);
    assert.equal(decoded.header.height, 4);
    assert.deepEqual([...decoded.picture.data], [...picture.data]);
  });

  it('refuses a truncated result rather than returning a partial picture', () => {
    const picture = flat(4, 4, [1, 1, 1]);
    const bytes = encodeResult('mask', picture);
    assert.throws(() => decodeResult(bytes.slice(0, bytes.length - 10)));
  });

  it('refuses a result from an unknown protocol version', () => {
    const picture = flat(2, 2, [9, 9, 9]);
    const bytes = encodeResult('denoise', picture);
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
    const text = new TextDecoder().decode(bytes.subarray(4, 4 + headerLength));
    const tampered = JSON.parse(text);
    tampered.protocol = 99;
    const headerBytes = new TextEncoder().encode(JSON.stringify(tampered));
    const headerLen = new Uint8Array(4);
    new DataView(headerLen.buffer).setUint32(0, headerBytes.length, false);
    const rest = bytes.subarray(4 + headerLength);
    const rebuilt = new Uint8Array(4 + headerBytes.length + rest.length);
    rebuilt.set(headerLen, 0);
    rebuilt.set(headerBytes, 4);
    rebuilt.set(rest, 4 + headerBytes.length);
    assert.throws(() => decodeResult(rebuilt), /protocol version/);
  });
});
