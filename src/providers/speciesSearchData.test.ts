import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSpeciesSearchData, resetSpeciesSearchData } from './speciesSearchData';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const missing = () => ({ ok: false, status: 404 }) as Response;

test('loadSpeciesSearchData reads names and codes, keeping only well-formed rows', async () => {
  resetSpeciesSearchData();
  const fetcher = async (url: string) => (url.endsWith('index.json')
    ? ok({ species: [['Turdus migratorius', 'American Robin'], ['Aenigmatolimnas marginalis'], [7]] })
    : ok({ codes: [['AMRO', 'Turdus migratorius'], ['bad', 'X'], ['ABCDE', 'Y']] }));
  const data = await loadSpeciesSearchData(fetcher as unknown as typeof fetch);
  assert.deepEqual(data.entries, [
    { scientific: 'Turdus migratorius', common: 'American Robin' },
    { scientific: 'Aenigmatolimnas marginalis', common: 'Aenigmatolimnas marginalis' },
  ]);
  assert.deepEqual([...data.codes], [['AMRO', 'Turdus migratorius']]);
});

test('loadSpeciesSearchData still offers names without the code file, and nothing (not an error) without names', async () => {
  resetSpeciesSearchData();
  const noCodes = async (url: string) => (url.endsWith('index.json') ? ok({ species: [['A a', 'Aa Bird']] }) : missing());
  assert.equal((await loadSpeciesSearchData(noCodes as unknown as typeof fetch)).codes.size, 0);
  resetSpeciesSearchData();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const none = await loadSpeciesSearchData((async () => missing()) as unknown as typeof fetch);
    assert.deepEqual(none, { entries: [], codes: new Map() });
  } finally {
    console.warn = warn;
  }
});
