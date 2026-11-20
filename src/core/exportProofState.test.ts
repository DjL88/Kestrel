import test from 'node:test';
import assert from 'node:assert/strict';
import { createProofPlan, evidencedSubject, selectProof, selectedProofDestination } from './exportProofState.ts';
const destinations = [{id:'instagram',label:'Instagram',width:1080,height:1350},{id:'master',label:'Master',width:6000,height:4000}];
test('weak or unverified species never pre-fills export',()=>{
 assert.equal(evidencedSubject({label:'Osprey',source:'verified-local-model',confidence:0.89,verified:true}),'');
 assert.equal(evidencedSubject({label:'Osprey',source:'verified-local-model',confidence:0.99}),'');
 assert.equal(evidencedSubject({label:'Dunnock',source:'verified-local-model',confidence:0.98,verified:true}),'Dunnock');
 assert.equal(evidencedSubject({label:'My bird',source:'user'}),'My bird');
});
test('destination tabs and photo switch use correct proof dimensions',()=>{
 const a=createProofPlan({photoIds:['a','b'],destinations});
 const b=selectProof(a,{photoId:'b',destinationId:'master'});
 assert.equal(b.selectedPhotoId,'b');
 assert.equal(selectedProofDestination(b).width,6000);
 assert.equal(a.selectedPhotoId,'a');
 assert.equal(selectedProofDestination(a).width,1080);
});
test('export-only private metadata is redacted without source mutation',()=>{
 const metadata={Camera:'Nikon Z8',GPSLatitude:'51.0','Owner Name':'Private',ISO:'800'};
 const plan=createProofPlan({photoIds:['a'],destinations,metadata});
 assert.deepEqual(plan.metadata,{Camera:'Nikon Z8',ISO:'800'});
 assert.equal(metadata.GPSLatitude,'51.0');
 assert.equal(createProofPlan({photoIds:['a'],destinations,metadata,showLocation:true}).metadata.GPSLatitude,'51.0');
});
test('snapshot is detached from mutable input arrays and destinations',()=>{
 const ids=['a']; const variants=[{id:'web',label:'Web',width:800,height:600}];
 const plan=createProofPlan({photoIds:ids,destinations:variants});
 ids.push('b'); variants[0].width=1;
 assert.deepEqual(plan.photoIds,['a']);
 assert.equal(selectedProofDestination(plan).width,800);
 assert.ok(Object.isFrozen(plan));
});
test('invalid proof selection and duplicate destinations fail closed',()=>{
 assert.throws(()=>createProofPlan({photoIds:['a'],destinations,selectedPhotoId:'missing'}),/unavailable/);
 assert.throws(()=>createProofPlan({photoIds:['a'],destinations:[...destinations,destinations[0]]}),/unique/);
 assert.throws(()=>createProofPlan({photoIds:[],destinations}),/Choose a photo/);
});
test('control characters are stripped from text',()=>{
 assert.equal(evidencedSubject({source:'user',label:'  Bird\n<script>  '}),'Bird <script>');
});
