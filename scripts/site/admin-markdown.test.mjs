import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inlineRuns, parseMarkdown } from '../../site/assets/admin-markdown.mjs';
import { VIEWS, viewForHash } from '../../site/assets/admin-needs.mjs';

test('inline runs keep text, code, bold and safe links apart', () => {
  assert.deepEqual(inlineRuns('Plain **bold** and `code` with [a link](https://inflight.studio) and [file](docs/x.md)'), [
    { text: 'Plain ' }, { strong: 'bold' }, { text: ' and ' }, { code: 'code' }, { text: ' with ' },
    { link: 'a link', href: 'https://inflight.studio' }, { text: ' and ' }, { text: 'file' },
  ]);
  assert.deepEqual(inlineRuns('[x](javascript:alert(1))'), [{ text: 'x' }, { text: ')' }], 'a script link is never a link');
  assert.deepEqual(inlineRuns('HE and HE\\*'), [{ text: 'HE and HE*' }]);
});

test('blocks: headings, paragraphs, lists, tables and rules', () => {
  const blocks = parseMarkdown('# Title\n\nOne\ntwo.\n\n- a\n- b\n\n1. first\n2. second\n\n| A | B |\n| --- | --- |\n| 1 | `2` |\n\n---\n');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'list', 'list', 'table', 'rule']);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[1].runs, [{ text: 'One two.' }]);
  assert.equal(blocks[2].ordered, false); assert.equal(blocks[3].ordered, true);
  assert.deepEqual(blocks[4].head, [[{ text: 'A' }], [{ text: 'B' }]]);
  assert.deepEqual(blocks[4].rows, [[[{ text: '1' }], [{ code: '2' }]]]);
});

test('the real technical overview reads cleanly: one title, its tables and the answer bank', () => {
  const blocks = parseMarkdown(readFileSync(new URL('../../docs/TECHNICAL-OVERVIEW.md', import.meta.url), 'utf8'));
  assert.equal(blocks.filter((b) => b.type === 'heading' && b.level === 1).length, 1);
  assert.ok(blocks.filter((b) => b.type === 'table').length >= 10);
  assert.ok(blocks.some((b) => b.type === 'heading' && b.runs.some((r) => r.text?.includes('Answer bank'))));
  for (const b of blocks.filter((b) => b.type === 'paragraph')) assert.ok(!b.runs.some((r) => r.text?.trim().startsWith('|')), 'no table leaks into a paragraph');
});

test('the console offers the overview as its own view', () => {
  assert.deepEqual(VIEWS.technical.sections, ['technical-overview']);
  assert.equal(viewForHash('#technical'), 'technical');
});
