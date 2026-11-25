import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestionSteps } from './frameToPhoto';

test('Co-pilot suggestions list their real slider steps in working order, including an added subject adjustment', () => {
  const steps = suggestionSteps({ exposure: 0, warmth: 0, colour: 0 }, {
    exposure: 0.2, warmth: 0.1, colour: 0, shadows: 0.4,
    masks: [{ id: 'm', kind: 'subject' } as never],
  });
  assert.deepEqual(steps.map((s) => s.label), ['Temperature', 'Exposure', 'Shadows', 'Local adjustments']);
  assert.deepEqual(steps.find((s) => s.label === 'Shadows'), { id: steps[2].id, label: 'Shadows', from: '0', to: '20' });
  assert.deepEqual(steps.at(-1)?.from, '0');
  assert.deepEqual(steps.at(-1)?.to, '1');
  assert.deepEqual(suggestionSteps({ exposure: 0, warmth: 0, colour: 0 }, { exposure: 0, warmth: 0, colour: 0 }), []);
});
