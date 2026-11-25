import assert from 'node:assert/strict';
import test from 'node:test';
import { RFDETR_LOGITS, RFDETR_QUERIES, decodeRfDetr } from './rfDetr';
import { readRfDetrResult } from './rfDetrWorkerProtocol';

const logits = () => new Float32Array(RFDETR_QUERIES * RFDETR_LOGITS).fill(-10);
const boxes = () => new Float32Array(RFDETR_QUERIES * 4);

test('a well-formed worker reply gives the arrays and its run time, and decodes like the interface-thread path', () => {
  const l = logits(); const b = boxes();
  l[16] = Math.log(0.9 / 0.1); b.set([0.5, 0.5, 0.2, 0.2], 0); // one bird
  const out = readRfDetrResult({ type: 'result', id: 3, logits: l, boxes: b, runMs: 812.5 });
  assert.equal(out.runMs, 812.5);
  const found = decodeRfDetr(out.logits, out.boxes, { x: 0, y: 0, w: 100, h: 100 });
  assert.equal(found.length, 1);
  assert.equal(found[0].label, 'bird');
});

test('a short, mistyped or error reply is refused, never read as subjects', () => {
  assert.throws(() => readRfDetrResult({ type: 'result', logits: new Float32Array(5), boxes: boxes() }), /unexpected/);
  assert.throws(() => readRfDetrResult({ type: 'result', logits: Array.from(logits()), boxes: boxes() }), /unexpected/);
  assert.throws(() => readRfDetrResult({ type: 'error', id: 1, message: 'out of memory' }), /out of memory/);
  assert.throws(() => readRfDetrResult(null), /unexpected/);
  assert.equal(readRfDetrResult({ type: 'result', logits: logits(), boxes: boxes(), runMs: Number.NaN }).runMs, null);
});
