import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync } from 'fflate';
import { makeEditStory } from '../core/editStories';
import { packageStoryCarousel } from './editStoryArchive';

const story = makeEditStory([
  { kind: 'original', title: 'Private /Users/me/Bird.NEF' },
  { kind: 'final', title: 'Final' },
]);

test('social carousel ZIP contains only ordered generic PNG names', async () => {
  const png = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1])], { type: 'image/png' });
  const result = await packageStoryCarousel(story, [png, png]);
  assert.equal(result.type, 'application/zip');
  const entries = unzipSync(new Uint8Array(await result.arrayBuffer()));
  assert.deepEqual(Object.keys(entries).sort(), ['slide-01.png', 'slide-02.png']);
  assert.deepEqual([...entries['slide-01.png'].slice(0, 8)], [137,80,78,71,13,10,26,10]);
  assert.doesNotMatch(Object.keys(entries).join(','), /Bird|Users|NEF/);
});

test('incomplete, empty and wrong-media slides fail without a partial archive', async () => {
  const png = new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1])], { type: 'image/png' });
  await assert.rejects(packageStoryCarousel(story, [png]));
  await assert.rejects(packageStoryCarousel(story, [png, new Blob([], { type: 'image/png' })]));
  await assert.rejects(packageStoryCarousel(story, [png, new Blob(['x'], { type: 'text/html' })]));
  await assert.rejects(packageStoryCarousel(story, [png, new Blob(['<script>bad</script>'], { type: 'image/png' })]));
  await assert.rejects(packageStoryCarousel(story, [png, new Blob([new Uint8Array([137,80,78,71])], { type: 'image/png' })]));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(packageStoryCarousel(story, [png, png], controller.signal));
});
