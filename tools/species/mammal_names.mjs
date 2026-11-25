#!/usr/bin/env node
/**
 * Species names in the app's languages (and English), from Wikidata (CC0), keyed by scientific name ("Vulpes vulpes" →
 * "Rotfuchs"). Used for mammals and for the other group lists.
 *
 *   node tools/species/mammal_names.mjs public/models/species-mammals.json tools/species/out/mammal-names.json
 *
 * Asks the Wikidata Query Service for the label of each species-rank taxon whose taxon name (P225) matches, in every
 * app language. A label that is just the scientific name again is dropped, so the app shows the scientific name there
 * rather than a Latin "translation". Only the Latin species names are sent; nothing about the person or their photos.
 * The output is merged into the per-language files by make_names.mjs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LANGUAGES as APP_LANGUAGES, usefulLabel } from './family_names.mjs';

// English too: some group checklists have few English names (dragonflies), and the vectors are made from them.
const LANGUAGES = [...APP_LANGUAGES, 'en'];

const ENDPOINT = 'https://query.wikidata.org/sparql';

async function query(names) {
  const values = names.map((name) => `"${name.replace(/"/g, '')}"`).join(' ');
  const sparql = `SELECT ?name ?lang ?label WHERE {
    VALUES ?name { ${values} }
    ?taxon wdt:P225 ?name; wdt:P105 wd:Q7432 .
    ?taxon rdfs:label ?label . BIND(LANG(?label) AS ?lang)
    FILTER(?lang IN (${LANGUAGES.map((code) => `"${code}"`).join(', ')}))
  }`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'InFlight-species-names/1.0 (offline build script)' },
        body: new URLSearchParams({ query: sparql, format: 'json' }),
      });
      if (!response.ok) throw new Error(`Wikidata ${response.status}`);
      return (await response.json()).results.bindings.map((b) => ({ name: b.name.value, lang: b.lang.value, label: b.label.value }));
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
  }
}

const [source, target] = process.argv.slice(2);
// A species list ({ labels }) or group rows ({ rows }), both with `scientific`.
const file = JSON.parse(readFileSync(source, 'utf8'));
const species = (file.labels ?? file.rows).map((entry) => entry.scientific);
const out = Object.fromEntries(LANGUAGES.map((code) => [code, {}]));
for (let i = 0; i < species.length; i += 40) {
  for (const row of await query(species.slice(i, i + 40))) {
    const name = usefulLabel(row.label, row.name);
    if (name && out[row.lang]) out[row.lang][row.name] = name;
  }
  if (i % 800 === 0) console.log(`${i} of ${species.length}`);
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify({ source: 'Wikidata (CC0), species-rank taxon labels', retrieved: new Date().toISOString().slice(0, 10), names: out }));
for (const code of LANGUAGES) console.log(`${code}: ${Object.keys(out[code]).length} of ${species.length}`);
