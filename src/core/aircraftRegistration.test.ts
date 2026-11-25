import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMarkings, looksLikeNumberPlate, mayReadMarkings } from './aircraftRegistration';
import { UK_MILITARY_BLOCKS, faaRegister, lookUpMarking } from './aircraftRegister';
import { decodeText, detectorSize, recogniserWidth, textBoxes } from './textOcr';
import { VEHICLE_LABELS as labels } from './vehicleLabels';
import { validVehicleReading, vehicleLabel, vehicleSearchWords, withMarking, type VehicleReading } from './vehicleRecognition';
import { source as words } from '../i18n/areas/vehicles/source';

const jet: VehicleReading = { schema: 1, family: 'air', kind: 'military-jet', source: 'clip', labelsVersion: 1 };
const typeName = (id: string) => labels.types.find((entry) => entry.id === id)?.name;
const faa = faaRegister({ extracted: '2026-11-24', types: ['CESSNA 172S', 'BOEING 737-8'], operators: ['UNITED STATES AIR FORCE'],
  entries: ['100,0', '172SP,0', '737XA,1,0'].join('\n') });
const lookUp = (pictureKind: string | undefined) => (marking: Parameters<typeof lookUpMarking>[0]) => lookUpMarking(marking, { faa }, pictureKind, typeName);

test('only an aircraft reading is ever read for text: never a car, lorry, bus, train or boat', () => {
  assert.equal(mayReadMarkings(jet), true);
  for (const family of ['road', 'rail', 'water'] as const) assert.equal(mayReadMarkings({ ...jet, family, kind: undefined }), false, family);
  assert.equal(mayReadMarkings(null), false);
  // Even handed text from a car, withMarking leaves a road reading untouched.
  const car: VehicleReading = { schema: 1, family: 'road', kind: 'car', source: 'clip', labelsVersion: 1 };
  assert.deepEqual(withMarking(car, [{ text: 'ZK301', confidence: 0.99 }], findMarkings, lookUp('car')), car);
});

test('registrations and serials are recognised in their own formats', () => {
  assert.deepEqual(findMarkings('G-EZAA'), [{ value: 'G-EZAA', format: 'uk-civil' }]);
  assert.deepEqual(findMarkings('gezaa'), [{ value: 'G-EZAA', format: 'uk-civil' }]);
  assert.deepEqual(findMarkings('EI-DCL'), [{ value: 'EI-DCL', format: 'irish-civil' }]);
  assert.deepEqual(findMarkings('N172SP'), [{ value: 'N172SP', format: 'us-civil' }]);
  assert.deepEqual(findMarkings('ZK301 ROYAL AIR FORCE'), [{ value: 'ZK301', format: 'uk-military' }]);
  assert.deepEqual(findMarkings('ZKЗO1 ZK3O1'), [{ value: 'ZK301', format: 'uk-military' }], 'O read for 0 in the digits');
  for (const text of ['NO STEP', 'N0123', 'NI23', 'ZC123', 'ZK30', 'G-EZA', 'RESCUE', 'EI-DCLX1']) assert.deepEqual(findMarkings(text), [], text);
});

test('car number plates are never kept, even if text from one reaches the reader', () => {
  for (const plate of ['AB12 CDE', 'ab12cde', 'LR69 XYZ', '12-D-3456', '191-KY-12']) {
    assert.deepEqual(findMarkings(plate), [], plate);
    assert.equal(looksLikeNumberPlate(plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase()), true, plate);
  }
});

test('an N-number found in the FAA copy gives its exact type, and the operator only for a company or government', () => {
  assert.deepEqual(lookUp(undefined)({ value: 'N172SP', format: 'us-civil' }), { type: 'CESSNA 172S', register: 'faa', exact: true });
  assert.deepEqual(lookUp(undefined)({ value: 'N737XA', format: 'us-civil' }), { type: 'BOEING 737-8', operator: 'UNITED STATES AIR FORCE', register: 'faa', exact: true });
  assert.equal(lookUp(undefined)({ value: 'N999ZZ', format: 'us-civil' }), null, 'unknown stays unknown');
});

