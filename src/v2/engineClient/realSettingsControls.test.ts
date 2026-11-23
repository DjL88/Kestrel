import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiProviderConfig } from '../ui/contract';
import { aiProviderControl, cacheCapControl } from './realSettingsControls';

const gemini: AiProviderConfig = {
  id: 'gemini',
  name: 'Google Gemini',
  description: 'Optional vision help',
  connected: true, // the design stub intentionally pretends this is linked
  modelLabel: 'Bring Your Own Key',
};
const local: AiProviderConfig = {
  id: 'local',
  name: 'Local',
  description: 'Built-in',
  connected: true,
  modelLabel: 'On-device',
};

test('a real workspace cannot present a mock AI connection as authenticated', () => {
  const real = aiProviderControl(gemini, true);
  assert.equal(real.connected, false);
  assert.equal(real.disabled, true);
  assert.equal(real.buttonText, 'Unavailable');
  assert.equal(real.modelLabel, 'Not connected in this workspace');
});

test('the sample workspace remains interactive; the real local engine is still built in', () => {
  const preview = aiProviderControl(gemini, false);
  assert.equal(preview.connected, true);
  assert.equal(preview.disabled, false);
  assert.equal(preview.buttonText, 'Disconnect');
  const realLocal = aiProviderControl(local, true);
  assert.equal(realLocal.connected, true);
  assert.equal(realLocal.disabled, true);
  assert.equal(realLocal.buttonText, 'Built-in');
});

test('a real cache limit cannot be changed in the UI until the store enforces it', () => {
  assert.equal(cacheCapControl(true).disabled, true);
  assert.match(cacheCapControl(true).description, /not yet enforced/);
  assert.equal(cacheCapControl(false).disabled, false);
});
