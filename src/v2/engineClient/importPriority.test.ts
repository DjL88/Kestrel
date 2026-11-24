import assert from 'node:assert/strict';
import test from 'node:test';
import { orderImportCandidates } from './importPriority.ts';

const candidates = (n: number) => Array.from({length:n},(_,index)=>({file:'photo-'+(index+1),index}));

test('large unrated import samples the whole shoot, not the first burst',()=>{
  const source=candidates(1000);
  const ordered=orderImportCandidates(source,new Map());
  assert.deepEqual(ordered.slice(0,10).map(x=>x.index+1),[1,201,401,601,801,2,202,402,602,802]);
  assert.equal(new Set(ordered.map(x=>x.index)).size,1000);
  assert.deepEqual(source.map(x=>x.index),Array.from({length:1000},(_,i)=>i));
});

test('camera ratings and verified flags take precedence; rejects go last',()=>{
  const source=candidates(20);
  const metadata=new Map([
    [14,{rating:5}], [2,{rating:4}], [7,{rating:5}],
    [18,{flagged:true}], [0,{rating:5,rejectedByMetadata:true}],
    [6,{rating:0}], [9,{rating:99}],
  ]);
  const ordered=orderImportCandidates(source,metadata);
  assert.deepEqual(ordered.slice(0,4).map(x=>x.index),[7,14,2,18]);
  assert.equal(ordered.at(-1)?.index,0);
  assert.equal(new Set(ordered.map(x=>x.index)).size,20);
});

test('priority order never replaces original capture indices',()=>{
  const source=candidates(100).reverse();
  const ordered=orderImportCandidates(source,new Map([[99,{rating:5}]]));
  assert.equal(ordered[0].index,99);
  assert.equal(ordered[0].file,'photo-100');
  assert.deepEqual([...ordered].sort((a,b)=>a.index-b.index),candidates(100));
});
