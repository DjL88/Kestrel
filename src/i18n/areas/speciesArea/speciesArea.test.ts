import assert from 'node:assert/strict';
import test from 'node:test';
import { areaWords, regionWords, speciesAreaTextFor } from './index';
import { source } from './source';
import { speciesAreaLabelOf } from '../../../v2/engineClient/frameToPhoto';

const LANGUAGES = ['fr', 'de', 'es', 'nl', 'it', 'pt', 'da', 'sv', 'nb', 'fi', 'is', 'cy', 'gd', 'ga'] as const;

test('every language names every region and the place question in its own words', () => {
  for (const code of LANGUAGES) {
    const words = speciesAreaTextFor(code);
    for (const [id, english] of Object.entries(source.regions)) {
      const local = (words.regions as Record<string, string>)[id];
      assert.ok(local && local !== english || id === 'neotropics' && code === 'nl', `${code} ${id}`);
    }
    assert.notEqual(words.whereTaken, source.whereTaken, code);
    assert.notEqual(words.suggestionPrivacy, source.suggestionPrivacy, code);
    assert.ok(words.matchedIn('X').includes('X'), code);
  }
});

test('a place in words: a country by its local name, the whole world as Worldwide, several regions listed', () => {
  const de = speciesAreaTextFor('de');
  assert.equal(areaWords({ kind: 'country', code: 'VE' }, [], de, 'de'), 'Venezuela');
  assert.equal(areaWords({ kind: 'world' }, [], de, 'de'), 'Weltweit');
  assert.equal(areaWords({ kind: 'country', code: 'DE' }, [], de, 'fr'), 'Allemagne');
  const en = speciesAreaTextFor('en-GB');
  assert.equal(regionWords(['palearctic', 'neotropics'], en), 'Europe, North Africa and northern Asia, Central and South America');
  assert.equal(regionWords(['palearctic', 'nearctic', 'neotropics', 'afrotropics', 'oriental', 'australasia', 'oceans'], en), 'Worldwide');
  assert.equal(areaWords({ kind: 'home' }, ['palearctic'], en), 'Home region (Europe, North Africa and northern Asia)');
});

test('the place is shown beside the app\'s own name only, never beside the person\'s or on an older photo', () => {
  const area = { kind: 'regions' as const, ids: ['neotropics'] };
  assert.equal(speciesAreaLabelOf({ tags: ['Saffron Finch'], autoTags: ['Saffron Finch'], speciesArea: area }), 'Species list used: Central and South America');
  assert.equal(speciesAreaLabelOf({ tags: ['Saffron Finch'], autoTags: [], speciesArea: area }), undefined, 'kept by the person');
  assert.equal(speciesAreaLabelOf({ tags: ['Saffron Finch'], autoTags: ['Saffron Finch'], subjectNames: ['Saffron Finch'], speciesArea: area }), undefined);
  assert.equal(speciesAreaLabelOf({ tags: ['Saffron Finch'], autoTags: ['Saffron Finch'] }), undefined, 'older photo: not known');
});
