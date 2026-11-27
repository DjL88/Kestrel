import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readCloudHelp, saveCloudHelp } from './cloudHelpSettings';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('cloud help settings', () => {
  it('starts at when busy, and remembers a change', () => {
    const store = memory();
    assert.equal(readCloudHelp(store).denoise, 'when-busy');
    assert.equal(saveCloudHelp('denoise', 'off', store), 'off');
    assert.equal(readCloudHelp(store).denoise, 'off');
  });
  it('falls back to the default on damaged or failing storage', () => {
    assert.equal(readCloudHelp({ getItem: () => '{not json', setItem: () => {} }).denoise, 'when-busy');
    assert.equal(saveCloudHelp('denoise', 'always', { getItem: () => null, setItem: () => { throw new Error('full'); } }), 'when-busy');
  });
});
