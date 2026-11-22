import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTokenizerOrThrow, reportedDeviceMemoryBytes, deviceRamBytesForInstall, deviceLikelyTooSmall,
  ASSUMED_RAM_BYTES_WHEN_UNKNOWN, OBSERVED_PEAK_RAM_BYTES,
} from './photoCheckSmokeTest.ts';

function validTokenizerBytes(overrides: Record<string, unknown> = {}): Uint8Array {
  const json = {
    model: { vocab: { a: 0, b: 1 }, merges: [] },
    added_tokens: [{ id: 2, content: '<image>' }, { id: 3, content: '<end_of_utterance>' }],
    ...overrides,
  };
  return new TextEncoder().encode(JSON.stringify(json));
}

describe('parseTokenizerOrThrow', () => {
  it('accepts a well-formed tokenizer with both required special tokens', () => {
    const parsed = parseTokenizerOrThrow(validTokenizerBytes());
    assert.equal(parsed.added_tokens.length, 2);
  });

  it('rejects bytes that are not valid JSON', () => {
    assert.throws(() => parseTokenizerOrThrow(new TextEncoder().encode('{not json')), /valid JSON/);
  });

  it('rejects JSON missing the model/added_tokens structure', () => {
    assert.throws(() => parseTokenizerOrThrow(new TextEncoder().encode(JSON.stringify({ foo: 1 }))), /model\/added_tokens/);
  });

  it('rejects a tokenizer with no added tokens at all', () => {
    assert.throws(() => parseTokenizerOrThrow(validTokenizerBytes({ added_tokens: [] })), /no added/);
  });

  it('rejects a tokenizer missing the <image> special token the runtime requires', () => {
    assert.throws(
      () => parseTokenizerOrThrow(validTokenizerBytes({ added_tokens: [{ id: 3, content: '<end_of_utterance>' }] })),
      /Missing special token <image>/,
    );
  });

  it('rejects a tokenizer missing its vocabulary', () => {
    assert.throws(() => parseTokenizerOrThrow(validTokenizerBytes({ model: { merges: [] } })), /vocabulary or merge/);
  });
});

describe('reportedDeviceMemoryBytes', () => {
  it('converts navigator.deviceMemory GiB to bytes', () => {
    assert.equal(reportedDeviceMemoryBytes({ deviceMemory: 4 }), 4 * 1_073_741_824);
  });

  it('is null when the browser does not report it, or reports something unusable', () => {
    assert.equal(reportedDeviceMemoryBytes(undefined), null);
    assert.equal(reportedDeviceMemoryBytes({}), null);
    assert.equal(reportedDeviceMemoryBytes({ deviceMemory: 0 }), null);
    assert.equal(reportedDeviceMemoryBytes({ deviceMemory: Number.NaN }), null);
  });
});

describe('deviceRamBytesForInstall / deviceLikelyTooSmall', () => {
  it('uses the real reported figure when available', () => {
    assert.equal(deviceRamBytesForInstall({ deviceMemory: 8 }), 8 * 1_073_741_824);
  });

  it('falls back to the conservative assumed default, never the old flat 8 GiB, when unknown', () => {
    assert.equal(deviceRamBytesForInstall(undefined), ASSUMED_RAM_BYTES_WHEN_UNKNOWN);
    assert.ok(ASSUMED_RAM_BYTES_WHEN_UNKNOWN < 8 * 1_073_741_824);
  });

  it('flags a device as too small when its figure is below the observed peak', () => {
    assert.equal(deviceLikelyTooSmall({ deviceMemory: 1 }), true);
    assert.equal(deviceLikelyTooSmall({ deviceMemory: 8 }), false);
    assert.ok(OBSERVED_PEAK_RAM_BYTES > 0);
  });
});
