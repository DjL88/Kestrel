import assert from 'node:assert/strict';
import test from 'node:test';
import { LANGUAGES, missingKeys, unknownKeys } from '../../../core/locale';
import { localiseFor } from '../../localise';
import { v2Area } from './index';
import { source } from './source';

/**
 * Every supported language can render V2 with a British English fallback. Completeness is enforced separately: v2Area is
 * registered in AREAS, so `src/core/locale.test.ts` fails if any full language leaves a V2 phrase in English. This is
 * not a native-review gate; every non-English V2 file is a draft.
 */
test('V2 stays in the shared translation system with a British English fallback', () => {
  assert.equal(v2Area.name, 'v2');
  assert.equal(v2Area.source, source);
  for (const { code } of LANGUAGES) {
    const translated = v2Area.translations[code];
    assert.deepEqual(unknownKeys(source, translated), [], `${code}: unknown V2 translation keys`);
    const words = localiseFor(source, v2Area.translations, code);
    assert.equal(words.brandName, 'InFlight');
    assert.ok(words.topBar.fileMenu.trim(), `${code}: File menu must have readable text`);
    assert.ok(words.hub.modalCreate.trim(), `${code}: create button must have readable text`);
    assert.ok(words.settings.tabs.language.trim(), `${code}: language selector must remain accessible`);
    assert.ok(words.canvas.reconnectOriginal.trim(), `${code}: reconnect action must remain readable`);
  }
});

test('V2 dynamic messages preserve counts, dimensions and screen-reader compare values', () => {
  for (const { code } of LANGUAGES) {
    const words = localiseFor(source, v2Area.translations, code);
    assert.match(words.hub.photosCount(7), /7/, `${code}: photo count lost`);
    assert.match(words.filmstrip.selectedCount(5), /5/, `${code}: selection count lost`);
    assert.match(words.canvas.sizeCapped(1920, 1080), /1920/, `${code}: width lost`);
    assert.match(words.canvas.sizeCapped(1920, 1080), /1080/, `${code}: height lost`);
    assert.match(words.canvas.compareSplitValue(35), /35/, `${code}: original percentage lost`);
    assert.match(words.canvas.compareSplitValue(35), /65/, `${code}: edited percentage lost`);
  }
});

test('export translations preserve frame counts and the names of canvas overlays', () => {
  for (const { code } of LANGUAGES) {
    const words = localiseFor(source, v2Area.translations, code);
    const dialog = words.exportDialog;
    const overlays = new Intl.ListFormat(code).format([dialog.overlayText, dialog.overlayWatermark]);
    assert.ok(dialog.overlaysAsOnCanvas(overlays).includes(overlays), `${code}: canvas overlay names lost`);
    assert.match(dialog.frameFiles(5), /5/, `${code}: export frame count lost`);
    if (!code.startsWith('en') && !code.includes('-')) {
      const missing = missingKeys(source.exportDialog, v2Area.translations[code]?.exportDialog);
      assert.deepEqual(missing, [], `${code}: export phrases left in English`);
    }
  }
});

test('Calm View, split-frame and white-balance controls are translated in every full language', () => {
  const splitKeys = ['splitFrameAddMore', 'splitFrameDelete', 'splitFrameSelect', 'splitResizeHandle'] as const;
  for (const { code } of LANGUAGES) {
    const words = localiseFor(source, v2Area.translations, code);
    assert.match(words.canvas.splitFrameAddMore(5), /5/, `${code}: next frame count lost`);
    assert.match(words.canvas.splitFrameDelete(2, 5), /2.*4/, `${code}: removed or remaining frame count lost`);
    assert.match(words.canvas.splitFrameSelect(3, 5), /3.*5/, `${code}: frame position lost`);
    assert.match(words.adjust.kelvin.asShot, /\{k\}/, `${code}: as-shot temperature placeholder lost`);
    if (!code.startsWith('en') && !code.includes('-')) {
      const translated = v2Area.translations[code];
      assert.deepEqual(missingKeys(source.settings.appearance, translated?.settings?.appearance), [], `${code}: appearance phrases missing`);
      assert.deepEqual(missingKeys(source.adjust.kelvin, translated?.adjust?.kelvin), [], `${code}: white-balance phrases missing`);
      for (const key of splitKeys) assert.ok(translated?.canvas?.[key], `${code}: ${key} missing`);
    }
  }
});

test('collage and tone-curve translations preserve accessible names and values', () => {
  for (const { code } of LANGUAGES) {
    const { adjust, collage } = localiseFor(source, v2Area.translations, code);
    const frame = collage.windowLabel(3, 'DSC_7812.NEF');
    assert.match(frame, /3/, `${code}: window number lost`);
    assert.match(frame, /DSC_7812\.NEF/, `${code}: filename lost`);
    assert.match(collage.emptyWindowLabel(5), /5/, `${code}: empty window number lost`);
    assert.match(collage.placedCount(2, 4), /2.*4/, `${code}: partial placement counts lost`);
    assert.match(collage.placedCount(4, 4), /4/, `${code}: full placement count lost`);
    assert.match(adjust.curve.pointValue, /\{x\}.*\{y\}/, `${code}: curve coordinates lost`);
  }
});

test('every full language translates every V2 phrase', () => {
  for (const { code } of LANGUAGES) {
    if (code.startsWith('en') || code.includes('-')) continue;
    assert.deepEqual(missingKeys(source, v2Area.translations[code]), [], `${code}: V2 phrases left in English`);
  }
});