test('a UK military serial names a type only from a known block and only when the picture agrees', () => {
  assert.deepEqual(lookUp('military-jet')({ value: 'ZK301', format: 'uk-military' }), { type: 'Eurofighter Typhoon', register: 'uk-military-blocks', exact: false, kind: 'military-jet' });
  assert.equal(lookUp('helicopter')({ value: 'ZK301', format: 'uk-military' }), null, 'a Typhoon serial on a picture of a helicopter is not believed');
  assert.equal(lookUp(undefined)({ value: 'ZK301', format: 'uk-military' }), null);
  assert.equal(lookUp('military-jet')({ value: 'ZK999', format: 'uk-military' }), null, 'a serial outside every block stays unknown');
  for (const block of UK_MILITARY_BLOCKS) assert.ok(typeName(block.type), block.type);
  // G- and EI- are recognised but never looked up: no licensed offline register.
  assert.equal(lookUp(undefined)({ value: 'G-EZAA', format: 'uk-civil' }), null);
});

test('what was read joins the reading, in plain words, searchable, and still checked when reopened', () => {
  const serial = withMarking(jet, [{ text: 'ROYAL AIR FORCE', confidence: 0.99 }, { text: 'ZK301', confidence: 0.97 }], findMarkings, lookUp('military-jet'));
  assert.equal(vehicleLabel(serial, labels, words), 'ZK301: Eurofighter Typhoon (probably)');
  assert.ok(vehicleSearchWords(serial, labels, [words]).includes('ZK301'));
  assert.deepEqual(validVehicleReading(JSON.parse(JSON.stringify(serial)), labels), serial);

  const civil = withMarking({ ...jet, kind: 'light-aircraft' }, [{ text: 'N172SP', confidence: 0.95 }], findMarkings, lookUp('light-aircraft'));
  assert.equal(vehicleLabel(civil, labels, words), 'N172SP: CESSNA 172S (from the register)');
  const usaf = withMarking({ ...jet, kind: 'airliner' }, [{ text: 'N737XA', confidence: 0.95 }], findMarkings, lookUp('airliner'));
  assert.equal(vehicleLabel(usaf, labels, words), 'N737XA: BOEING 737-8 (from the register), operated by UNITED STATES AIR FORCE');

  const unknown = withMarking(jet, [{ text: 'G-EZAA', confidence: 0.96 }], findMarkings, lookUp('military-jet'));
  assert.equal(vehicleLabel(unknown, labels, words), 'Military jet, type unknown, marked G-EZAA');

  // A doubtful read is not a marking.
  assert.deepEqual(withMarking(jet, [{ text: 'ZK301', confidence: 0.6 }], findMarkings, lookUp('military-jet')), jet);
  // A stored marking on a road vehicle, or a register match without a marking, is refused.
  assert.equal(validVehicleReading({ ...serial, family: 'road', kind: 'car' }, labels), null);
  assert.equal(validVehicleReading({ ...jet, registered: serial.registered }, labels), null);
});

test('text boxes and text decoding follow PaddleOCR', () => {
  assert.deepEqual(detectorSize(4000, 3000), { width: 960, height: 736 });
  assert.equal(recogniserWidth(200, 48), 200);
  assert.equal(recogniserWidth(100000, 10), 1280);
  // A 20 × 8 map with one strong patch: one box, scaled to the picture and grown a little.
  const map = new Float32Array(20 * 8);
  for (let y = 3; y < 5; y += 1) for (let x = 4; x < 12; x += 1) map[y * 20 + x] = 0.9;
  map[0] = 0.9; // a single speck is ignored
  const boxes = textBoxes(map, 20, 8, 200, 80);
  assert.equal(boxes.length, 1);
  assert.ok(boxes[0].x < 40 && boxes[0].x + boxes[0].width > 120 && boxes[0].y < 30 && boxes[0].y + boxes[0].height > 50);
  // Steps: Z, Z (repeat), blank, K, 3, 0, blank, 1 → "ZK301".
  const characters = ['Z', 'K', '3', '0', '1'];
  const steps = [1, 1, 0, 2, 3, 4, 0, 5];
  const scores = new Float32Array(steps.length * 6);
  steps.forEach((best, t) => { scores[t * 6 + best] = 0.95; });
  const read = decodeText(scores, steps.length, 6, characters);
  assert.equal(read.text, 'ZK301');
  assert.ok(Math.abs(read.confidence - 0.95) < 1e-6);
});
