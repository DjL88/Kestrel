import {speciesColourCheck} from './speciesPalette';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {speciesReference} from './speciesKnowledge';
import {buildPhotographyFeedback} from './kite44PhotographyFeedback';
import {validatePhotographyPack} from './photographyKnowledgePack';
import {photographyKnowledge} from './photographyKnowledge';
import {DEFAULT_EDIT} from './photoEdits';
test('species references abstain on ambiguity and invalid scores',()=>{
  assert.ok(speciesReference({common:'European robin',probability:.95,runnerUp:.02}));
  assert.equal(speciesReference({common:'American robin',probability:.95,runnerUp:.02}),null);
  assert.equal(speciesReference({common:'Robin',probability:NaN,runnerUp:0}),null);
  assert.equal(speciesReference({common:'Robin',probability:.85,runnerUp:.4}),null);
});
test('feedback is consent-gated and allowlisted',()=>{
  const input={consent:{shareFeatures:false,version:'1'},observations:[],suggested:DEFAULT_EDIT,accepted:{...DEFAULT_EDIT,filename:'private.nef'},outcome:'accepted' as const};
  assert.equal(buildPhotographyFeedback(input),null);
  const result=buildPhotographyFeedback({...input,consent:{shareFeatures:true,version:'1'}});
  assert.ok(result);
  assert.equal(JSON.stringify(result).includes('private.nef'),false);
});
test('pack rejects unverified or unknown rules',async()=>{
  const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
  const pack={schemaVersion:1,version:'1.0.0',rules:photographyKnowledge.rules.map(r=>({id:r.id,guidance:r.guidance}))};
  const signature=new Uint8Array([1]);
  assert.equal(await validatePhotographyPack(encode(pack),signature,async()=>false),null);
  assert.ok(await validatePhotographyPack(encode(pack),signature,async()=>true));
  assert.equal(await validatePhotographyPack(encode({...pack,rules:[{id:'unknown',guidance:'test'},...pack.rules.slice(1)]}),signature,async()=>true),null);
});

test('invalid species confidence and malformed masks abstain before colour correction',()=>{
  const pixels=new Uint8ClampedArray(64*4).fill(255);
  const subject=new Float32Array(64).fill(1);
  const input={pixels,subject,width:8,height:8,warmLight:false,species:{common:'European robin',probability:.95,runnerUp:.01}};
  for (const probability of [NaN,Infinity,1.1,-1]) assert.equal(speciesColourCheck({...input,species:{...input.species,probability}}).status,'abstained');
  assert.equal(speciesColourCheck({...input,subject:new Float32Array(2)}).status,'abstained');
  assert.equal(speciesColourCheck({...input,pixels:new Uint8ClampedArray(2)}).status,'abstained');
});
