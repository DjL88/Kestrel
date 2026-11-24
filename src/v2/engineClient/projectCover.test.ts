import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCoverBlob } from './projectCover';
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
