import assert from 'node:assert/strict';
import test from 'node:test';
import { calmViewOn, calmViewPatch, parseSavedUi } from './uiSettings.ts';

test('saved interface choices are read, and anything unknown is ignored', () => {
  assert.deepEqual(parseSavedUi(null), { assistMode: undefined, settings: {} });
  assert.deepEqual(parseSavedUi('not json'), { settings: {} });
  const ui = parseSavedUi(JSON.stringify({ assistMode: 'autopilot', settings: { theme: 'light', hand: 'left', calmView: true, touchDensity: 'wide', language: 'xx', cvdGuidance: 'yes', defaultAssistMode: 'solo' } }));
  assert.equal(ui.assistMode, 'autopilot');
  assert.deepEqual(ui.settings, { theme: 'light', hand: 'left', calmView: true, calmMotion: true, calmBadges: true, calmHints: true, calmReadouts: true, defaultAssistMode: 'solo' });
});

test('a bad mode is dropped rather than trusted', () => {
  assert.equal(parseSavedUi(JSON.stringify({ assistMode: 'turbo' })).assistMode, undefined);
});

test('a Calm View record from before the split keeps everything it used to hide', () => {
  const ui = parseSavedUi(JSON.stringify({ settings: { calmView: true } }));
  assert.deepEqual(ui.settings, { calmView: true, calmMotion: true, calmBadges: true, calmHints: true, calmReadouts: true });
});

test('each Calm View part is kept as the person set it', () => {
  const ui = parseSavedUi(JSON.stringify({ settings: { calmView: true, calmMotion: true, calmBadges: false, calmHints: true, calmReadouts: false } }));
  assert.deepEqual(ui.settings, { calmView: true, calmMotion: true, calmBadges: false, calmHints: true, calmReadouts: false });
  assert.deepEqual(parseSavedUi(JSON.stringify({ settings: { calmMotion: 'yes' } })).settings, {});
});

test('the Calm View preset switches movement, badges and hints together, and leaves slider numbers alone', () => {
  assert.deepEqual(calmViewPatch(true), { calmView: true, calmMotion: true, calmBadges: true, calmHints: true });
  assert.deepEqual(calmViewPatch(false), { calmView: false, calmMotion: false, calmBadges: false, calmHints: false });
  assert.equal('calmReadouts' in calmViewPatch(true), false);
});

test('a record saved with Calm View off takes the new calmer defaults instead of being pinned to the old ones', () => {
  assert.deepEqual(parseSavedUi(JSON.stringify({ settings: { calmView: false } })).settings, { calmView: false });
});

test('Calm View shows as on only when movement, badges and hints are all quietened', () => {
  assert.equal(calmViewOn({ calmMotion: true, calmBadges: true, calmHints: true }), true);
  assert.equal(calmViewOn({ calmMotion: true, calmBadges: true, calmHints: false }), false);
});

test('Show advanced controls is remembered and a damaged value is ignored', () => {
  assert.equal(parseSavedUi(JSON.stringify({ settings: { advancedControls: true } })).settings.advancedControls, true);
  assert.equal(parseSavedUi(JSON.stringify({ settings: { advancedControls: 'yes' } })).settings.advancedControls, undefined);
});

test('Swipe to change photo is remembered, and anything but true or false is ignored', () => {
  assert.equal(parseSavedUi(JSON.stringify({ settings: { swipeBetweenPhotos: false } })).settings.swipeBetweenPhotos, false);
  assert.equal(parseSavedUi(JSON.stringify({ settings: { swipeBetweenPhotos: 'no' } })).settings.swipeBetweenPhotos, undefined);
});

test('Game controller is remembered once switched on, and anything but true or false is ignored', () => {
  assert.equal(parseSavedUi(JSON.stringify({ settings: { gamepadEnabled: true } })).settings.gamepadEnabled, true);
  assert.equal(parseSavedUi(JSON.stringify({ settings: { gamepadEnabled: 1 } })).settings.gamepadEnabled, undefined);
  assert.equal(parseSavedUi(JSON.stringify({ settings: {} })).settings.gamepadEnabled, undefined);
});

test('Macro pad keys off is remembered; anything but true or false is ignored, so pads stay on', () => {
  assert.equal(parseSavedUi(JSON.stringify({ settings: { padKeysEnabled: false } })).settings.padKeysEnabled, false);
  assert.equal(parseSavedUi(JSON.stringify({ settings: { padKeysEnabled: 0 } })).settings.padKeysEnabled, undefined);
});

test('focus mode for the filmstrip row is kept between sessions, and only a true or false is accepted', () => {
  assert.equal(parseSavedUi(JSON.stringify({ settings: { filmstripFocus: true } })).settings.filmstripFocus, true);
  assert.equal(parseSavedUi(JSON.stringify({ settings: { filmstripFocus: false } })).settings.filmstripFocus, false);
  assert.equal(parseSavedUi(JSON.stringify({ settings: { filmstripFocus: 'yes' } })).settings.filmstripFocus, undefined);
});
