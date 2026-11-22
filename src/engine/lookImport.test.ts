import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLook, serializeLook } from './lookImport.ts';
import { LIFT_SUBJECT_BLUR_BACKGROUND, createCustomLook } from './looks.ts';

describe('serializeLook / parseLook', () => {
  it('round-trips a real Look losslessly', () => {
    const json = serializeLook(LIFT_SUBJECT_BLUR_BACKGROUND);
    const back = parseLook(json);
    assert.deepEqual(back, { ...LIFT_SUBJECT_BLUR_BACKGROUND, source: 'user' });
  });

  it('re-tags an imported Look as "user" no matter what the JSON claims', () => {
    const json = JSON.stringify({ ...createCustomLook('x', 'My look', 'desc', LIFT_SUBJECT_BLUR_BACKGROUND.steps), source: 'builtin' });
    assert.equal(parseLook(json)?.source, 'user');
  });

  it('rejects malformed JSON, not an exception', () => {
    assert.equal(parseLook('{not json'), null);
    assert.equal(parseLook('null'), null);
    assert.equal(parseLook('42'), null);
    assert.equal(parseLook('[]'), null);
  });

  it('rejects an unknown capability rather than silently running it as something else', () => {
    const bad = JSON.stringify({ id: 'x', name: 'x', description: '', steps: [{ label: 'x', capability: 'delete-everything', background: {} }] });
    assert.equal(parseLook(bad), null);
  });

  it('rejects a background/subject field outside the real PhotoEdit/LocalKey set', () => {
    const unknownKey = JSON.stringify({ id: 'x', name: 'x', description: '', steps: [{ label: 'x', capability: 'denoise', background: { exposure: 0.1, notARealField: 99 } }] });
    assert.equal(parseLook(unknownKey), null);
  });

  it('rejects an out-of-range numeric value', () => {
    const tooBig = JSON.stringify({ id: 'x', name: 'x', description: '', steps: [{ label: 'x', capability: 'denoise', background: { exposure: 500 } }] });
    assert.equal(parseLook(tooBig), null);
    const negativeDenoise = JSON.stringify({ id: 'x', name: 'x', description: '', steps: [{ label: 'x', capability: 'denoise', background: { denoise: -1 } }] });
    assert.equal(parseLook(negativeDenoise), null);
  });

  it('rejects too many steps, an empty step list, and an over-long name', () => {
    const oneStep = { label: 'x', capability: 'denoise' as const, background: {} };
    assert.equal(parseLook(JSON.stringify({ id: 'x', name: 'x', description: '', steps: [] })), null, 'no steps at all');
    assert.equal(parseLook(JSON.stringify({ id: 'x', name: 'x', description: '', steps: Array(9).fill(oneStep) })), null, 'more than 8 steps');
    assert.equal(parseLook(JSON.stringify({ id: 'x', name: 'x'.repeat(200), description: '', steps: [oneStep] })), null, 'name over 120 chars');
  });

  it('accepts a step with no subject field at all, and one with a valid subject edit', () => {
    const noSubject = JSON.stringify({ id: 'x', name: 'x', description: '', steps: [{ label: 'x', capability: 'denoise', background: { denoise: 0.5 } }] });
    assert.ok(parseLook(noSubject));
    const withSubject = JSON.stringify({ id: 'x', name: 'x', description: '', steps: [{ label: 'x', capability: 'denoise', background: { denoise: 0.5 }, subject: { clarity: 0.2 } }] });
    assert.ok(parseLook(withSubject));
  });
});
