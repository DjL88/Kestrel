import { test } from 'node:test';
import assert from 'node:assert/strict';
import taxonomy from '../assets/subject/taxonomy.json' with { type: 'json' };
import gateFile from '../assets/subject/vectors.json' with { type: 'json' };
import vectorFile from '../assets/vehicle/vectors.json' with { type: 'json' };
import { gateVectors } from './categoryGate';
import { routeSubject, type SubjectCategory } from './subjectRouter';
import { VEHICLE_LABELS as labels } from './vehicleLabels';
import { readVehicle, validVehicleReading, vehicleLabel, vehicleSearchWords, vehicleVectors, type VehicleReading } from './vehicleRecognition';
import { localiseFor } from '../i18n/localise';
import { source } from '../i18n/areas/vehicles/source';
import { vehiclesArea } from '../i18n/areas/vehicles';

const categories = taxonomy.categories as SubjectCategory[];
const gate = gateVectors(gateFile, categories);
const vectors = vehicleVectors(vectorFile, labels);
const kindAt = (id: string) => vectors.kinds[labels.kinds.findIndex((kind) => kind.id === id)];
const typeAt = (id: string) => vectors.types[labels.types.findIndex((entry) => entry.id === id)];
const categoryAt = (id: string) => gate[categories.findIndex((category) => category.id === id)];
/** The whole chain on one picture embedding: the gate first, then the vehicle reading on the same numbers. */
const read = (picture: Float32Array) => readVehicle(picture, routeSubject(picture, gate, categories), labels, vectors);
const mix = (...parts: Float32Array[]) => Float32Array.from(parts[0], (_, i) => parts.reduce((sum, part) => sum + part[i], 0));
const words = source;
const german = localiseFor(source, vehiclesArea.translations as never, 'de');

test('the committed vectors cover every kind and type, and every type belongs to a real kind', () => {
  assert.equal(vectors.kinds.length, labels.kinds.length);
  assert.equal(vectors.types.length, labels.types.length);
  for (const entry of labels.types) assert.ok(labels.kinds.some((kind) => kind.id === entry.kind && !kind.decoy), entry.id);
  assert.throws(() => vehicleVectors({ ...vectorFile, labelsVersion: 999 }, labels), RangeError);
  // Every kind the app can name has words in British English.
  for (const kind of labels.kinds.filter((entry) => !entry.decoy)) assert.ok((source.kinds as Record<string, string>)[kind.id], kind.id);
});

test('a picture that looks like a Typhoon reads as a military jet, probably a Eurofighter Typhoon', () => {
  // A picture exactly like the Typhoon description (real photos rarely get this far: see VEHICLE_THRESHOLDS).
  const reading = read(mix(typeAt('typhoon'), typeAt('typhoon'), typeAt('typhoon'), kindAt('military-jet')));
  assert.equal(reading?.family, 'air');
  assert.equal(reading?.kind, 'military-jet');
  assert.equal(reading?.type, 'typhoon');
  assert.equal(reading?.source, 'clip');
  assert.equal(vehicleLabel(reading!, labels, words), 'Military jet: Eurofighter Typhoon (probably)');
});

test('a picture halfway between two jets keeps the kind and says the type is unknown', () => {
  const reading = read(mix(kindAt('military-jet'), kindAt('military-jet'), typeAt('typhoon'), typeAt('f-35')));
  assert.equal(reading?.kind, 'military-jet');
  assert.equal(reading?.type, undefined, 'never a guess stated as fact');
  assert.equal(vehicleLabel(reading!, labels, words), 'Military jet, type unknown');
});

test('a picture halfway between a helicopter and a military jet says only "Aircraft, type unknown"', () => {
  const reading = read(mix(kindAt('helicopter'), kindAt('military-jet')));
  assert.equal(reading?.family, 'air');
  assert.equal(reading?.kind, undefined);
  assert.equal(vehicleLabel(reading!, labels, words), 'Aircraft, type unknown');
});

test('kinds without a type list read as the kind, probably', () => {
  const reading = read(kindAt('bus'));
  assert.equal(reading?.kind, 'bus');
  assert.equal(vehicleLabel(reading!, labels, words), 'Bus (probably)');
});

test('not a vehicle, or a vehicle the app does not tag, gives no reading at all', () => {
  assert.equal(read(categoryAt('bird')), null, 'a bird is never read as an aircraft');
  assert.equal(read(categoryAt('mountain')), null);
  assert.equal(read(kindAt('bicycle')), null);
  assert.equal(read(kindAt('tractor')), null);
  // Without the gate's answer nothing is read.
  assert.equal(readVehicle(kindAt('car'), null, labels, vectors), null);
  assert.equal(readVehicle(new Float32Array(512).fill(Number.NaN), routeSubject(kindAt('car'), gate, categories), labels, vectors), null);
});

test('a stored reading is checked before it is shown', () => {
  const good: VehicleReading = { schema: 1, family: 'air', kind: 'military-jet', type: 'hawk', source: 'clip', labelsVersion: 1 };
  assert.deepEqual(validVehicleReading(good, labels), good);
  for (const bad of [null, 'jet', { ...good, schema: 2 }, { ...good, family: 'space' }, { ...good, kind: 'spaceship' },
    { ...good, type: 'b737' }, { ...good, family: 'road' }, { ...good, kind: 'bicycle', type: undefined }, { ...good, source: 'gemini' }]) {
    assert.equal(validVehicleReading(bad, labels), null, JSON.stringify(bad));
  }
});

test('a person’s own choice is shown without “probably”', () => {
  const chosen: VehicleReading = { schema: 1, family: 'air', kind: 'military-transport', type: 'a400m', source: 'person', labelsVersion: 1 };
  assert.equal(vehicleLabel(chosen, labels, words), 'Military transport: Airbus A400M Atlas');
});

test('the words follow the language, and the photo can be found in that language and in English', () => {
  const reading: VehicleReading = { schema: 1, family: 'air', kind: 'helicopter', type: 'chinook', source: 'clip', labelsVersion: 1 };
  assert.equal(vehicleLabel(reading, labels, german), 'Hubschrauber: Boeing Chinook (wahrscheinlich)');
  const found = vehicleSearchWords(reading, labels, [german, words]);
  for (const word of ['Hubschrauber', 'Helicopter', 'Luftfahrzeug', 'Aircraft', 'Boeing Chinook']) assert.ok(found.includes(word), word);
});
