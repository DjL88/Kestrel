import assert from 'node:assert/strict';
import test from 'node:test';
import { commonSocialSizes, uniqueRenderedSocialFormats } from './exportSocialGroups';
import { EXPORT_FORMATS, formatById } from './exportFormats';

test('shared 4:5 and 9:16 social exports have a single canonical output and all matching icons', () => {
  const groups = commonSocialSizes();
  const post = groups.find(group => group.ids.includes('ig-45'))!;
  const story = groups.find(group => group.ids.includes('ig-story'))!;
  assert.deepEqual(post.ids, ['ig-45', 'fb-45', 'tt-45']);
  assert.deepEqual(post.platforms, ['instagram', 'facebook', 'tiktok']);
  assert.deepEqual(story.ids, ['ig-story', 'fb-story', 'tt-story']);
  assert.deepEqual(story.platforms, ['instagram', 'facebook', 'tiktok']);
});

test('same ratio at different pixel dimensions is not an identical size', () => {
  const groups = commonSocialSizes();
  assert.notEqual(groups.find(x => x.ids.includes('ig-34')), groups.find(x => x.ids.includes('th-34')));
  assert.ok(!groups.find(x => x.ids.includes('ig-11'))!.ids.includes('x-11'), 'X has an explicit file-size limit');
});

test('legacy selected aliases render only one physical file, except differing crops', () => {
  const formats = ['fb-45', 'ig-45', 'tt-45', 'ig-story', 'fb-story', 'master']
    .map(id => formatById(id)!);
  assert.deepEqual(uniqueRenderedSocialFormats(formats).map(x => x.id), ['fb-45', 'ig-story', 'master']);
  assert.deepEqual(uniqueRenderedSocialFormats(formats, x => x.id).map(x => x.id), formats.map(x => x.id));
});

test('an altered encoding, fit or dimensions must remain distinct', () => {
  const base = EXPORT_FORMATS.find(x => x.id === 'ig-45')!;
  const variants = [
    base, { ...base, id: 'different-fit', fit: 'bars' as const },
    { ...base, id: 'higher-quality', quality: 0.8 },
    { ...base, id: 'different-size', height: 1200 },
    { ...base, id: 'different-limit', maxBytes: 5_000_000 },
  ];
  assert.equal(uniqueRenderedSocialFormats(variants).length, 5);
});
