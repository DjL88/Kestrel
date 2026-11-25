import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitDenoiseBySubject, subjectDenoiseMask, runDenoiseAction } from './denoiseAction.ts';
import type { Pixels } from '../core/colourCheck';
import type { SubjectGrid } from '../core/maskTypes';

function flat(size: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

const grid: SubjectGrid = { w: 1, h: 1, data: '' };

describe('splitDenoiseBySubject', () => {
  it('gives the subject a lower strength than the background by default', () => {
    const { background, subject } = splitDenoiseBySubject(1.5);
    assert.equal(background, 1.5);
    assert.ok(subject < background);
    assert.equal(subject, 0.6); // 1.5 * 0.4
  });

  it('clamps background to the real 0-2 PhotoEdit.denoise range', () => {
    assert.equal(splitDenoiseBySubject(5).background, 2);
    assert.equal(splitDenoiseBySubject(-1).background, 0);
  });

  it('a protection of 1 gives the subject the same strength as the background', () => {
    assert.deepEqual(splitDenoiseBySubject(1, 1), { background: 1, subject: 1 });
  });
});

describe('subjectDenoiseMask', () => {
  it('builds a real subject mask carrying its own denoise value', () => {
    const mask = subjectDenoiseMask('m1', grid, 'frame-1', 'high', 0.6);
    assert.equal(mask.kind, 'subject');
    assert.equal(mask.edit.denoise, 0.6);
    assert.equal(mask.id, 'm1');
  });
});

describe('runDenoiseAction', () => {
  it('accepts a result that passes verification on the first attempt', async () => {
    const original = flat(16, [120, 120, 120]);
    const render = async () => flat(16, [121, 121, 121]); // barely changed
    const result = await runDenoiseAction({ backgroundDenoise: 1, original, render });
    assert.equal(result.attempts, 1);
    assert.equal(result.verification.ok, true);
    assert.equal(result.edit.denoise, 1);
    assert.deepEqual(result.masks, []);
  });

  it('with a subject, keeps the original when no candidate reduces noise in any region (TrueDetail guardian)', async () => {
    const original = flat(16, [120, 120, 120]);
    const render = async () => flat(16, [121, 121, 121]);
    const result = await runDenoiseAction({
      backgroundDenoise: 1, original, render,
      subject: { maskId: 's1', grid, framingKey: 'f1', confidence: 'high', alpha: new Float32Array(16 * 16).fill(1) },
    });
    assert.deepEqual(result.masks, []);
    assert.deepEqual(result.edit, {});
    assert.equal(result.verification.ok, false);
    assert.ok(result.regions?.every(r => r.strength === 0 && r.kept));
  });

  it('retries at a reduced strength when the result over-smooths, then stops at maxRetries', async () => {
    let calls = 0;
    const original = flat(16, [120, 120, 120]);
    // Every render reports the same over-bright result, so verification never passes - proves it actually
    // retries (background strength only ever goes down) and stops rather than looping forever.
    const render = async () => { calls += 1; return flat(16, [250, 250, 250]); };
    const result = await runDenoiseAction({ backgroundDenoise: 1, original, render, maxRetries: 2 });
    assert.equal(calls, 3); // initial attempt + 2 retries
    assert.equal(result.attempts, 3);
    assert.equal(result.verification.ok, false);
    assert.deepEqual(result.edit, {});
    assert.deepEqual(result.masks, []);
  });
});

it('rejects every candidate that removes protected subject structure, and never accepts one that only looks smooth', async () => {
  const original = flat(64, [130,130,130]);
  for (let y=0;y<64;y++) for(let x=0;x<64;x++) {
    const i=(y*64+x)*4;
    original.data.fill(x%4<2?90:170,i,i+3);
  }
  const strengths:number[]=[];
  const result=await runDenoiseAction({
    original, backgroundDenoise: 1.6,
    subject:{maskId:'s',grid,framingKey:'f',confidence:'high',alpha:new Float32Array(4096).fill(1)},
    render:async (_edit,masks)=>{
      const strength=masks[1].edit.denoise!;
      strengths.push(strength);
      return strength>0.4?flat(64,[130,130,130]):original;
    },
  });
  assert.ok(strengths.some(s=>s>0.4) && strengths.some(s=>s<=0.4), 'both kinds of candidate were judged');
  assert.equal(result.verification.ok,false);
  assert.deepEqual(result.masks,[]);
  const subject=result.regions!.find(r=>r.region==='subject')!;
  assert.equal(subject.strength,0);
  assert.ok(subject.verdicts.some(v=>v.reason==='lost real detail'));
});

it('retries when the composed saved recipe fails its additional quality check', async () => {
  const original = flat(16, [120,120,120]);
  let calls = 0;
  const result = await runDenoiseAction({ original, backgroundDenoise: 1, render: async () => original,
    verifyCandidate: () => ++calls === 1
      ? { ok: false, reasons: ['Individual lost detail'], suggestedStrengthScale: 0.5 }
      : { ok: true, reasons: [], suggestedStrengthScale: 1 },
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.edit.denoise, 0.5);
});
it('cancellation after rendering prevents a verified recipe from escaping', async () => {
  const controller = new AbortController();
  const original = flat(16, [120,120,120]);
  await assert.rejects(runDenoiseAction({ original, backgroundDenoise: 1, signal: controller.signal,
    render: async () => { controller.abort(); return original; },
  }), /abort/i);
});
