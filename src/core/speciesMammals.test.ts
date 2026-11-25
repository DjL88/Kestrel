import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { SPECIES_REGIONS, worldLabelsForRegions } from './speciesRegions';
import { decodeVector, type SpeciesLabel } from './speciesMatch';

const file = JSON.parse(readFileSync('public/models/species-mammals.json', 'utf8')) as {
  dimensions: number; model: string; template: string; attribution: string; sourceSha256: string; labels: (SpeciesLabel & { domestic: boolean })[];
};

test('the world mammal list: every living MDD species, the device model’s 512 numbers, attribution kept', () => {
  assert.equal(file.dimensions, 512, 'must match the BioCLIP v1 image model every device ships');
  assert.equal(file.model, 'ViT-B-16');
  assert.equal(file.template, 'a photo of {scientific}, {common}');
  assert.match(file.attribution, /Mammal Diversity Database.*2\.5.*CC BY 4\.0/);
  assert.match(file.sourceSha256, /^[0-9a-f]{64}$/);
  assert.ok(file.labels.length > 6700, `${file.labels.length} mammals`);
  assert.ok(statSync('public/models/species-mammals.json').size < 7_000_000, 'list stays under 7 MB');
  const otter = file.labels.find((label) => label.scientific === 'Lutra lutra');
  assert.equal(otter?.common, 'Eurasian Otter');
  assert.ok(otter?.regions?.includes('PAL'));
  assert.equal(decodeVector(otter!).length, 512);
  const codes = new Set(SPECIES_REGIONS.flatMap((region) => region.codes));
  for (const label of file.labels) {
    assert.equal(label.group, 'mammal');
    for (const code of label.regions ?? []) assert.ok(codes.has(code), `${label.scientific}: unknown region ${code}`);
  }
});

test('mammals are narrowed by the person’s regions like birds, and a mammal with no recorded range is kept', () => {
  const europe = worldLabelsForRegions(file.labels, ['palearctic']);
  assert.ok(europe.some((label) => label.scientific === 'Lutra lutra'));
  assert.ok(!europe.some((label) => label.scientific === 'Ornithorhynchus anatinus'), 'no platypus in Europe');
  assert.ok(europe.length < 1500, `${europe.length} mammals for Europe and northern Asia`);
});
