import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { buildSpeciesNameIndex, displaySpeciesName, type SpeciesNameTable } from './speciesNames';

const ioc: SpeciesNameTable = {
  source: 'test', attribution: 'test', language: 'de',
  names: [['Cinclus cinclus', 'White-throated Dipper', 'Wasseramsel'], ['Lagopus scotica', 'Red Grouse', null]],
};

test('a stored English or scientific name is shown in the person’s language, else as the scientific name', () => {
  const de = buildSpeciesNameIndex('de', [ioc]);
  assert.deepEqual(displaySpeciesName('White-throated Dipper', de), { name: 'Wasseramsel', kind: 'local' });
  assert.deepEqual(displaySpeciesName('white-throated dipper', de), { name: 'Wasseramsel', kind: 'local' });
  assert.deepEqual(displaySpeciesName('Cinclus cinclus', de), { name: 'Wasseramsel', kind: 'local' });
  assert.deepEqual(displaySpeciesName('Red Grouse', de), { name: 'Lagopus scotica', kind: 'scientific' }, 'no local name: scientific, never a guess');
  assert.deepEqual(displaySpeciesName('Kleiber am Futterhaus', de), { name: 'Kleiber am Futterhaus', kind: 'as-stored' }, 'unknown stays as typed');
  assert.deepEqual(displaySpeciesName('Red Grouse', undefined), { name: 'Red Grouse', kind: 'as-stored' }, 'names not loaded yet');
  const enUS = buildSpeciesNameIndex('en-US', [ioc]);
  assert.equal(displaySpeciesName('Cinclus cinclus', enUS).name, 'White-throated Dipper');
});

test('another source laid first wins, so the owner’s own database can replace IOC names', () => {
  const owner: SpeciesNameTable = { source: 'owner', attribution: 'owner', language: 'de', names: [['Lagopus scotica', 'Red Grouse', 'Schottisches Moorschneehuhn']] };
  const index = buildSpeciesNameIndex('de', [owner, ioc]);
  assert.equal(displaySpeciesName('Red Grouse', index).name, 'Schottisches Moorschneehuhn');
  assert.equal(displaySpeciesName('White-throated Dipper', index).name, 'Wasseramsel');
});

test('the shipped name files: every species indexed, White-throated Dipper named in every IOC language, sources recorded', () => {
  const dir = 'public/models/species-names/';
  const index = JSON.parse(readFileSync(`${dir}index.json`, 'utf8')) as { species: [string, string][]; sourceSha256: string; attribution: string };
  assert.ok(index.species.length > 11000, 'the whole world list is indexed');
  assert.ok(index.species.some(([scientific, english]) => scientific === 'Cinclus cinclus' && english === 'White-throated Dipper'));
  assert.match(index.attribution, /IOC World Bird List.*CC BY 4\.0/);
  assert.match(index.sourceSha256, /^[0-9a-f]{64}$/);
  const dipper: Record<string, string> = {};
  for (const code of ['da', 'nl', 'fi', 'fr', 'de', 'it', 'nb', 'pt', 'es', 'sv', 'is']) {
    const file = JSON.parse(readFileSync(`${dir}${code}.json`, 'utf8')) as { names: Record<string, string>; attribution: string };
    assert.match(file.attribution, /CC BY 4\.0/, `${code}: attribution kept`);
    dipper[code] = file.names['Cinclus cinclus'];
    assert.ok(dipper[code], `${code}: White-throated Dipper has a name`);
    assert.ok(statSync(`${dir}${code}.json`).size < 600_000, `${code}: file stays under 0.6 MB`);
  }
  assert.equal(dipper.de, 'Wasseramsel');
  assert.ok(statSync(`${dir}index.json`).size < 900_000, 'index (birds and mammals) stays under 0.9 MB');
});
