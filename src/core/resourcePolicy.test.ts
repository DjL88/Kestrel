import test from 'node:test';
import assert from 'node:assert/strict';
import { admitBackground, nextConcurrency, mayDispatchCloud } from './resourcePolicy';
const MiB = 1024 * 1024;
const zero = {memoryBytes:0,gpuBytes:0,diskBytes:0};
const job = {...zero,memoryBytes:256*MiB};
test('resource reservations protect memory and refuse unknown capacity', () => {
  assert.deepEqual(admitBackground({},zero,job),{allowed:false,reason:'unknown'});
  assert.equal(admitBackground({availableMemoryBytes:1024*MiB},zero,job).allowed,true);
  assert.deepEqual(admitBackground({availableMemoryBytes:1024*MiB},job,{...job,memoryBytes:512*MiB}),{allowed:false,reason:'memory'});
});
test('pressure reduces admission without changing quality', () => {
  assert.equal(admitBackground({cpu:.9},zero,zero).reason,'cpu');
  assert.equal(admitBackground({cpu:.7,onBattery:true},zero,zero).reason,'cpu');
  assert.equal(admitBackground({thermal:'critical'},zero,zero,'maximum').reason,'thermal');
  assert.equal(admitBackground({},zero,{...job,memoryBytes:NaN}).reason,'invalid');
  assert.equal(nextConcurrency(3,0,false,4),2);
  assert.equal(nextConcurrency(0,2,true,4),0);
  assert.equal(nextConcurrency(0,3,true,4),1);
  assert.equal(nextConcurrency(4,3,true,4),4);
});
test('cloud requires explicit consent, eligibility and known budget', () => {
  const input = {online:true,enabled:true,consent:true,eligible:true,estimatedCost:1,remainingBudget:2};
  assert.equal(mayDispatchCloud(input),true);
  for (const key of ['online','enabled','consent','eligible'] as const) assert.equal(mayDispatchCloud({...input,[key]:false}),false);
  assert.equal(mayDispatchCloud({...input,estimatedCost:NaN}),false);
  assert.equal(mayDispatchCloud({...input,estimatedCost:3}),false);
});
