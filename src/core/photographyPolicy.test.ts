import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observationsFromFrame, preservationPolicy } from './photographyPolicy';
import { naturalAuto } from './naturalAuto';
import { planAuto } from './unifiedAuto';
import { DEFAULT_EDIT } from './photoEdits';
test('confirmed tags activate rules but automatic tags do not', () => {
  const observations = observationsFromFrame({tags:['Sunset','Low-key','Portrait'],autoTags:['Sunset']});
  assert.deepEqual(preservationPolicy(observations),{preserveLight:false,preserveDark:true,preserveSoft:true});
  assert.equal(preservationPolicy(observationsFromFrame({subjectKind:'people',subjectDisputed:true})).preserveSoft,false);
});
test('uncertain observations do not suppress measured adjustments', () => {
  assert.equal(preservationPolicy([{dimension:'lighting',label:'silhouette',confidence:0.3}]).preserveDark,false);
});
test('explicit dark intent survives unified exposure fallback', () => {
  const pixels = new Uint8ClampedArray(32*32*4);
  for(let i=0;i<pixels.length;i+=4) { pixels[i]=pixels[i+1]=pixels[i+2]=25; pixels[i+3]=255; }
  const photographyObservations = observationsFromFrame({tags:['Silhouette']});
  const natural = naturalAuto({pixels,width:32,height:32,photographyObservations});
  assert.ok(natural.edit.exposure <= 0);
  assert.ok(natural.edit.shadows <= 0);
  const plan=planAuto({pixels,width:32,height:32,base:DEFAULT_EDIT,proposal:{...DEFAULT_EDIT,...natural.edit},natural,photographyObservations});
  assert.ok((plan.proposal.exposure ?? 0) <= (DEFAULT_EDIT.exposure ?? 0));
});
