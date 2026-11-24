import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAutoMaskIsolation } from './autoMaskIsolation';

const width=64,height=64;
function pixels(value:(x:number,y:number)=>number){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;data.fill(value(x,y),i,i+3);data[i+3]=255;
  }
  return {width,height,data};
}
const alpha=Float32Array.from({length:width*height},(_,p)=>Math.max(0,Math.min(1,(24-p%width)/8)));
const before=pixels(()=>100);
test('a smoothly feathered local edit stays inside model coverage',()=>{
  assert.equal(assessAutoMaskIsolation(before,pixels(x=>100+Math.round(40*alpha[x])),[alpha]).safe,true);
});
test('rejects a subject adjustment spreading across the background',()=>{
  const review=assessAutoMaskIsolation(before,pixels(x=>x<40?140:100),[alpha]);
  assert.equal(review.safe,false);
  assert.match(review.reason,/background/);
});
test('rejects abrupt discontinuity on a smooth feathered boundary',()=>{
  const review=assessAutoMaskIsolation(before,pixels(x=>x<20?150:100),[alpha]);
  assert.equal(review.safe,false);
  assert.match(review.reason,/seam/);
});
test('requires independently supplied valid subject coverage',()=>{
  assert.equal(assessAutoMaskIsolation(before,before,[]).safe,false);
  assert.equal(assessAutoMaskIsolation(before,before,[new Float32Array(1)]).safe,false);
  assert.equal(assessAutoMaskIsolation(before,before,[new Float32Array(width*height)]).safe,false);
});
