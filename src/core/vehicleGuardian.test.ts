import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardVehicle, guardianQuestion, readYesNo } from './vehicleGuardian';
import { VEHICLE_LABELS as labels } from './vehicleLabels';
import { validVehicleReading, vehicleLabel, type VehicleReading } from './vehicleRecognition';
import { source as words } from '../i18n/areas/vehicles/source';

const ask = (reading: VehicleReading) => guardianQuestion(reading, labels, words.kinds, words.families)!;
const typhoon: VehicleReading = { schema: 1, family: 'air', kind: 'military-jet', type: 'typhoon', typeProbability: 0.8, source: 'clip', labelsVersion: 1 };

test('only a plain yes or no counts', () => {
  assert.equal(readYesNo('Yes.'), 'agrees');
  assert.equal(readYesNo('no'), 'disagrees');
  for (const answer of ['Yes, but it might be a Hawk', 'Maybe', 'I cannot tell', '', undefined, 'Nope']) assert.equal(readYesNo(answer), 'unsure', String(answer));
});

test('the question is about the most specific claim, in plain ASCII', () => {
  assert.equal(ask(typhoon).text, 'Is the vehicle in this photograph a Eurofighter Typhoon? Answer yes or no.');
  assert.equal(ask({ ...typhoon, type: undefined }).text, 'Is there a military jet in this photograph? Answer yes or no.');
  assert.equal(ask({ schema: 1, family: 'air', source: 'clip', labelsVersion: 1 }).text, 'Is there an aircraft in this photograph? Answer yes or no.');
  assert.equal(ask({ schema: 1, family: 'road', kind: 'car', type: 'skoda-octavia', source: 'clip', labelsVersion: 1 }).text,
    'Is the vehicle in this photograph a Skoda Octavia? Answer yes or no.');
  const serial: VehicleReading = { ...typhoon, type: undefined, marking: { value: 'ZK301', format: 'uk-military', confidence: 0.97 }, registered: { type: 'Eurofighter Typhoon', register: 'uk-military-blocks', exact: false } };
  assert.equal(ask(serial).level, 'type');
  // A name the person chose, or a reading already checked, is not asked about again.
  assert.equal(guardianQuestion({ ...typhoon, source: 'person' }, labels, words.kinds, words.families), null);
  assert.equal(guardianQuestion({ ...typhoon, guardian: 'agreed' }, labels, words.kinds, words.families), null);
});

test('agreement adds nothing: a "probably" stays "probably"', () => {
  const agreed = guardVehicle(typhoon, ask(typhoon), 'agrees');
  assert.equal(agreed.guardian, 'agreed');
  assert.equal(vehicleLabel(agreed, labels, words), 'Military jet: Eurofighter Typhoon (probably)');
  assert.deepEqual(guardVehicle(typhoon, ask(typhoon), 'unsure'), typhoon, 'doubt changes nothing');
});

test('a "no" withdraws exactly the claim asked about, one step at a time, and never adds one', () => {
  const noType = guardVehicle(typhoon, ask(typhoon), 'disagrees');
  assert.equal(noType.type, undefined);
  assert.equal(noType.kind, 'military-jet');
  assert.equal(vehicleLabel(noType, labels, words), 'Military jet, type unknown');

  const jet = { ...typhoon, type: undefined };
  const noKind = guardVehicle(jet, ask(jet), 'disagrees');
  assert.equal(noKind.kind, undefined);
  assert.equal(vehicleLabel(noKind, labels, words), 'Aircraft, type unknown');

  const aircraft: VehicleReading = { schema: 1, family: 'air', source: 'clip', labelsVersion: 1 };
  const noFamily = guardVehicle(aircraft, ask(aircraft), 'disagrees');
  assert.equal(noFamily.heldFamily, true);
  assert.equal(vehicleLabel(noFamily, labels, words), 'Aircraft? Needs your review');

  const serial: VehicleReading = { ...jet, marking: { value: 'ZK301', format: 'uk-military', confidence: 0.97 }, registered: { type: 'Eurofighter Typhoon', register: 'uk-military-blocks', exact: false } };
  const noSerialType = guardVehicle(serial, ask(serial), 'disagrees');
  assert.equal(noSerialType.registered, undefined);
  assert.equal(vehicleLabel(noSerialType, labels, words), 'Military jet, type unknown, marked ZK301', 'the text read stays; the lookup is withdrawn');

  for (const reading of [noType, noKind, noFamily, noSerialType]) assert.deepEqual(validVehicleReading(JSON.parse(JSON.stringify(reading)), labels), reading);
  assert.deepEqual(guardVehicle({ ...typhoon, source: 'person' }, ask(typhoon), 'disagrees'), { ...typhoon, source: 'person' });
});
