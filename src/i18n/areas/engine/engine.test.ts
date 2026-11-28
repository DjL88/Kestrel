import assert from 'node:assert/strict';
import test from 'node:test';
import { LANGUAGES, missingKeys, unknownKeys } from '../../../core/locale';
import { localiseFor } from '../../localise';
import { engineArea } from './index';
import { source } from './source';
import { frameToPhoto } from '../../../v2/engineClient/frameToPhoto';
import type { PhotoFrame } from '../../../core/types';

/** Owner decision 10: what models and assistants report reaches the screen in the person's language. Drafts, not native-checked. */
test('every full language says every engine result, and no language adds keys the source lacks', () => {
  for (const { code } of LANGUAGES) {
    assert.deepEqual(unknownKeys(source, engineArea.translations[code]), [], `${code}: unknown keys`);
    if (code.startsWith('en') || code.includes('-')) continue;
    assert.deepEqual(missingKeys(source, engineArea.translations[code]), [], `${code}: engine results left in English`);
  }
});

test('names, counts and notes survive translation, and unknown stays unknown', () => {
  for (const { code } of LANGUAGES) {
    const t = localiseFor(source, engineArea.translations, code);
    assert.match(t.denoise.protected(3), /3/, `${code}: the subject count is lost`);
    assert.match(t.denoise.leftAsItWas('NOTE'), /NOTE/, `${code}: the reason is lost`);
    assert.match(t.deepReview.conflict('READING', 'DETECTOR'), /READING[\s\S]*DETECTOR/, `${code}: both readings must be shown`);
    assert.match(t.deepReview.suggested('LOOK', 'DESC'), /LOOK[\s\S]*DESC/, `${code}: the look is lost`);
    assert.match(t.auto.speciesReference('FEATURES'), /FEATURES/, `${code}: the reference is lost`);
    assert.ok(t.notMeasured.trim() && t.notRecorded.trim(), `${code}: unknown values must still say so`);
    for (const key of Object.keys(source.steps)) assert.ok(t.steps[key as keyof typeof source.steps].trim(), `${code}: step ${key} is empty`);
  }
});

test('the Info panel gets a subject kind in words and the plain name', () => {
  const frame = {
    id: 'f1', filename: 'IMG_1.JPG', stableKey: 'k', decision: 'undecided', exif: {},
    subjectKind: 'wildlife', tags: ['Red Kite'], autoTags: ['Red Kite'],
  } as unknown as PhotoFrame;
  const photo = frameToPhoto(frame, undefined);
  assert.equal(photo.category, source.subjectKinds.wildlife, 'the detector word "wildlife" is never shown as is');
  assert.equal(photo.speciesLabel, 'Red Kite');
  assert.equal(photo.speciesName, 'Red Kite');
});
