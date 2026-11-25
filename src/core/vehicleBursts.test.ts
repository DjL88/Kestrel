import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PhotoFrame } from './types';
import { carryVehicleReadings, correctVehicle } from './vehicleBursts';
import { VEHICLE_LABELS as labels } from './vehicleLabels';
import type { VehicleReading } from './vehicleRecognition';

const frame = (id: string, patch: Partial<PhotoFrame> = {}): PhotoFrame => ({
  id, stableKey: `k-${id}`, filename: `${id}.NEF`, sequenceIndex: 1, decision: 'unreviewed',
  burstGroupId: 'pass-1', burstIndex: 0, burstCount: 4, exif: {}, isDemo: false, sourceKind: 'file', ...patch,
});
const clip = (patch: Partial<VehicleReading> = {}): VehicleReading => ({ schema: 1, family: 'air', kind: 'military-jet', source: 'clip', labelsVersion: 1, kindProbability: 0.7, ...patch });
const serial = clip({ marking: { value: 'ZK301', format: 'uk-military', confidence: 0.97 }, registered: { type: 'Eurofighter Typhoon', register: 'uk-military-blocks', exact: false } });

test('the best reading of a burst is carried to every frame of it, marked as carried', () => {
  const frames = [frame('a', { vehicle: clip() }), frame('b', { vehicle: serial }), frame('c'), frame('d', { burstGroupId: 'pass-2' })];
  const out = carryVehicleReadings(frames, labels);
  assert.deepEqual(out[0].vehicle, { ...serial, carriedFrom: 'b' }, 'a serial lookup beats a look-alike guess');
  assert.deepEqual(out[1].vehicle, serial);
  assert.deepEqual(out[2].vehicle, { ...serial, carriedFrom: 'b' });
  assert.equal(out[3].vehicle, undefined, 'another burst is untouched');
  assert.deepEqual(carryVehicleReadings(out, labels), out, 'carrying twice changes nothing');
});

test('a frame the person named keeps its name; a held or doubtful reading is never carried', () => {
  const mine = clip({ kind: 'military-transport', type: 'a400m', source: 'person' });
  const out = carryVehicleReadings([frame('a', { vehicle: serial }), frame('b', { vehicle: mine })], labels);
  assert.deepEqual(out[0].vehicle, { ...mine, carriedFrom: 'b' }, 'the person’s choice wins for the burst');
  assert.deepEqual(out[1].vehicle, mine);
  const held = carryVehicleReadings([frame('a', { vehicle: clip({ guardian: 'held' }) }), frame('b')], labels);
  assert.equal(held[1].vehicle, undefined);
  const split = carryVehicleReadings([frame('a', { vehicle: serial }), frame('b', { burstUngrouped: true })], labels);
  assert.equal(split[1].vehicle, undefined, 'a burst the person split is not treated as one');
  const declined = carryVehicleReadings([frame('a', { vehicle: serial }), frame('b', { vehicleDeclined: true })], labels);
  assert.equal(declined[1].vehicle, undefined, 'a frame marked "not a vehicle" never gets one back');
});

test('one correction fixes the whole burst, or just one photo', () => {
  const frames = [frame('a', { vehicle: serial }), frame('b', { vehicle: { ...serial, carriedFrom: 'a' } }), frame('c'), frame('x', { burstGroupId: 'pass-2' })];
  const all = correctVehicle(frames, 'b', { kind: 'military-jet', type: 'hawk' }, true, labels);
  for (const id of ['a', 'b', 'c']) {
    const reading = all.find((entry) => entry.id === id)!.vehicle!;
    assert.equal(reading.source, 'person');
    assert.equal(reading.type, 'hawk');
    assert.equal(reading.registered, undefined, 'a lookup that disagreed is dropped');
  }
  assert.equal(all[0].vehicle!.marking?.value, 'ZK301', 'the text read from the aircraft is kept');
  assert.equal(all[3].vehicle, undefined);
  const one = correctVehicle(frames, 'b', { kind: 'helicopter' }, false, labels);
  assert.equal(one[1].vehicle!.kind, 'helicopter');
  assert.equal(one[0].vehicle!.kind, 'military-jet');
});

test('"not a vehicle" removes the reading for good; nonsense choices change nothing', () => {
  const frames = [frame('a', { vehicle: serial }), frame('b', { vehicle: { ...serial, carriedFrom: 'a' } })];
  const out = correctVehicle(frames, 'a', 'not-a-vehicle', true, labels);
  assert.ok(out.every((entry) => entry.vehicle === undefined && entry.vehicleDeclined === true));
  assert.equal(correctVehicle(frames, 'a', { kind: 'spaceship' }, true, labels), frames);
  assert.equal(correctVehicle(frames, 'a', { kind: 'car', type: 'hawk' }, true, labels), frames, 'a type of a different kind');
  assert.equal(correctVehicle(frames, 'a', { kind: 'bicycle' }, true, labels), frames, 'decoys are not offered');
  // Choosing a road kind for an aircraft photo drops the aircraft marking: text is never kept on a road vehicle.
  assert.equal(correctVehicle(frames, 'a', { kind: 'car' }, false, labels)[0].vehicle!.marking, undefined);
});
