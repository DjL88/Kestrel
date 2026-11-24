import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photographyKnowledge, resolvePhotographyGuidance } from './photographyKnowledge';
import { CHECKED_SOURCES, KNOWLEDGE_CITATIONS, citationsFor } from './photographyKnowledgeSources';

test('every citation names a real rule and a checked source', () => {
  const rules = new Set<string>(photographyKnowledge.rules.map(r => r.id));
  const sources = new Set(CHECKED_SOURCES.map(s => s.id));
  assert.equal(sources.size, CHECKED_SOURCES.length, 'source ids are unique');
  for (const c of KNOWLEDGE_CITATIONS) {
    assert.ok(rules.has(c.ruleId), `unknown rule ${c.ruleId}`);
    assert.ok(sources.has(c.sourceId), `unknown source ${c.sourceId}`);
    assert.ok(c.supports.trim().length > 20 && c.supports.length <= 300);
  }
});

test('every checked source is used, dated, https and states its licence position', () => {
  const used = new Set(KNOWLEDGE_CITATIONS.map(c => c.sourceId));
  for (const s of CHECKED_SOURCES) {
    assert.ok(used.has(s.id), `${s.id} is never cited`);
    assert.match(s.url, /^https:\/\//);
    assert.match(s.accessed, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(s.licence.length > 10);
  }
});

test('exposure recovery rules all carry at least two independent sources', () => {
  for (const id of ['lighting.clipped-highlights', 'lighting.clipped-colour-channel', 'lighting.underexposed-raw',
    'lighting.high-iso-shadows', 'lighting.bright-background', 'lighting.high-dynamic-range',
    'lighting.underexposure', 'lighting.overexposure']) {
    assert.ok(photographyKnowledge.rules.some(r => r.id === id), `${id} missing`);
    const publishers = new Set(citationsFor(id).map(c => c.source.publisher));
    assert.ok(publishers.size >= 2, `${id} has fewer than two publishers`);
  }
});

test('guidance never smuggles in fixed slider numbers', () => {
  for (const r of photographyKnowledge.rules) assert.doesNotMatch(r.guidance, /[+-]?\d+(\.\d+)?\s*(EV|stops?|%)/i, r.id);
});

test('resolved guidance carries citations, and unsourced rules say so by having none', () => {
  const result = resolvePhotographyGuidance([
    { dimension: 'lighting', label: 'Clipped highlights', confidence: 0.95 },
    { dimension: 'subject', label: 'reptile', confidence: 0.95 },
  ]);
  assert.deepEqual(result.rules.map(r => r.id), ['subject.reptile', 'lighting.clipped-highlights']);
  assert.ok(result.citations['lighting.clipped-highlights'].length >= 3);
  assert.deepEqual(result.citations['subject.reptile'], []);
  assert.deepEqual(citationsFor('no.such-rule'), []);
});
