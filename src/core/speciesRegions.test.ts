import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SPECIES_REGIONS, normaliseRegions, readSpeciesRegions, worldLabelsForRegions, writeSpeciesRegions } from './speciesRegions';
import type { SpeciesLabel } from './speciesMatch';

const label = (scientific: string, regions?: string[]): SpeciesLabel => ({ common: scientific, scientific, group: 'bird', vector: '', scale: 1, regions });

describe('species regions', () => {
  it('falls back to the default for empty or unknown choices, never to nothing', () => {
    assert.deepEqual(normaliseRegions([]), [...DEFAULT_SPECIES_REGIONS]);
    assert.deepEqual(normaliseRegions(['mars', 4]), [...DEFAULT_SPECIES_REGIONS]);
    assert.deepEqual(normaliseRegions(['nearctic', 'nearctic', 'x']), ['nearctic']);
  });

  it('keeps only names that can occur in the chosen regions, plus unknown ranges', () => {
    const world = [label('A a', ['PAL']), label('B b', ['NA']), label('C c', ['SA', 'PAL']), label('D d', []), label('E e'), label('F f', ['MA'])];
    assert.deepEqual(worldLabelsForRegions(world, ['palearctic']).map((l) => l.scientific), ['A a', 'C c', 'D d', 'E e']);
    assert.deepEqual(worldLabelsForRegions(world, ['nearctic', 'oceans']).map((l) => l.scientific), ['B b', 'D d', 'E e', 'F f']);
  });

  it('does not repeat names the app already ships', () => {
    const world = [label('Milvus milvus', ['PAL']), label('Falco peregrinus', ['PAL'])];
    assert.deepEqual(worldLabelsForRegions(world, ['palearctic'], new Set(['milvus milvus'])).map((l) => l.scientific), ['Falco peregrinus']);
  });

  it('round-trips the saved choice and survives broken storage', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    writeSpeciesRegions(['oriental', 'bogus'], storage);
    assert.deepEqual(readSpeciesRegions(storage), ['oriental']);
    assert.deepEqual(readSpeciesRegions({ getItem: () => '{not json' }), [...DEFAULT_SPECIES_REGIONS]);
    assert.doesNotThrow(() => writeSpeciesRegions(['oriental'], { setItem: () => { throw new Error('full'); } }));
  });
});
