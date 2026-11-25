import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

interface ShippedLabel { common: string; scientific: string; group: string; scale: number; vector: string }

const shipped = JSON.parse(readFileSync(new URL('../assets/species/uk.json', import.meta.url), 'utf8')) as {
  dimensions: number; labels: ShippedLabel[];
};
const rows = readFileSync(new URL('../../tools/species/species-uk.csv', import.meta.url), 'utf8')
  .trim().split(/\r?\n/).slice(1).map((line) => {
    const [group, common, scientific] = line.split(',');
    return { group, common, scientific };
  });

test('the shipped species vectors are generated from the current species list, row for row', () => {
  assert.deepEqual(
    shipped.labels.map(({ group, common, scientific }) => ({ group, common, scientific })),
    rows,
    'regenerate src/assets/species/uk.json with tools/species/make_labels.py after editing species-uk.csv',
  );
});

test('every shipped vector has the model\'s full width and a usable scale', () => {
  for (const label of shipped.labels) {
    assert.equal(Buffer.from(label.vector, 'base64').length, shipped.dimensions, label.common);
    assert.ok(label.scale > 0 && Number.isFinite(label.scale), label.common);
  }
});

// Owner's most frequent subject (P0.4): without it the model can only offer a wrong bird or nothing.
test('the White-throated dipper can be named', () => {
  assert.ok(shipped.labels.some((label) => label.scientific === 'Cinclus cinclus' && label.common === 'White-throated dipper' && label.group === 'bird'));
});
