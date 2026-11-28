import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_REVIEW_CONSENT_VERSION, type AiReview } from '../core/aiReview';
import { enhancePhoto } from '../core/enhanceLoop';
import { consentFor, type AiProviderSettings } from './aiProviders';
import { secondOpinionFromSettings } from './enhanceSecondOpinion';

const settings = (over: Partial<AiProviderSettings> = {}): AiProviderSettings => {
  const base = { kind: 'gemini', key: 'k', model: 'm', baseUrl: '' } as AiProviderSettings;
  return { ...base, ...over, consent: consentFor(AI_REVIEW_CONSENT_VERSION, { ...base, ...over }) } as AiProviderSettings;
};
const encode = async () => 'AAAA';
const answer = (issues: string[]): AiReview => ({ summary: 's', points: issues.map((issue) => ({ issue: issue as never, detail: 'd' })), suggestion: { exposure: 2 } });

const W = 200, H = 130;
const enc = (l: number) => Math.round(255 * Math.min(1, Math.max(0, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)));
function scene(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  let s = 5;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const b = (y < H * 0.45 ? 0.5 - 0.25 * (y / H) + 0.012 * rnd() : 0.14 + 0.02 * Math.sin(x / 8) * Math.sin(y / 6) + 0.006 * rnd()) * 0.4;
    const o = (y * W + x) * 4; px[o] = enc(b); px[o + 1] = enc(b * 0.97); px[o + 2] = enc(b * 0.93); px[o + 3] = 255;
  }
  return px;
}
const META = { evCompensation: -1, shutterSeconds: 1 / 2000, iso: 3200, aperture: 4 };

test('no provider, no consent or the owner\'s own helper kind: no second opinion is built', () => {
  assert.equal(secondOpinionFromSettings(null), null);
  assert.equal(secondOpinionFromSettings({ ...settings(), consent: '' } as AiProviderSettings), null);
  assert.equal(secondOpinionFromSettings(settings({ kind: 'inflight' })), null);
  assert.ok(secondOpinionFromSettings(settings()));
});

test('it sends only downsized previews through the existing provider code and reads only the issues named', async () => {
  const sent: string[] = [];
  const op = secondOpinionFromSettings(settings(), 'English', encode, async (_s, _v, _p, jpeg) => { sent.push(jpeg); return answer(['cast']); })!;
  const r = await op.ask({ rgba: new Uint8ClampedArray(16), width: 2, height: 2 }, [{ rgba: new Uint8ClampedArray(16), width: 2, height: 2 }]);
  assert.deepEqual(r, { concerns: [['cast']] });
  assert.deepEqual(sent, ['AAAA']);
});

test('a failing or silent provider changes nothing', async () => {
  const input = { pixels: scene(), width: W, height: H, meta: META, maxRounds: 3 };
  const plain = await enhancePhoto(input);
  const failing = await enhancePhoto({ ...input, secondOpinion: secondOpinionFromSettings(settings(), 'English', encode, async () => { throw new Error('offline'); }) });
  assert.equal(failing.secondOpinion, null);
  assert.equal(failing.favourite, plain.favourite);
  assert.deepEqual(failing.options.map((o) => o.edit), plain.options.map((o) => o.edit));
});

test('it is advisory: it can flag concerns and move the favourite, but never changes a recipe or a gate', async () => {
  const input = { pixels: scene(), width: W, height: H, meta: META, maxRounds: 3 };
  const plain = await enhancePhoto(input);
  const improved = plain.options.map((o, i) => ({ o, i })).filter(({ o }) => o.outcome === 'improved');
  assert.ok(improved.length >= 2, 'this scene gives at least two gated options to reorder between');
  // Complain about whichever option the loop chose first; leave the others clean.
  const op = secondOpinionFromSettings(settings(), 'English', encode, async (_s, _v, _p, _j) => answer([]))!;
  const asks: number[] = [];
  const wrapped = { ask: async (b: Parameters<typeof op.ask>[0], c: Parameters<typeof op.ask>[1]) => ({ concerns: c.map((_, k) => { asks.push(k); return k === improved.findIndex(({ i }) => i === plain.favourite) ? ['cast' as const] : []; }) }) };
  const r = await enhancePhoto({ ...input, secondOpinion: wrapped });
  assert.equal(r.secondOpinion?.movedFavourite, true);
  assert.equal(r.favouriteBy, 'second-opinion');
  assert.notEqual(r.favourite, plain.favourite);
  assert.deepEqual(r.options.map((o) => o.edit), plain.options.map((o) => o.edit), 'no recipe changed');
  assert.ok(r.options[r.favourite!].outcome === 'improved', 'only a gated option can become the favourite');
});
