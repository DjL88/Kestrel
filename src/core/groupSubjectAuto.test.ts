import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSubjectMask} from './maskTypes';
import {DEFAULT_EDIT} from './photoEdits';
import {proposeGroupSubjectAuto,groupSubjectSafe} from './groupSubjectAuto';
const w=64,h=64;
const grid=(left:number,right:number)=>({w:16,h:16,data:btoa(Array.from({length:256},(_,i)=>String.fromCharCode(i%16>=left&&i%16<right?255:0)).join(''))});
const a=createSubjectMask('a',grid(1,5),'frame','high');
const b=createSubjectMask('b',grid(11,15),'frame','high');
const pixels=new Uint8ClampedArray(w*h*4);
for(let i=0;i<w*h;i++){
  const x=i%w,v=x<24?45:x>40?252:130;
  pixels[4*i]=pixels[4*i+1]=pixels[4*i+2]=v;pixels[4*i+3]=255;
}
test('separated dark and bright subjects receive different local tone proposals',()=>{
  const proposal=proposeGroupSubjectAuto(pixels,w,h,DEFAULT_EDIT,[a,b],['new-a','new-b'],false);
  assert.equal(proposal.masks?.find(m=>m.id==='new-a')?.edit.exposure,.2);
  assert.equal(proposal.masks?.find(m=>m.id==='new-b')?.edit.highlights,-.25);
  const noisy=proposeGroupSubjectAuto(pixels,w,h,DEFAULT_EDIT,[a,b],['new-a','new-b'],true);
  assert.equal(noisy.masks?.some(m=>m.edit.exposure!==undefined),false);
});
test('overlap, duplicate IDs and existing manual masks prevent local group proposals',()=>{
  assert.equal(proposeGroupSubjectAuto(pixels,w,h,DEFAULT_EDIT,[a,{...a,id:'overlap'}],['x','y'],false),DEFAULT_EDIT);
  assert.equal(proposeGroupSubjectAuto(pixels,w,h,DEFAULT_EDIT,[a,b],['x','x'],false),DEFAULT_EDIT);
  const existing={...DEFAULT_EDIT,masks:[a]};
  assert.equal(proposeGroupSubjectAuto(pixels,w,h,existing,[a,b],['x','y'],false),existing);
});
test('invalid group evidence cannot pass the candidate gate',()=>{
  const broken={...b,grid:{...b.grid,data:'invalid'}};
  assert.equal(groupSubjectSafe(pixels,w,h,DEFAULT_EDIT,DEFAULT_EDIT,[a,broken]),false);
  assert.equal(groupSubjectSafe(pixels,w,h,DEFAULT_EDIT,DEFAULT_EDIT,[]),false);
  assert.equal(groupSubjectSafe(pixels,w,h,DEFAULT_EDIT,DEFAULT_EDIT,[a,{...b,confidence:'low'}]),false);
  assert.equal(groupSubjectSafe(pixels,w,h,DEFAULT_EDIT,DEFAULT_EDIT,[a,b]),true);
});

test('adaptive detail requires known ISO and explicit policy; soft intent suppresses sharpening',()=>{
  const textured=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){
    const x=i%w,y=Math.floor(i/w),v=x<24?((x+y)%2?100:150):130;
    textured[4*i]=textured[4*i+1]=textured[4*i+2]=v;textured[4*i+3]=255;
  }
  const propose=(highIso:boolean,observations?:Parameters<typeof proposeGroupSubjectAuto>[7],iso?:number)=>
    proposeGroupSubjectAuto(textured,w,h,DEFAULT_EDIT,[a,b],['x','y'],highIso,observations,iso);
  assert.equal(propose(false,[],100).masks?.find(m=>m.id==='x')?.edit.sharpen,.1);
  assert.ok(!propose(false,[],100).masks?.find(m=>m.id==='y')?.edit.sharpen);
  for(const result of [propose(false),propose(false,[]),propose(true,[],3200),propose(false,[{dimension:'composition',label:'motion blur',confidence:1}],100)]){
    assert.ok(!result.masks?.some(m=>m.edit.sharpen));
  }
});
