#!/usr/bin/env node
/**
 * Species names in the app's languages, keyed by scientific name, from the IOC World Bird List's Multilingual version
 * (Gill, Donsker and Rasmussen, compiled by Peter Kovalik; CC BY 4.0, https://www.worldbirdnames.org).
 *
 *   node tools/species/make_names.mjs "Multiling IOC 15.2.xlsx" public/models/species-names
 *
 * Writes `index.json` (every species the app can name, from the world bird list and the shipped UK list, as
 * [scientific, English]) and one `<code>.json` per language the IOC list covers ({ scientific: local name }). Where a
 * language or a species has no name in the source (Welsh, Scottish Gaelic and Irish are not in it, nor are mammals), the
 * app shows the scientific name, never a guessed translation. The xlsx is not committed; its URL and SHA-256 go in each file.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

/** App language → the IOC multilingual column that holds it. Languages missing here have no IOC names. */
export const IOC_COLUMNS = {
  da: 'Danish', nl: 'Dutch', fi: 'Finnish', fr: 'French', de: 'German', it: 'Italian', nb: 'Norwegian',
  pt: 'Portuguese (Portuguese)', es: 'Spanish', sv: 'Swedish', is: 'Icelandic',
};
export const NO_IOC_NAMES = ['cy', 'gd', 'ga'];
const SOURCE_URL = 'https://worldbirdnames.org/Multiling%20IOC%2015.2.xlsx';

const decode = (text) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** The first worksheet as rows of column-letter → text. */
export function readSheet(bytes) {
  const zip = unzipSync(bytes);
  const shared = [...strFromU8(zip['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rows = [];
  for (const row of strFromU8(zip['xl/worksheets/sheet1.xml']).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const raw = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1];
      if (raw === undefined) continue;
      const text = (/t="s"/.test(c[2]) ? shared[Number(raw)] : decode(raw)).trim();
      if (text && text !== 'undefined') cells[c[1]] = text;
    }
    rows.push(cells);
  }
  return rows;
}

/** Scientific name (lower case) → { language → local name }, from the multilingual sheet. */
export function iocNames(rows) {
  const header = rows[0];
  const column = Object.fromEntries(Object.entries(header).map(([letter, name]) => [name, letter]));
  const science = column[Object.keys(column).find((name) => /^IOC_/.test(name))];
  const names = new Map();
  for (const row of rows.slice(1)) {
    const scientific = row[science];
    if (!scientific || !/^[A-Z][a-z]+ [a-z-]+$/.test(scientific)) continue; // species rows only
    const local = {};
    for (const [code, name] of Object.entries(IOC_COLUMNS)) if (row[column[name]]) local[code] = row[column[name]];
    names.set(scientific.toLowerCase(), local);
  }
  return names;
}


if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [source, target] = process.argv.slice(2);
  const bytes = readFileSync(source);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const names = iocNames(readSheet(bytes));
  const labels = [
    ...JSON.parse(readFileSync('public/models/species-world.json', 'utf8')).labels,
    ...JSON.parse(readFileSync('src/assets/species/uk.json', 'utf8')).labels,
  ];
  const seen = new Set();
  const species = [];
  for (const label of labels) {
    const key = label.scientific.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    species.push({ scientific: label.scientific, common: label.common, group: label.group ?? 'bird' });
  }
  mkdirSync(target, { recursive: true });
  const attribution = 'Bird names: IOC World Bird List v15.2, Multilingual version (Gill, F., D. Donsker and P. Rasmussen, eds; compiled by P. Kovalik), CC BY 4.0, worldbirdnames.org.';
  const meta = { version: 1, source: 'IOC World Bird List 15.2, Multilingual (CC BY 4.0)', sourceUrl: SOURCE_URL, sourceSha256: sha256, attribution, licence: 'CC BY 4.0' };
  const size = (value) => `${(Buffer.byteLength(JSON.stringify(value)) / 1024).toFixed(0)} KB`;
  // Every species the app can name, once: [scientific, English]. Loaded with any non-English language.
  const index = { ...meta, species: species.map((s) => [s.scientific, s.common]) };
  writeFileSync(join(target, 'index.json'), JSON.stringify(index));
  console.log(`index: ${species.length} species, ${size(index)}`);
  for (const code of Object.keys(IOC_COLUMNS)) {
    const local = {};
    for (const s of species) { const name = names.get(s.scientific.toLowerCase())?.[code]; if (name) local[s.scientific] = name; }
    const file = { ...meta, language: code, names: local };
    writeFileSync(join(target, `${code}.json`), JSON.stringify(file));
    console.log(`${code}: ${Object.keys(local).length} of ${species.length} named, ${size(file)}`);
  }
  console.log(`No IOC names for ${NO_IOC_NAMES.join(', ')}: the app shows the scientific name.`);
}
