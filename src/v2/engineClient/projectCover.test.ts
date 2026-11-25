import test from 'node:test';
import assert from 'node:assert/strict';
import { hubPreviewKey, projectCoverBlob, projectPreviewBlobs } from './projectCover';
import type { PhotoFrame } from '../../core/types';
const photo = (id: string, decision: PhotoFrame['decision'] = 'keep'): PhotoFrame => ({
  id, stableKey:'local-file://'+id+'.NEF::500::100',filename:id+'.NEF',sequenceIndex:1,decision,
  burstGroupId:null,burstIndex:0,burstCount:1,exif:{},isDemo:false,sourceKind:'file',
});
test('a failed keeper thumbnail lookup still allows an available unreviewed cover', async () => {
  const frames = [...Array.from({length:20},(_,i)=>photo('keeper'+i)),photo('available','unreviewed')];
  const thumbnail = new Blob(['cached'],{type:'image/jpeg'});
  let reads=0;
  const cover=await projectCoverBlob(frames,async key=>{
    reads++;
    if (key.includes('available.NEF')) return thumbnail;
    throw Error('cache unavailable');
  });
  assert.equal(cover,thumbnail);
  assert.ok(reads<=12);
});
test('an available keeper remains preferred and removed photos cannot be covers',async()=>{
  const frames=[{...photo('removed'),removedAt:0},photo('other','unreviewed'),photo('keeper')];
  const thumbnail=new Blob(['cached'],{type:'image/jpeg'});
  const read:string[]=[];
  assert.equal(await projectCoverBlob(frames,async key=>{read.push(key);return thumbnail;}),thumbnail);
  assert.equal(read.length,1);
  assert.ok(read[0].includes('keeper.NEF'));
});

test('favourite ratings choose the project cover before lower-rated keepers', async () => {
  const frames = [{...photo('low'), rating: 1}, {...photo('top'), rating: 5}];
  const read: string[] = [];
  const blob = new Blob(['cached'], {type:'image/jpeg'});
  assert.equal(await projectCoverBlob(frames, async key => { read.push(key); return blob; }), blob);
  assert.ok(read[0].includes('top.NEF'));
});
test('set-aside photos are a last resort even if they have a higher rating', async () => {
  const frames = [{...photo('rejected','reject'), rating:5}, {...photo('other','unreviewed'), rating:2}];
  const read: string[] = [];
  await projectCoverBlob(frames, async key => { read.push(key); return new Blob(['cached'], {type:'image/jpeg'}); });
  assert.ok(read[0].includes('other.NEF'));
});

const image = (label: string) => new Blob([label], { type: 'image/jpeg' });

test('the list cover is the best favourite at review size, preferring the picture developed from the RAW', async () => {
  const best = { ...photo('best'), rating: 4 };
  const other = photo('other');
  const stored = new Map([
    [`developed-v1:${hubPreviewKey(best)}`, { thumbnail: image('dev-thumb'), review: image('dev-review') }],
    [hubPreviewKey(best), { thumbnail: image('embedded-thumb'), review: image('embedded-review') }],
    [hubPreviewKey(other), { thumbnail: image('other-thumb'), review: image('other-review') }],
  ]);
  const result = await projectPreviewBlobs([other, best], 3, async (key) => stored.get(key) ?? null);
  assert.equal(await result.cover?.text(), 'dev-review');
  assert.deepEqual(await Promise.all(result.samples.map((s) => s.text())), ['other-thumb']);
});

test('list samples stop at the asked-for count, skip photos with nothing cached, and a failing store never throws', async () => {
  const frames = Array.from({ length: 8 }, (_, i) => photo(`p${i}`));
  const result = await projectPreviewBlobs(frames, 3, async (key) => {
    if (key.includes('p1.NEF')) throw new Error('store closed');
    if (key.startsWith('developed') || key.includes('p2.NEF')) return null;
    return { thumbnail: image(`t-${key}`), review: image(`r-${key}`) };
  });
  assert.ok(result.cover);
  assert.equal(result.samples.length, 3);
  assert.equal((await projectPreviewBlobs([], 3, async () => null)).cover, null);
});
