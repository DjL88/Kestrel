import assert from 'node:assert/strict';
import test from 'node:test';
import type { Photo } from '../contract';
import { autoBannerModel, LEFT_ALONE_MS } from './autoBannerModel';

type History = NonNullable<Photo['editHistory']>;
const photo = (history?: History) => ({ id: 'p1', ...(history ? { editHistory: history } : {}) }) as Pick<Photo, 'id' | 'editHistory'>;
const autoStep = { label: 'Auto', at: 1000, by: 'auto' as const,
  changes: [{ label: 'Exposure', from: '0.00 EV', to: '+0.30 EV' }, { label: 'Temperature', from: '0', to: '+4' }],
  why: ['The photo is on the dark side, so exposure goes up a little.', 'The light is cool.'] };

test('after Auto changed a photo the banner names each change and the reasons', () => {
  const model = autoBannerModel(photo({ steps: [autoStep], cursor: 1 }), undefined, 2000);
  assert.deepEqual(model, { kind: 'applied', at: 1000, who: 'auto', changes: ['Exposure +0.30 EV', 'Temperature +4'], why: autoStep.why });
});

test('the banner says who made the change when the status is for that very step', () => {
  const status = { photoId: 'p1', state: 'applied' as const, text: '', mode: 'copilot' as const, appliedAt: 1000, at: 1000 };
  const mine = autoBannerModel(photo({ steps: [autoStep], cursor: 1 }), status, 2000);
  assert.equal(mine?.kind === 'applied' && mine.who, 'copilot');
  const stale = { ...status, appliedAt: 999 };
  const model = autoBannerModel(photo({ steps: [autoStep], cursor: 1 }), stale, 2000);
  assert.equal(model?.kind === 'applied' && model.who, 'auto', 'a status for another step is not claimed');
});

test('a change from a non-zero start shows from and to, so it is not mistaken for the amount', () => {
  const step = { ...autoStep, changes: [{ label: 'Exposure', from: '+1.00 EV', to: '+1.30 EV' }] };
  const model = autoBannerModel(photo({ steps: [step], cursor: 1 }), undefined, 2000);
  assert.deepEqual(model?.kind === 'applied' && model.changes, ['Exposure +1.00 EV → +1.30 EV']);
});

test('Undo takes the banner away, Redo brings it back, and a later edit by the person replaces it', () => {
  assert.equal(autoBannerModel(photo({ steps: [autoStep], cursor: 0 }), undefined, 2000), null);
  assert.equal(autoBannerModel(photo({ steps: [autoStep], cursor: 1 }), undefined, 2000)?.kind, 'applied');
  assert.equal(autoBannerModel(photo({ steps: [autoStep, { label: 'Warmth', at: 1500 }], cursor: 2 }), undefined, 2000), null);
});

test('a dismissed banner stays dismissed for that step only', () => {
  const history = { steps: [autoStep], cursor: 1 };
  assert.equal(autoBannerModel(photo(history), undefined, 2000, new Set(['p1:1000'])), null);
  assert.equal(autoBannerModel(photo({ steps: [autoStep, { ...autoStep, at: 3000 }], cursor: 2 }), undefined, 4000, new Set(['p1:1000']))?.kind, 'applied');
});

test('"left alone" shows briefly after an automatic check, and not for the button or for another photo', () => {
  const status = { photoId: 'p1', state: 'unchanged' as const, text: 'Looked good, left alone.', mode: 'autopilot' as const, at: 5000 };
  assert.deepEqual(autoBannerModel(photo(), status, 5000 + 100), { kind: 'left-alone', text: 'Looked good, left alone.' });
  assert.equal(autoBannerModel(photo(), status, 5000 + LEFT_ALONE_MS + 1), null, 'transient');
  assert.equal(autoBannerModel(photo(), { ...status, mode: undefined }, 5100), null, 'the button answers in its own line');
  assert.equal(autoBannerModel(photo(), { ...status, photoId: 'other' }, 5100), null);
});

test('an Auto edit from before this session is not announced again, and one from this session is', () => {
  const history = { steps: [autoStep], cursor: 1 };
  assert.equal(autoBannerModel(photo(history), undefined, 5000, new Set(), 2000), null, 'made at 1000, session began at 2000');
  assert.equal(autoBannerModel(photo(history), undefined, 5000, new Set(), 1000)?.kind, 'applied');
});

test('an applied banner is never replaced by "left alone"', () => {
  const status = { photoId: 'p1', state: 'unchanged' as const, text: 'Looked good, left alone.', mode: 'autopilot' as const, at: 5000 };
  assert.equal(autoBannerModel(photo({ steps: [autoStep], cursor: 1 }), status, 5100)?.kind, 'applied');
});
