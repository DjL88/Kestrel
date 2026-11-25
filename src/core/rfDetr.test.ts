import assert from 'node:assert/strict';
import test from 'node:test';
import { RFDETR_LOGITS, RFDETR_QUERIES, RFDETR_TO_SUBJECT, decodeRfDetr, rfDetrInput, tandemDetections } from './rfDetr';
import { SUBJECT_CLASSES, type Detection } from './objectDetection';
import { OPTIONAL_MODELS, RFDETR_NANO, optionalModelBytes, optionalModelConfigured, optionalModelFitsDevice } from './optionalModels';

const empty = () => ({ logits: new Float32Array(RFDETR_QUERIES * RFDETR_LOGITS).fill(-10), boxes: new Float32Array(RFDETR_QUERIES * 4) });
const logit = (p: number) => Math.log(p / (1 - p));

test('every RF-DETR subject class maps onto the YOLOX subject class of the same name', () => {
  const coco91: Record<number, string> = { 1: 'person', 5: 'aeroplane', 16: 'bird', 17: 'cat', 18: 'dog', 25: 'giraffe' };
  for (const [id, name] of Object.entries(coco91)) assert.equal(SUBJECT_CLASSES[RFDETR_TO_SUBJECT[Number(id)]], name);
  assert.equal(Object.keys(RFDETR_TO_SUBJECT).length, Object.keys(SUBJECT_CLASSES).length);
});

test('input is planar and ImageNet-normalised', () => {
  const rgba = new Uint8ClampedArray(2 * 2 * 4).fill(255);
  const out = rfDetrInput(rgba, 2);
  assert.equal(out.length, 12);
  assert.ok(Math.abs(out[0] - (1 - 0.485) / 0.229) < 1e-6);
  assert.ok(Math.abs(out[8] - (1 - 0.406) / 0.225) < 1e-6);
  assert.throws(() => rfDetrInput(new Uint8ClampedArray(4), 2), RangeError);
});

test('decode keeps subject classes above the threshold, in photo pixels, and skips the rest', () => {
  const { logits, boxes } = empty();
  logits[0 * RFDETR_LOGITS + 16] = logit(0.9); boxes.set([0.5, 0.5, 0.2, 0.1], 0); // bird
  logits[1 * RFDETR_LOGITS + 62] = logit(0.95); boxes.set([0.2, 0.2, 0.1, 0.1], 4); // chair: not a subject
  logits[2 * RFDETR_LOGITS + 1] = logit(0.2); boxes.set([0.8, 0.8, 0.1, 0.1], 8); // person below threshold
  logits[3 * RFDETR_LOGITS + 5] = logit(0.8); boxes.set([NaN, 0.5, 0.1, 0.1], 12); // corrupt box
  const found = decodeRfDetr(logits, boxes, { x: 100, y: 50, w: 1000, h: 500 });
  assert.equal(found.length, 1);
  assert.equal(found[0].label, 'bird');
  assert.ok(Math.abs(found[0].score - 0.9) < 1e-6);
  const box = found[0].box;
  for (const [got, want] of [[box.x, 500], [box.y, 275], [box.w, 200], [box.h, 50]]) assert.ok(Math.abs(got - want) < 1e-3, `${got} vs ${want}`);
  assert.throws(() => decodeRfDetr(new Float32Array(3), boxes, { x: 0, y: 0, w: 1, h: 1 }));
});

const det = (label: string, classId: number, score: number, x: number): Detection => ({ label, classId, score, box: { x, y: 0, w: 100, h: 100 } });

test('tandem: agreement keeps the higher score; disagreement is kept and marked for review, never dropped', () => {
  const rf = [det('bird', 14, 0.8, 0), det('bird', 14, 0.6, 500)];
  const yx = [det('bird', 14, 0.7, 10), det('dog', 16, 0.9, 1000)];
  const out = tandemDetections(rf, yx);
  assert.equal(out.length, 3);
  const both = out.find((d) => d.agreement === 'both')!;
  assert.equal(both.score, 0.8);
  assert.equal(both.review, false);
  assert.ok(out.filter((d) => d.agreement !== 'both').every((d) => d.review));
  assert.deepEqual(out.map((d) => d.agreement).sort(), ['both', 'rfdetr-only', 'yolox-only']);
});

test('tandem without RF-DETR is the YOLOX answer, with no review flags', () => {
  const yx = [det('person', 0, 0.9, 0)];
  const out = tandemDetections(null, yx);
  assert.deepEqual(out.map(({ agreement, review, ...d }) => d), yx);
  assert.ok(out.every((d) => d.agreement === 'yolox-only' && !d.review));
});

test('the RF-DETR pack is pinned, offered on phones, and hidden when the build gives no address', () => {
  assert.ok(OPTIONAL_MODELS.includes(RFDETR_NANO));
  assert.match(RFDETR_NANO.files.model.sha256, /^[0-9a-f]{64}$/);
  assert.ok(optionalModelBytes(RFDETR_NANO) > 10e6 && optionalModelBytes(RFDETR_NANO) < 80e6);
  assert.equal(RFDETR_NANO.licence, 'Apache-2.0');
  assert.equal(optionalModelFitsDevice(RFDETR_NANO, 'phone'), true);
  assert.equal(optionalModelConfigured({ ...RFDETR_NANO, files: { model: { ...RFDETR_NANO.files.model, url: '' } } }), false);
  assert.equal(optionalModelConfigured({ ...RFDETR_NANO, files: { model: { ...RFDETR_NANO.files.model, url: '/m.onnx' } } }), true);
});

test('tandem keeps every subject separately: two birds and five people stay seven boxes', () => {
  const birds = [det('bird', 14, 0.9, 0), det('bird', 14, 0.85, 300)];
  const people = Array.from({ length: 5 }, (_, i) => det('person', 0, 0.8 - i * 0.02, 1000 + i * 150));
  const rf = [...birds, ...people];
  const yx = [{ ...birds[0], score: 0.7 }, { ...people[2], box: { ...people[2].box, x: people[2].box.x + 5 } }];
  const out = tandemDetections(rf, yx);
  assert.equal(out.length, 7);
  assert.equal(out.filter((d) => d.label === 'bird').length, 2);
  assert.equal(out.filter((d) => d.label === 'person').length, 5);
  assert.equal(out.filter((d) => d.agreement === 'both').length, 2);
  assert.ok(out.filter((d) => d.agreement === 'rfdetr-only').every((d) => d.review));
});
