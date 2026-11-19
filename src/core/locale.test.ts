import assert from 'node:assert/strict';
import test from 'node:test';
import { LANGUAGES, activeLanguage, mergeMessages, missingKeys, resolveLanguage, setActiveLanguage, unknownKeys } from './locale';
import { formatProjectDate } from './formatDate';
import { formatCaptureDateTime } from './photoInfoText';
import { enGB } from '../i18n/en-GB';
import { TRANSLATIONS, type Messages } from '../i18n/messages';

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
