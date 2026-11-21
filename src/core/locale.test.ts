import assert from 'node:assert/strict';
import test from 'node:test';
import { LANGUAGES, activeLanguage, matchDeviceLanguage, needsLanguageSetup, mergeMessages, missingKeys, plural, resolveLanguage, setActiveLanguage, unknownKeys } from './locale';
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

test('existing translated languages retain their original coverage; new draft languages fall back safely', () => {
  const allowedToStay = new Set(['settings.fontBrand', 'setup.welcome', 'setup.question', 'setup.detected', 'setup.continueIn', 'setup.keepSource', 'setup.later']);
  const previouslyTranslated = ['cy', 'gd', 'fr', 'de', 'es', 'nl', 'it', 'pt'];
  for (const code of previouslyTranslated) {
    assert.deepEqual(missingKeys(enGB, TRANSLATIONS[code as keyof typeof TRANSLATIONS])
      .filter((key) => !allowedToStay.has(key) && !['appearance.', 'adjustment.', 'quick.', 'photoInfo.'].some((prefix) => key.startsWith(prefix))), [], `${code} unexpectedly lost an existing translation`);
    const merged = mergeMessages<Messages>(enGB, TRANSLATIONS[code as keyof typeof TRANSLATIONS]);
    assert.ok(merged.scanning('3', '9').includes('3') && merged.scanning('3', '9').includes('9'), `${code} drops a scan count`);
  }
  for (const { code, status } of LANGUAGES) {
    const merged = mergeMessages<Messages>(enGB, TRANSLATIONS[code]);
    assert.ok(merged.setup.welcome.trim(), `${code} must have a readable first-run welcome`);
    assert.ok(merged.setup.continueIn('TEST').includes('TEST'), `${code} must preserve the chosen language name`);
    if (status === 'draft') assert.ok(merged.settings.draft.trim(), `${code} must disclose draft status`);
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

test('the device language is matched to one Kite44 has, to offer at first run', () => {
  assert.equal(matchDeviceLanguage(['en-US']), 'en-US');
  assert.equal(matchDeviceLanguage(['en-AU', 'fr']), 'en-AU', 'Australian English is a regional option');
  assert.equal(matchDeviceLanguage(['en-NZ']), 'en-NZ');
  assert.equal(matchDeviceLanguage(['en-CA']), 'en-CA');
  assert.equal(matchDeviceLanguage(['en-GB']), 'en-GB');
  assert.equal(matchDeviceLanguage(['en-IE']), 'en-GB', 'unsupported English region uses UK words');
  assert.equal(matchDeviceLanguage(['fr-CA']), 'fr-CA');
  assert.equal(matchDeviceLanguage(['fr-Latn-CA']), 'fr-CA', 'supports BCP47 script and region');
  assert.equal(matchDeviceLanguage(['fr-BE']), 'fr');
  assert.equal(matchDeviceLanguage(['pt-BR']), 'pt');
  assert.equal(matchDeviceLanguage(['nb-NO']), 'nb');
  assert.equal(matchDeviceLanguage(['no']), 'nb');
  assert.equal(matchDeviceLanguage(['nn-NO']), 'nb');
  assert.equal(matchDeviceLanguage(['sv_SE']), 'sv');
  assert.equal(matchDeviceLanguage(['cy-GB']), 'cy');
  assert.equal(matchDeviceLanguage(['ja-JP', 'da-DK']), 'da', 'the first language Kite44 has wins');
  assert.equal(matchDeviceLanguage(['ja-JP', 'zh']), undefined);
  assert.equal(matchDeviceLanguage([]), undefined);
  assert.equal(matchDeviceLanguage(undefined), undefined);
});

test('first launch asks for an explicit choice regardless of OS language; a saved choice wins', () => {
  for (const value of [undefined, null, '', 'unrecognised']) {
    assert.equal(needsLanguageSetup(value), true);
  }
  for (const value of ['en-GB', 'en-AU', 'en-NZ', 'fr-CA', 'cy']) {
    assert.equal(needsLanguageSetup(value), false, value);
  }
  assert.equal(resolveLanguage('fr-CA'), 'fr-CA');
  assert.equal(resolveLanguage('en-NZ'), 'en-NZ');
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

test('every area is complete in every full language; regional variants (en-AU, fr-CA…) may override only what differs', () => {
  for (const area of AREAS) {
    for (const { code } of LANGUAGES) {
      const translation = area.translations[code];
      assert.deepEqual(unknownKeys(area.source, translation), [], `${area.name}/${code} has keys the source lacks`);
      if (code.startsWith('en') || code.includes('-')) continue;
      assert.ok(translation, `${area.name} has no ${code} file`);
      assert.deepEqual(missingKeys(area.source, translation), [], `${area.name}/${code} leaves sentences in English`);
    }
  }
});

test('translations without a native speaker’s check are labelled as drafts', () => {
  for (const code of ['cy', 'gd', 'ga', 'fr', 'fr-CA', 'de', 'es', 'nl', 'it', 'pt', 'da', 'sv', 'nb', 'fi', 'is']) {
    assert.equal(LANGUAGES.find((item) => item.code === code)?.status, 'draft', code);
  }
});

test('all eight established translation drafts include every visible Settings layout label', () => {
  const sourceKeys = Object.keys(enGB.appearance);
  for (const code of ['cy', 'gd', 'fr', 'de', 'es', 'nl', 'it', 'pt'] as const) {
    const translated = TRANSLATIONS[code].appearance as Record<string, string> | undefined;
    assert.ok(translated, `${code}: appearance translation is missing`);
    for (const key of sourceKeys) {
      const value: unknown = translated?.[key];
      assert.equal(typeof value, 'string', `${code}: appearance.${key} is untranslated`);
      assert.ok((value as string).trim().length > 2, `${code}: appearance.${key} is empty`);
    }
    const merged = mergeMessages<Messages>(enGB, TRANSLATIONS[code]);
    assert.notEqual(merged.appearance.position, enGB.appearance.position,
      `${code}: the editing tools question must not appear in English`);
  }
});

test('Welsh Photo Info dynamic labels keep the number and the choice', () => {
  const welsh = mergeMessages<Messages>(enGB, TRANSLATIONS.cy);
  assert.match(welsh.photoInfo.burst('2', '10'), /2/);
  assert.match(welsh.photoInfo.burst('2', '10'), /10/);
  assert.match(welsh.photoInfo.batch('3'), /3/);
  assert.match(welsh.photoInfo.rateStars('5'), /5/);
  assert.match(welsh.quick.down(welsh.adjustment.colour), /Lliw/);
  assert.notEqual(welsh.photoInfo.title, enGB.photoInfo.title);
});
