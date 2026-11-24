import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTrueDetailTiles } from './trueDetailTiles.ts';

test('identity inference preserves every RGB16 sample across tile boundaries', async () => {
  const width=389,height=197;
  const source=Uint16Array.from({length:width*height*3},(_,i)=>(i*7919)%65536);
  const progress:number[]=[];
  const result=await runTrueDetailTiles(source,width,height,async input=>input.slice(),{
    strength:1,progress:(done,total)=>{assert.ok(done<=total);progress.push(done);}
  });
  assert.deepEqual(result,source);
  assert.notEqual(result,source);
  assert.deepEqual(progress,[1,2,3,4,5,6]);
});

test('subject protection reduces model influence without reducing precision',async()=>{
  const source=new Uint16Array([20001,30001,40001,20001,30001,40001]);
  const output=await runTrueDetailTiles(source,2,1,async input=>input.fill(0.5),{
    strength:1,subjectProtection:0,subjectAlpha:new Float32Array([1,0])
  });
  assert.deepEqual([...output],[20001,30001,40001,32768,32768,32768]);
  assert.deepEqual([...source],[20001,30001,40001,20001,30001,40001]);
});

test('invalid tensor output and cancellation reject without modifying source',async()=>{
  const source=new Uint16Array([12345,23456,34567]),before=source.slice();
  await assert.rejects(runTrueDetailTiles(source,1,1,async()=>new Float32Array(1),{strength:1}),/shape/);
  await assert.rejects(runTrueDetailTiles(source,1,1,async input=>input.fill(NaN),{strength:1}),/samples/);
  const controller=new AbortController();
  await assert.rejects(runTrueDetailTiles(source,1,1,async input=>{controller.abort();return input;},{
    strength:1,signal:controller.signal
  }),{name:'AbortError'});
  assert.deepEqual(source,before);
});
