import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeEditStory, renderStorySlideSvg, storyTimeline, STORY_SIZES } from './editStories';

test('story exports have predictable social sizes and timeline', () => {
  const story = makeEditStory([
    { kind: 'original', title: 'Before', durationMs: 1000 },
    { kind: 'subject-mask', title: 'Subject', durationMs: 2500 },
    { kind: 'final', title: 'After' },
  ]);
  assert.deepEqual(STORY_SIZES.portrait, [1080, 1920]);
  assert.deepEqual(STORY_SIZES.square, [1080, 1080]);
  assert.deepEqual(storyTimeline(story).map(({ startMs, endMs }) => [startMs, endMs]),
    [[0, 1000], [1000, 3500], [3500, 6000]]);
});

test('static SVG escapes captions and embeds only local image data', () => {
  const story = makeEditStory([{ kind: 'final', title: '<Finished & safe>', details: 'Bird "mask"' }], 'square');
  const svg = renderStorySlideSvg(story, 0, 'data:image/png;base64,aGVsbG8=');
  assert.match(svg, /width="1080" height="1080"/);
  assert.match(svg, /&lt;Finished &amp; safe&gt;/);
  assert.match(svg, /Bird &quot;mask&quot;/);
  assert.doesNotMatch(svg, /<Finished & safe>/);
  for (const unsafe of ['https://example.com/photo.jpg', 'file:///private/raw.nef',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,WA==']) {
    assert.throws(() => renderStorySlideSvg(story, 0, unsafe));
  }
});

test('invalid story data cannot create an unbounded video timeline', () => {
  assert.throws(() => makeEditStory([]));
  assert.throws(() => makeEditStory(Array.from({ length: 25 }, () => ({ kind: 'final', title: 'x' }))));
  assert.throws(() => makeEditStory([{ kind: 'final', title: 'x', durationMs: Infinity }]));
  assert.throws(() => makeEditStory([{ kind: 'final', title: 'x', durationMs: 0 }]));
  assert.throws(() => makeEditStory([{ kind: 'invalid' as 'final', title: 'x' }]));
});
