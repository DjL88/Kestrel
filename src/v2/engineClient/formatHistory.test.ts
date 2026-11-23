import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CROP } from './cropOps';
import {
  historyForFormat, readFormatHistory, recordFormatCrop, recordFormatLink,
  recordFormatSetChange, ORIGINAL_BRANCH_ID, MAX_FORMAT_HISTORY,
} from './formatHistory';

test('Original is permanent root; new format records its fork from the current shared edit step', () => {
  const next = { custom: [{ id:'custom-abc', label:'4:5', width:1080, height:1350 }], disabled:[] };
  const h = recordFormatSetChange(undefined, undefined, next, 1000, 6);
  assert.deepEqual(h.events[0], {
    formatId: 'custom-abc', kind:'created', at:1000,
    parentFormatId: ORIGINAL_BRANCH_ID, forkEditCursor:6, dimensions:{width:1080,height:1350},
  });
  assert.equal(historyForFormat(h, ORIGINAL_BRANCH_ID).length, 0);
});

test('crop timeline is scoped per format and coalesces a continuous drag', () => {
  const a = { ...DEFAULT_CROP, panX: 10 };
  const b = { ...DEFAULT_CROP, panX: 15 };
  const c = { ...DEFAULT_CROP, panX: -8 };
  let h = recordFormatCrop(undefined, 'orig-3x2', DEFAULT_CROP, a, 1000);
  h = recordFormatCrop(h, 'orig-3x2', a, b, 1100);
  h = recordFormatCrop(h, 'custom-other', DEFAULT_CROP, c, 1150);
  assert.equal(historyForFormat(h, 'orig-3x2').length, 1);
  assert.deepEqual(historyForFormat(h, 'orig-3x2')[0].before, DEFAULT_CROP);
  assert.deepEqual(historyForFormat(h, 'orig-3x2')[0].after, b);
  assert.equal(historyForFormat(h, 'custom-other').length, 1);
});

test('hiding a format is recorded without deleting its branch', () => {
  const off = { disabled:['orig-3x2'], custom:[] };
  const h = recordFormatSetChange(undefined, undefined, off, 1000, 0);
  assert.equal(historyForFormat(h, 'orig-3x2')[0].kind, 'hidden');
  const back = recordFormatSetChange(h, off, undefined, 2000, 0);
  assert.deepEqual(historyForFormat(back, 'orig-3x2').map(e=>e.kind), ['hidden','shown']);
});

test('link/unlink records explicit relationship rather than duplicating shared photo edits', () => {
  let h = recordFormatLink(undefined, 'custom-abc', false, 1000);
  h = recordFormatLink(h, 'custom-abc', true, 2000);
  assert.deepEqual(historyForFormat(h, 'custom-abc').map(e=>e.kind), ['unlinked','linked']);
});

test('read defensively, bound event count, never invent missing earlier events', () => {
  assert.deepEqual(readFormatHistory('bad'), {version:1,events:[]});
  let h = readFormatHistory(undefined);
  for(let i=1;i<=MAX_FORMAT_HISTORY+20;i++) h=recordFormatLink(h,'custom-abc',i%2===0,i);
  assert.equal(h.events.length,MAX_FORMAT_HISTORY);
  assert.equal(historyForFormat(undefined,'orig-3x2').length,0);
});

test('explicitly enabling a default-off format is a recorded visible event', () => {
  const on = { enabled: ['ig-portrait'], disabled: [], custom: [] };
  const history = recordFormatSetChange(undefined, undefined, on, 1000, 0);
  assert.equal(historyForFormat(history, 'ig-portrait')[0].kind, 'shown');
  const off = recordFormatSetChange(history, on, undefined, 2000, 0);
  assert.deepEqual(historyForFormat(off, 'ig-portrait').map(e => e.kind), ['shown', 'hidden']);
});

test('active format keeps its inherited creation point after 300 subsequent actions', () => {
  let history = recordFormatSetChange(undefined, undefined, {
    disabled: [], custom: [{ id: 'custom-keeper', label: 'Portrait', width: 1600, height: 2000 }],
  }, 1000, 12);
  for (let i = 0; i < MAX_FORMAT_HISTORY + 50; i++) {
    history = recordFormatLink(history, 'custom-keeper', i % 2 === 0, 2000 + i);
  }
  assert.equal(history.events.length, MAX_FORMAT_HISTORY);
  const [created] = historyForFormat(history, 'custom-keeper');
  assert.equal(created.kind, 'created');
  assert.equal(created.forkEditCursor, 12);
  assert.equal(created.at, 1000);
  assert.equal(history.events.at(-1)?.at, 2000 + MAX_FORMAT_HISTORY + 49);
});

test('removed formats need not retain a permanent creation marker', () => {
  let history = recordFormatSetChange(undefined, undefined, {
    disabled: [], custom: [{ id: 'custom-gone', label: 'Temporary', width: 1000, height: 1000 }],
  }, 1000, 0);
  history = recordFormatSetChange(history, {
    disabled: [], custom: [{ id: 'custom-gone', label: 'Temporary', width: 1000, height: 1000 }],
  }, undefined, 1100, 0);
  for (let i = 0; i < MAX_FORMAT_HISTORY + 5; i++) {
    history = recordFormatLink(history, 'orig-3x2', i % 2 === 0, 2000 + i);
  }
  assert.equal(history.events.length, MAX_FORMAT_HISTORY);
  assert.equal(historyForFormat(history, 'custom-gone').some(e => e.kind === 'created'), false);
});
