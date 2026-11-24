import test from 'node:test';
import assert from 'node:assert/strict';
import { createMask } from '../../core/maskTypes';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING } from '../../core/photoFraming';
import { createEmptyProject } from '../../core/projects';
import type { PhotoFrame } from '../../core/types';
import { addSavedEditGroup } from './editGroupState';
import { commitVerifiedMasks } from './maskVerificationCommit';
const original = {...createMask('radial','mask'),edit:{exposure:0.8}};
const source: PhotoFrame = {id:'bird',stableKey:'bird.nef',filename:'bird.nef',sequenceIndex:1,
  decision:'unreviewed',burstGroupId:null,burstIndex:0,burstCount:1,exif:{},isDemo:false,sourceKind:'file',
  edit:{...DEFAULT_EDIT,masks:[original]}};
const corrected = {...original,edit:{exposure:0.3}};
const project = (frame:PhotoFrame,id='p') => ({...createEmptyProject(id,'Test'),frames:[frame]});
test('verification cannot cross projects, original identities, framing or edit groups',()=>{
  const group = addSavedEditGroup(source,'other');
  assert.ok(group);
  for(const state of [project(source,'another'),project({...source,stableKey:'other.nef'}),
    project({...source,framing:{...DEFAULT_FRAMING,turns:1}}),project(group),
    project({...source,editVersions:{version:1,activeId:'other',versions:[]}}),
    project({...source,removedAt:0}),project({...source,edit:{...source.edit!,masks:[]}})]){
    assert.equal(commitVerifiedMasks(state,'p',source,[corrected],3000),state);
  }
});
test('valid correction preserves concurrent global adjustments and rating',()=>{
  const current = {...source,rating:4,edit:{...source.edit!,exposure:0.5}};
  const state = commitVerifiedMasks(project(current),'p',source,[corrected],3000);
  assert.equal(state.frames[0].rating,4);
  assert.equal(state.frames[0].edit?.exposure,0.5);
  assert.deepEqual(state.frames[0].edit?.masks,[corrected]);
});
