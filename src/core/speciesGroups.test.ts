import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { SPECIES_REGIONS } from './speciesRegions';
import { decodeVector, kindFor, type SpeciesLabel } from './speciesMatch';

/** Each extra species list beside the model, with a species every list must hold and its expected kind of group. */
const LISTS: { file: string; group: SpeciesLabel['group']; licence: RegExp; example: string; maxBytes: number }[] = [
  { file: 'species-reptiles.json', group: 'reptile', licence: /Reptile Database.*CC BY 4\.0/, example: 'Lacerta agilis', maxBytes: 12_000_000 },
  { file: 'species-amphibians.json', group: 'amphibian', licence: /GBIF Backbone.*CC BY 4\.0/, example: 'Bufo bufo', maxBytes: 10_000_000 },
  { file: 'species-odonata.json', group: 'insect', licence: /World Odonata List.*CC BY 4\.0/, example: 'Calopteryx virgo', maxBytes: 7_000_000 },
  { file: 'species-lepidoptera.json', group: 'insect', licence: /Fauna Europaea.*CC BY 4\.0/, example: 'Vanessa atalanta', maxBytes: 10_000_000 },
];

const codes = new Set(SPECIES_REGIONS.flatMap((region) => region.codes));

for (const list of LISTS) {
  const path = `public/models/${list.file}`;
  test(`${list.file}: the device model's 512 numbers, attribution kept, regions the app knows`, { skip: !existsSync(path) && 'not added yet' }, () => {
    const file = JSON.parse(readFileSync(path, 'utf8')) as { dimensions: number; model: string; template: string; attribution: string; labels: SpeciesLabel[] };
    assert.equal(file.dimensions, 512, 'must match the BioCLIP v1 image model every device ships');
    assert.equal(file.model, 'ViT-B-16');
    assert.equal(file.template, 'a photo of {scientific}, {common}');
    assert.match(file.attribution, list.licence);
    assert.ok(statSync(path).size < list.maxBytes, `${list.file} is ${statSync(path).size} bytes`);
    const example = file.labels.find((label) => label.scientific === list.example);
    assert.ok(example, `${list.example} is in the list`);
    assert.equal(decodeVector(example!).length, 512);
    assert.equal(kindFor(example!), 'wildlife');
    for (const label of file.labels) {
      assert.equal(label.group, list.group);
      assert.match(label.scientific, /^[A-Z][a-z]+ [a-z-]+$/);
      for (const code of label.regions ?? []) assert.ok(codes.has(code), `${label.scientific}: unknown region ${code}`);
    }
  });
}
