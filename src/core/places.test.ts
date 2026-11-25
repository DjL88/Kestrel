import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import curated from '../assets/places/curated.json' with { type: 'json' };
import { countryName, curatedTags, distanceKm, nearestPlace, placeTags, readPlaceTable } from './places';

/** A table in the app's file format, from rows of [latitude, longitude, id, region, name]. */
function tableFile(rows: [number, number, number, number, string][], regions: string[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const regionBytes = encoder.encode(regions.join('\n'));
  const nameBytes = encoder.encode(rows.map((row) => row[4]).join('\n'));
  const n = rows.length;
  const buffer = new ArrayBuffer(12 + n * 14 + 4 + regionBytes.length + 4 + nameBytes.length);
  const view = new DataView(buffer);
  [75, 71, 78, 49].forEach((byte, i) => view.setUint8(i, byte));
  view.setUint32(4, n, true);
  view.setUint32(8, regions.length, true);
  let at = 12;
  for (const row of rows) { view.setInt32(at, Math.round(row[0] * 1e5), true); at += 4; }
  for (const row of rows) { view.setInt32(at, Math.round(row[1] * 1e5), true); at += 4; }
  for (const row of rows) { view.setUint32(at, row[2], true); at += 4; }
  for (const row of rows) { view.setUint16(at, row[3], true); at += 2; }
  for (const bytes of [regionBytes, nameBytes]) {
    view.setUint32(at, bytes.length, true); at += 4;
    new Uint8Array(buffer, at, bytes.length).set(bytes); at += bytes.length;
  }
  return buffer;
}

const small = readPlaceTable(tableFile([
  [52.5906, -3.8536, 2643101, 0, 'Machynlleth'],
  [52.7439, -3.8850, 2651279, 0, 'Dolgellau'],
  [64.1355, -21.8954, 3413829, 1, 'Reykjavík'],
], ['GB\tWales', 'IS\tCapital Region']));

test('the nearest place within ten kilometres names the photo, with its region and country', () => {
  const tags = placeTags(small, 52.60, -3.84);
  assert.deepEqual(tags.map((tag) => [tag.id, tag.name]), [
    ['place.gn.2643101', 'Machynlleth'], ['place.region.gb-wales', 'Wales'], ['place.country.gb', undefined],
  ]);
  assert.ok(tags.every((tag) => tag.facet === 'place' && tag.source === 'gps'));
});

test('further than ten kilometres: region and country only; far out at sea: nothing', () => {
  assert.deepEqual(placeTags(small, 52.45, -3.6).map((tag) => tag.id), ['place.region.gb-wales', 'place.country.gb']);
  assert.deepEqual(placeTags(small, 50, -15), []);
});

test('accented names and regions are kept; ids stay plain', () => {
  const tags = placeTags(small, 64.14, -21.9);
  assert.equal(tags[0].name, 'Reykjavík');
  assert.equal(tags[1].id, 'place.region.is-capital-region');
});

test('a damaged table is refused rather than half used', () => {
  assert.throws(() => readPlaceTable(new ArrayBuffer(8)));
  const good = tableFile([[1, 1, 1, 0, 'A']], ['GB\tWales']);
  assert.throws(() => readPlaceTable(good.slice(0, good.byteLength - 1)));
});

test('country names come from the platform in the person\'s language', () => {
  assert.equal(countryName('place.country.gb', 'en-GB'), 'United Kingdom');
  assert.equal(countryName('place.country.de', 'fr'), 'Allemagne');
  assert.equal(countryName('place.gn.1', 'en-GB'), undefined);
});

test('curated photo spots cover only their own circle', () => {
  const spots = curated.spots;
  const cadWest = spots.find((spot) => spot.id === 'landmark.mach-loop.cad-west')!;
  const at = curatedTags(spots, cadWest.latitude, cadWest.longitude).map((tag) => tag.name);
  assert.deepEqual(at, ['Mach Loop', 'Cad West']);
  assert.deepEqual(curatedTags(spots, 51.5, -0.12), []);
  assert.ok(spots.every((spot) => /^landmark\./.test(spot.id) && spot.radiusKm > 0 && spot.radiusKm <= 20));
});

test('the committed GeoNames table names Machynlleth from a position in the town', () => {
  const file = readFileSync(new URL('../../public/places/geonames-cities1000.bin', import.meta.url));
  const table = readPlaceTable(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  assert.ok(table.names.length > 100_000);
  const nearest = nearestPlace(table, 52.5906, -3.8536);
  assert.ok(nearest && nearest.km < 2);
  assert.equal(table.names[nearest.row], 'Machynlleth');
  assert.ok(distanceKm(52.5906, -3.8536, 52.7439, -3.885) > 15);
});
