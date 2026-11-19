import assert from 'node:assert/strict';
import test from 'node:test';
import { LANGUAGES, activeLanguage, matchDeviceLanguage, mergeMessages, missingKeys, plural, resolveLanguage, setActiveLanguage, unknownKeys } from './locale';
import { formatProjectDate } from './formatDate';
import { formatCaptureDateTime } from './photoInfoText';
import { enGB } from '../i18n/en-GB';
import { TRANSLATIONS, type Messages } from '../i18n/messages';
import { AREAS } from '../i18n/areas';

test('only a saved, known choice changes the language; anything else is British English', () => {
  assert.equal(resolveLanguage('cy'), 'cy');
  assert.equal(resolveLanguage('en-US'), 'en-US');
  for (const value of [undefined, null, '', 'xx', 'EN-us', 'cy-GB', 42, {}]) assert.equal(resolveLanguage(value), 'en-GB');
});

test('a translation lays over British English, and untranslated or broken entries keep the source', () => {
  const source = { a: 'One', nested: { b: 'Two', c: 'Three' }, say: (n: string) => `Hello ${n}` };
  const merged = mergeMessages(source, { a: 'Un', nested: { b: '  ' }, say: (n: string) => `Bonjour ${n}` });
  assert.equal(merged.a, 'Un');
  assert.equal(merged.nested.b, 'Two', 'blank translations fall back');
  assert.equal(merged.nested.c, 'Three', 'missing translations fall back');
  assert.equal(merged.say('Sam'), 'Bonjour Sam');
  const wrongShape = mergeMessages(source, { a: (() => 'x') as never, nested: 'oops' as never });
  assert.equal(wrongShape.a, 'One');
  assert.equal(wrongShape.nested.c, 'Three');
});

test('every language in the list has a file, and no file has sentences the source lacks', () => {
  for (const { code } of LANGUAGES) {
    assert.ok(TRANSLATIONS[code], `${code} has no translation file`);
    assert.deepEqual(unknownKeys(enGB, TRANSLATIONS[code]), [], `${code} has keys the British English source lacks`);
  }
});

test('every non-English language covers every sentence (brand names may stay as they are)', () => {
  const allowedToStay = new Set(['settings.fontBrand']);
  for (const { code } of LANGUAGES.filter((language) => !language.code.startsWith('en'))) {
    assert.deepEqual(missingKeys(enGB, TRANSLATIONS[code]).filter((key) => !allowedToStay.has(key)), [], `${code} leaves sentences in English`);
    const merged = mergeMessages<Messages>(enGB, TRANSLATIONS[code]);
    assert.notEqual(merged.scanning('3', '9'), enGB.scanning('3', '9'));
    assert.ok(merged.scanning('3', '9').includes('3') && merged.scanning('3', '9').includes('9'), `${code} drops a number from scanning`);
    assert.ok(merged.settings.restartIn('X').includes('X'), `${code} drops the language name`);
  }
});

test('dates follow the chosen language: British by default, never the browser’s', () => {
  const when = Date.UTC(2026, 10, 19, 12);
  const before = activeLanguage();
  try {
    setActiveLanguage('en-GB');
    assert.equal(formatProjectDate(when), '19 Nov 2026');
    assert.match(formatCaptureDateTime(when), /^19 Nov 2026/);
    assert.doesNotMatch(formatCaptureDateTime(Date.UTC(2026, 10, 19, 20, 46)), /PM|AM/);
    setActiveLanguage('en-US');
    assert.equal(formatProjectDate(when), 'Nov 19, 2026');
  } finally {
    setActiveLanguage(before);
  }
});

test('the device language is matched to one Kestrel has, to offer at first run', () => {
  assert.equal(matchDeviceLanguage(['en-US']), 'en-US');
  assert.equal(matchDeviceLanguage(['en-AU', 'fr']), 'en-GB', 'other English goes to British English');
  assert.equal(matchDeviceLanguage(['fr-BE']), 'fr');
  assert.equal(matchDeviceLanguage(['pt-BR']), 'pt');
  assert.equal(matchDeviceLanguage(['nb-NO']), 'nb');
  assert.equal(matchDeviceLanguage(['no']), 'nb');
  assert.equal(matchDeviceLanguage(['nn-NO']), 'nb');
  assert.equal(matchDeviceLanguage(['sv_SE']), 'sv');
  assert.equal(matchDeviceLanguage(['cy-GB']), 'cy');
  assert.equal(matchDeviceLanguage(['ja-JP', 'da-DK']), 'da', 'the first language Kestrel has wins');
  assert.equal(matchDeviceLanguage(['ja-JP', 'zh']), undefined);
  assert.equal(matchDeviceLanguage([]), undefined);
  assert.equal(matchDeviceLanguage(undefined), undefined);
});

test('plural words follow the active language’s rules', () => {
  const before = activeLanguage();
  try {
    setActiveLanguage('en-GB');
    assert.equal(plural(1, { one: 'photo', other: 'photos' }), 'photo');
    assert.equal(plural(2, { one: 'photo', other: 'photos' }), 'photos');
    setActiveLanguage('cy');
    const welsh = { zero: 'llun (0)', one: 'llun', two: 'lun', few: 'llun (few)', many: 'llun (many)', other: 'llun' };
    assert.equal(plural(2, welsh), 'lun');
    assert.equal(plural(0, welsh), 'llun (0)');
    assert.equal(plural(5, { other: 'x' }), 'x', 'missing forms fall back to other');
  } finally {
    setActiveLanguage(before);
  }
});

test('every area of the app is complete in every non-English language, with nothing the source lacks', () => {
  for (const area of AREAS) {
    for (const { code } of LANGUAGES) {
      const translation = area.translations[code];
      assert.deepEqual(unknownKeys(area.source, translation), [], `${area.name}/${code} has keys the source lacks`);
      if (code.startsWith('en')) continue;
      assert.ok(translation, `${area.name} has no ${code} file`);
      assert.deepEqual(missingKeys(area.source, translation), [], `${area.name}/${code} leaves sentences in English`);
    }
  }
});
