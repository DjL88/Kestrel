import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photographyKnowledge, resolvePhotographyGuidance } from './photographyKnowledge';
test('knowledge identifiers are unique and sources exist', () => {
  assert.equal(new Set(photographyKnowledge.rules.map(r => r.id)).size, photographyKnowledge.rules.length);
  const sources = new Set<string>(photographyKnowledge.sources.map(s => s.id));
  for (const rule of photographyKnowledge.rules) for (const id of rule.sourceIds) assert.ok(sources.has(id));
});
test('combines confident observations without inventing guidance', () => {
  const result = resolvePhotographyGuidance([{dimension:'subject',label:'Perched bird',confidence:0.95},{dimension:'scene',label:'bokeh',confidence:0.9},{dimension:'lighting',label:'silhouette',confidence:0.2}]);
  assert.deepEqual(result.rules.map(r=>r.id),['subject.perched-bird','scene.bokeh']);
  assert.ok(result.hardGates.includes('original-byte-integrity'));
});
test('unknown and invalid confidence yield no advice', () => {
  assert.equal(resolvePhotographyGuidance([{dimension:'subject',label:'unknown',confidence:1},{dimension:'subject',label:'perched bird',confidence:NaN},{dimension:'scene',label:'bokeh',confidence:2}]).rules.length,0);
  assert.throws(()=>resolvePhotographyGuidance([],NaN),RangeError);
});
