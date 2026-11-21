import assert from 'node:assert/strict';
import {test} from 'node:test';
import {proposeSelectAdvisor,advisorRecipeMatchesSource,type AdvisorEvidence} from './selectAdvisorRegions';
const hash='a'.repeat(64);
const evidence=():AdvisorEvidence=>({
  photoId:'one',sourceSha256:hash,modelId:'local-detector',modelVersion:'1',
  genre:'pet',histogramReliable:true,highlightClipping:.2,shadowClipping:.3,
  noiseScore:.5,textureScore:.7,
  subject:{score:.92,edgeScore:.91,maskId:'subject:one',sourceSha256:hash},
  sky:{score:.85,edgeScore:.85,maskId:'sky:one',sourceSha256:hash}
});
test('one source yields three bounded treatments and combined parameter recipe, never RGB',()=>{
  const r=proposeSelectAdvisor(evidence());
  assert.equal(r.status,'ready');
  assert.deepEqual(r.recipes.map(x=>x.kind),['Natural','Subject','Creative','Combined']);
  for(const x of r.recipes){assert.equal(x.requiresApproval,true);assert.equal(advisorRecipeMatchesSource(x,hash),true);assert.equal(Object.hasOwn(x,'pixels'),false);}
  assert.equal(r.recipes[3].regions.length,2);
});
test('bird versus aircraft contradictory and missing negative head abstain',()=>{
  const e=evidence();e.genre='bird';e.birdScore=.88;e.aircraftScore=.86;
  assert.equal(proposeSelectAdvisor(e).reason,'bird-aircraft-conflict');
  delete e.aircraftScore;
  assert.equal(proposeSelectAdvisor(e).status,'abstain');
});
test('stale masks and model provenance fail closed, low-quality edges never applied',()=>{
  const e=evidence();e.subject!.sourceSha256='b'.repeat(64);
  assert.equal(proposeSelectAdvisor(e).status,'abstain');
  e.subject!.sourceSha256=hash;e.modelVersion='';
  assert.equal(proposeSelectAdvisor(e).status,'abstain');
  e.modelVersion='1';e.subject!.edgeScore=.2;
  assert.equal(proposeSelectAdvisor(e).recipes[1].regions.length,0);
});
test('manual locks and source binding preserve user control',()=>{
  const r=proposeSelectAdvisor(evidence(),['global.highlights','subject','sky.highlights']);
  assert.equal(r.recipes[0].global.highlights,0);
  assert.equal(r.recipes[1].regions.length,0);
  assert.equal(r.recipes[2].regions.length,0);
  assert.equal(advisorRecipeMatchesSource(r.recipes[0],'b'.repeat(64)),false);
});
test('unknown and 500 synthetic cross-genre cases never force species or auto apply',()=>{
  const genres=['unknown','landscape','person','sport','architecture','travel','macro','pet'] as const;
  for(let i=0;i<500;i++){const e=evidence();e.photoId='p'+i;e.genre=genres[i%genres.length];
    const r=proposeSelectAdvisor(e);
    assert.ok(['ready','abstain'].includes(r.status));
    assert.ok(r.recipes.every(x=>x.requiresApproval && x.photoId===e.photoId));
  }
});
