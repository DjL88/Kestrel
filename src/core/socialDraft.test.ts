import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSocialDraft } from './socialDraft';

test('makes an offline-only draft from explicitly shareable pet and project facts', () => {
  const draft = createSocialDraft({
    destination: 'instagram', shareableSubject: 'Coco', shareProjectTitle: true,
    projectTitle: 'Spring wildlife', approvedNote: 'First sunshine of the season.',
    approvedTags: ['Cats', 'Pet photography', '#CATS', 'Nature'],
  });
  assert.match(draft.copyText, /Coco, from Spring wildlife/);
  assert.match(draft.copyText, /First sunshine/);
  assert.deepEqual(draft.hashtags, ['#Cats', '#Petphotography', '#Nature']);
  assert.equal(draft.published, false);
  assert.equal(draft.requiresReview, true);
  assert.equal(draft.onlineUsed, false);
});

test('private project title is excluded unless specifically approved', () => {
  const source = { destination: 'instagram' as const, projectTitle: "Smith's Wedding", approvedTags: ['Wedding'] };
  const draft = createSocialDraft(source);
  assert.doesNotMatch(draft.copyText, /Smith/);
  assert.match(createSocialDraft({ ...source, shareProjectTitle: true }).caption, /Smith/);
});

test('automatic guesses never enter drafts: no model, OCR or EXIF parameters are accepted', () => {
  const draft = createSocialDraft({ destination: 'facebook' });
  assert.equal(draft.copyText, 'A photograph to share.');
  assert.deepEqual(draft.hashtags, []);
});

test('hashtags are bounded, deduplicated and cleaned', () => {
  const draft = createSocialDraft({
    destination: 'tiktok',
    approvedTags: ['#Robin', ' robin ', 'red-breast', '<script>', ' ', 'a', ...Array.from({ length: 20 }, (_, n) => 'tag' + n)],
  });
  assert.deepEqual(draft.hashtags.slice(0, 3), ['#Robin', '#redbreast', '#script']);
  assert.equal(draft.hashtags.length, 8);
  assert.doesNotMatch(draft.copyText, /[<>]/);
});

test('X copy stays under 280 characters including tags', () => {
  const draft = createSocialDraft({
    destination: 'x', approvedNote: 'B'.repeat(700),
    approvedTags: ['wildlife', 'photography', 'nature'],
  });
  assert.ok(draft.copyText.length <= 280);
});

test('the original input is untouched; text remains editable and no posting happens', () => {
  const tags = Object.freeze(['Robin', 'winter']);
  const source = Object.freeze({ destination: 'instagram' as const, approvedTags: tags, shareableSubject: 'Robin' });
  const draft = createSocialDraft(source);
  assert.deepEqual(source.approvedTags, ['Robin', 'winter']);
  assert.equal(draft.status, 'suggestion');
  assert.match(draft.caption, /Robin/);
});

test('unrecognised social destinations are refused', () => {
  assert.throws(() => createSocialDraft({ destination: 'not-a-platform' as 'instagram' }));
});
