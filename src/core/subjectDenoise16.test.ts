import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyToneMasksRgb16 } from './master16';
import { createSubjectMask, type Mask } from './maskTypes';
import { denoiseChromaRgb16 } from './chromaDenoise16';
import { blendSrgb16 } from './linearRgb16';

test('RGB16 master uses common-source instance strengths and bounded strips', () => {
  const width = 32, height = 29;
  const original = Uint16Array.from({length:width*height*3}, (_,i) => 21001 + (i*7919)%7001);
  const grid = {w:8,h:8,data:btoa(String.fromCharCode(...new Uint8Array(64).fill(255)))};
  const group = createSubjectMask('auto-denoise-test',grid,'k','high');
  group.edit.denoise=0.4;
  const bg: Mask = {...group,id:group.id+'-background',invert:true,edit:{denoise:1.6}};
  const a: Mask = {...group,id:group.id+'-instance-1-dog',edit:{denoise:0}};
  const b: Mask = {...group,id:group.id+'-instance-2-dog',edit:{denoise:1.6}};
  const strong=original.slice();
  denoiseChromaRgb16(strong,width,height,0.8,2);
  assert.notDeepEqual(strong,original);
  const expected=original.map((v,i)=>blendSrgb16(v,strong[i],0.5));
  const run=(masks:Mask[],budget:number)=>{
    const image={width,height,data:original.slice()};
    applyToneMasksRgb16(image,masks,budget);
    return image.data;
  };
  const result=run([a,b,bg,group],width);
  for(let i=0;i<result.length;i++) assert.ok(Math.abs(result[i]-expected[i])<=1);
  assert.deepEqual(result,run([b,a,bg,group],width*height));
  assert.deepEqual(run([a,bg,group],width),original);
  assert.ok(result.some(v=>v%257!==0),'retains finer than 8-bit precision');
});
