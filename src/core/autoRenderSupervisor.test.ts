import assert from 'node:assert/strict';
import test from 'node:test';
import { superviseAutoRender } from './autoRenderSupervisor';
const width=128,height=128;
function image(value:(x:number,y:number)=>number){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data.fill(value(x,y),i,i+3);data[i+3]=255;}
  return {width,height,data};
}
test('preserved structure and gentle brightness pass',()=>{
  assert.equal(superviseAutoRender(image(x=>x%8<4?90:150),image(x=>x%8<4?100:160)).safe,true);
});
test('a small protected subject cannot lose structure or clipping unnoticed',()=>{
  const before=image(x=>x%8<4?90:150);
  const after=image((x,y)=>x<16&&y<16?120:x%8<4?90:150);
  const mask=Float32Array.from({length:width*height},(_,i)=>i%width<16&&Math.floor(i/width)<16?1:0);
  assert.equal(superviseAutoRender(before,after,[mask]).safe,false);
  const clipped=image((x,y)=>x<16&&y<16?255:x%8<4?90:150);
  assert.equal(superviseAutoRender(before,clipped,[mask]).safe,false);
});
test('new edge overshoot is rejected',()=>{
  const before=image(x=>x%8<4?80:170);
  const after=image(x=>x%8===3?40:x%8===4?210:x%8<4?80:170);
  assert.match(superviseAutoRender(before,after).reason,/overshoot/);
});
test('invalid comparison geometry or mask is rejected',()=>{
  const before=image(()=>120);
  assert.equal(superviseAutoRender(before,{...before,width:64}).safe,false);
  assert.equal(superviseAutoRender(before,before,[new Float32Array(1)]).safe,false);
});
