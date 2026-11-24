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

test('visual evidence must match source identity and cannot establish artistic intent', () => {
  const sha='a'.repeat(64);
  const frame={stableKey:'photo-1',originalSha256:sha,searchEvidence:{
    schema:1 as const, sourceStableKey:'photo-1',sourceSha256:sha,modelRevision:'fixture',indexedAt:1,
    ocr:[{value:'silhouette',status:'confirmed' as const}],
    subjects:[{value:'person',status:'supported' as const},{value:'sunset',status:'supported' as const}],
  }};
  assert.deepEqual(preservationPolicy(observationsFromFrame(frame)),{preserveLight:false,preserveDark:false,preserveSoft:true});
  assert.equal(preservationPolicy(observationsFromFrame({...frame,originalSha256:'b'.repeat(64)})).preserveSoft,false);
  assert.equal(preservationPolicy(observationsFromFrame({...frame,stableKey:'other'})).preserveSoft,false);
  assert.equal(preservationPolicy(observationsFromFrame({...frame,subjectDisputed:true})).preserveSoft,false);
  assert.equal(preservationPolicy(observationsFromFrame({...frame,searchEvidence:{...frame.searchEvidence,subjects:[{value:'person',status:'needs-review'}]}})).preserveSoft,false);
});
test('explicit knowledge labels match independently across dimensions',()=>{
  const rules=observationsFromFrame({tags:['White bird','Snow','Golden hour','Negative space']});
  assert.ok(rules.some(r=>r.dimension==='subject' && r.label==='white bird'));
  assert.ok(rules.some(r=>r.dimension==='scene' && r.label==='snow'));
  assert.ok(rules.some(r=>r.dimension==='composition' && r.label==='negative space'));
  assert.equal(preservationPolicy(rules).preserveLight,true);
});
