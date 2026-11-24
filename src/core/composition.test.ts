import test from 'node:test';
import assert from 'node:assert/strict';
import { makePage, addPage, assignPhoto, pagePixels, coverCrop, type Composition } from './composition';
test('reuse a photograph across pages without changing the source page',()=>{
 const first=makePage('first','hero',['a','b','c']);
 const second=makePage('second','angled',['a','d','e']);
 const doc:Composition={version:1,size:{unit:'px',width:1080,height:1350},pages:[first]};
 const next=addPage(doc,second);
 assert.equal(doc.pages.length,1);assert.equal(next.pages.length,2);
 assert.equal(next.pages[0].slots[0].photoId,next.pages[1].slots[0].photoId);
 assert.notEqual(next.pages[1].slots[0].angle,0);
 const updated=assignPhoto(second,second.slots[0].id,'f');
 assert.equal(second.slots[0].photoId,'a');assert.equal(updated.slots[0].photoId,'f');
 assert.throws(()=>addPage(next,first));
});
test('A4 at 300 dpi with 3mm bleed',()=>{
 assert.deepEqual(pagePixels({unit:'mm',width:210,height:297,dpi:300,bleed:3}),{width:2550,height:3578,trimWidth:2480,trimHeight:3508,bleedPx:35});
 assert.throws(()=>pagePixels({unit:'px',width:100000,height:100000}));
 assert.throws(()=>pagePixels({unit:'mm',width:210,height:297,dpi:0,bleed:3}));
});
test('cover crop preserves aspect ratio and fills the frame at extreme pan',()=>{
 assert.deepEqual(coverCrop(400,200,100,100,1,-1,0),{x:0,y:0,width:200,height:100});
 assert.deepEqual(coverCrop(400,200,100,100,1,1,0),{x:-100,y:0,width:200,height:100});
 assert.throws(()=>coverCrop(0,200,100,100));
});
