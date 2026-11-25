import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declinePhotoTag, isTagId, looksLikeNumberPlate as storePlate, mergePhotoTags, photoTagsOf } from './photoTags';
import { looksLikeNumberPlate } from './aircraftRegistration';
import type { PhotoFrame } from './types';
import { VEHICLE_LABELS as labels } from './vehicleLabels';
import type { VehicleReading } from './vehicleRecognition';
import { syncAllVehicleTags, syncVehicleTags, vehicleTagWords, vehicleTags } from './vehicleTags';
import { source as words } from '../i18n/areas/vehicles/source';
import { photoTagEnglishLabel } from '../i18n/areas/photoTags';

const frame = (patch: Partial<PhotoFrame> = {}): PhotoFrame => ({
  id: 'f1', stableKey: 'k1', filename: 'MACH-001.NEF', sequenceIndex: 1, decision: 'unreviewed',
  burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file', ...patch,
});
const serial: VehicleReading = {
  schema: 1, family: 'air', kind: 'military-jet', source: 'clip', labelsVersion: 3,
  marking: { value: 'ZK301', format: 'uk-military', confidence: 0.97 }, registered: { type: 'Eurofighter Typhoon', register: 'uk-military-blocks', exact: false },
};

test('there is one number-plate check, shared with the tag store', () => {
  assert.equal(looksLikeNumberPlate, storePlate);
});

test('a reading becomes valid store tags: words for kinds and families, proper names as they are, guesses hedged', () => {
  const tags = vehicleTags(serial, labels);
  assert.deepEqual(tags.map((tag) => tag.id), ['vehicle.family.air', 'vehicle.kind.military-jet', 'marking.serial.zk301', 'vehicle.registered.eurofighter-typhoon']);
  assert.ok(tags.every((tag) => isTagId(tag.id)));
  assert.equal(tags.find((tag) => tag.id === 'vehicle.kind.military-jet')!.hedged, true);
  assert.equal(tags.find((tag) => tag.facet === 'marking')!.source, 'ocr');
  assert.equal(tags.find((tag) => tag.id.startsWith('vehicle.registered'))!.hedged, true, 'a serial block is "probably"');
  const ferry = vehicleTags({ schema: 1, family: 'water', kind: 'ferry', source: 'clip', labelsVersion: 3, marking: { value: 'PRIDE OF KENT', format: 'hull-name', confidence: 0.95 }, imo: 'IMO 9074729' }, labels);
  assert.deepEqual(ferry.filter((tag) => tag.facet === 'marking').map((tag) => [tag.id, tag.name]), [['marking.name.pride-of-kent', 'PRIDE OF KENT'], ['marking.imo.9074729', 'IMO 9074729']]);
  const race = vehicleTags({ schema: 1, family: 'road', kind: 'racing-motorbike', source: 'clip', labelsVersion: 3, marking: { value: '46', format: 'race-number', confidence: 0.95 } }, labels);
  assert.ok(race.some((tag) => tag.id === 'marking.race.46'));
});

test('the person’s choice is not hedged; a carried reading names its frame; a held reading gives no tags', () => {
  const mine = vehicleTags({ schema: 1, family: 'air', kind: 'military-transport', type: 'a400m', source: 'person', labelsVersion: 3 }, labels);
  assert.ok(mine.every((tag) => !tag.hedged && tag.source === 'curated'));
  assert.equal(mine.find((tag) => tag.id === 'vehicle.type.a400m')!.name, 'Airbus A400M Atlas');
  const carried = vehicleTags({ ...serial, carriedFrom: 'f0' }, labels);
  assert.ok(carried.every((tag) => tag.source === 'burst' && tag.fromFrameId === 'f0'));
  assert.deepEqual(vehicleTags({ schema: 1, family: 'air', source: 'clip', labelsVersion: 3, guardian: 'held', heldFamily: true }, labels), []);
});

test('tags follow the reading, never touch another lane, and stay removed once the person removes one', () => {
  const scene = mergePhotoTags(frame(), 'scene', ['light'], [{ id: 'light.golden-hour', facet: 'light', source: 'computed' }], 'scene-1');
  const tagged = syncVehicleTags({ ...scene, vehicle: serial }, labels);
  assert.ok(photoTagsOf(tagged).some((tag) => tag.id === 'light.golden-hour'), 'the scene lane’s tag stays');
  assert.equal(photoTagsOf(tagged, 'marking').length, 1);
  assert.equal(syncVehicleTags(tagged, labels), tagged, 'syncing again changes nothing');
  // "Not a vehicle": the lane's tags go; the scene's stay.
  const declined = syncVehicleTags({ ...tagged, vehicle: undefined, vehicleDeclined: true }, labels);
  assert.deepEqual(photoTagsOf(declined).map((tag) => tag.id), ['light.golden-hour']);
  // A tag the person removed is never put back by a later sync.
  const removed = declinePhotoTag(tagged, 'marking.serial.zk301');
  assert.ok(!photoTagsOf(syncVehicleTags(removed, labels)).some((tag) => tag.id === 'marking.serial.zk301'));
  // A photo with no reading and no vehicle tags is left exactly as it was.
  const plain = frame();
  assert.deepEqual(syncAllVehicleTags([plain], labels)[0], plain);
});

test('kinds and families have words in the person’s language and in English, through the photo tags area', () => {
  assert.equal(vehicleTagWords('vehicle.kind.military-jet', words), 'Military jet');
  assert.equal(vehicleTagWords('vehicle.family.water', words), 'Boat');
  assert.equal(vehicleTagWords('vehicle.type.typhoon', words), undefined, 'types are proper names, carried in name');
  assert.equal(photoTagEnglishLabel('vehicle.kind.racing-car'), 'Racing car');
});
