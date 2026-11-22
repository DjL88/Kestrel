import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceFontOption, FAVOURITE_FONTS, mergeFonts, normaliseFontNames } from './fonts.ts';

test('there are about ten favourite fonts, each with a distinct id and label', () => {
  assert.ok(FAVOURITE_FONTS.length >= 10 && FAVOURITE_FONTS.length <= 12);
  assert.equal(new Set(FAVOURITE_FONTS.map((font) => font.id)).size, FAVOURITE_FONTS.length);
  assert.equal(new Set(FAVOURITE_FONTS.map((font) => font.label)).size, FAVOURITE_FONTS.length);
});

test('device font names are tidied: trimmed, de-duplicated ignoring case, sorted', () => {
  assert.deepEqual(normaliseFontNames(['  Futura ', 'avenir  next', 'Avenir Next', '', 'Baskerville']), ['avenir next', 'Baskerville', 'Futura']);
});

test('a device font is marked as a device font and quotes its name safely', () => {
  const font = deviceFontOption('Gill "Sans"');
  assert.equal(font.isDevice, true);
  assert.equal(font.category, 'Custom');
  assert.ok(!font.family.slice(1, -1).split('"')[0].includes('"'));
  assert.match(font.id, /^device-gill-sans/);
});

test('favourites come first and a device font that is already a favourite is not repeated', () => {
  const merged = mergeFonts(['Lora', 'Futura']);
  assert.deepEqual(merged.slice(0, FAVOURITE_FONTS.length).map((font) => font.id), FAVOURITE_FONTS.map((font) => font.id));
  assert.equal(merged.filter((font) => font.label.toLowerCase() === 'lora').length, 1);
  assert.equal(merged.at(-1)?.label, 'Futura');
});
