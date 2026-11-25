#!/usr/bin/env node
/**
 * Bird family names in the app's languages, from Wikidata (CC0), for photos named only by family ("Owls" → "Eulen").
 *
 *   node tools/species/family_names.mjs public/models/species-names
 *
 * Reads the families in `index.json` ([scientific, English]), asks the Wikidata Query Service for each family taxon's
 * label in every app language, and writes `families.json` ({ language: { scientific: name } }). A label that is just
 * the scientific name again, or a disambiguation, is not a translation and is dropped: the app then shows the
 * scientific name. Only the Latin family names are sent; nothing about the person or their photos. The query matches
 * family-rank taxa by name without walking up to Aves, which the service times out on; bird family names do not clash.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LANGUAGES = ['da', 'nl', 'fi', 'fr', 'de', 'it', 'nb', 'pt', 'es', 'sv', 'is', 'cy', 'gd', 'ga'];
const ENDPOINT = 'https://query.wikidata.org/sparql';

/** A Wikidata label that adds nothing: empty, the Latin name again, or the Latin name with a qualifier. */
export function usefulLabel(label, scientific) {
  const text = (label ?? '').trim();
  if (!text) return undefined;
  const plain = text.toLowerCase();
  if (plain === scientific.toLowerCase() || plain.startsWith(`${scientific.toLowerCase()} `)) return undefined;
  if (/\b(?:family|familie|famille|familia|famiglia)\b/i.test(text) && plain.includes(scientific.toLowerCase())) return undefined;
  // Another Latin rank name is not an everyday word either ("Ploceinae").
  if (/^[A-Z][a-z]+(?:idae|inae|oidea|ini)$/.test(text)) return undefined;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function query(names) {
  const values = names.map((name) => `"${name.replace(/"/g, '')}"`).join(' ');
  const sparql = `SELECT ?name ?lang ?label ?kind WHERE {
    VALUES ?name { ${values} }
    ?taxon wdt:P225 ?name; wdt:P105 wd:Q35409 .
    ?taxon rdfs:label ?label . BIND('label' AS ?kind)
    BIND(LANG(?label) AS ?lang)
    FILTER(?lang IN (${LANGUAGES.map((code) => `"${code}"`).join(', ')}))
  }`;
  let response;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'InFlight-species-names/1.0 (offline build script)' },
        body: new URLSearchParams({ query: sparql, format: 'json' }),
      });
      if (response.ok) break;
      throw new Error(`Wikidata ${response.status}`);
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
    }
  }
  return (await response.json()).results.bindings.map((b) => ({ name: b.name.value, lang: b.lang.value, label: b.label.value, alias: b.kind.value === 'alias' }));
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('family_names.mjs')) {
  const dir = process.argv[2] ?? 'public/models/species-names';
  const families = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).families.map(([scientific]) => scientific);
  const out = Object.fromEntries(LANGUAGES.map((code) => [code, {}]));
  for (let i = 0; i < families.length; i += 25) {
    for (const row of await query(families.slice(i, i + 25))) {
      // Labels only. Aliases were tried and rejected: they name single species (French "Cygne" for all ducks).
      const name = usefulLabel(row.label, row.name);
      if (name && out[row.lang]) out[row.lang][row.name] = name;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  // Hand-written drafts (tools/species/family-drafts.json) for commonly photographed families win over Wikidata, which
  // often has only a Latin-style form ("Strigidés") where people say "Chouettes et hiboux".
  const drafts = JSON.parse(readFileSync(new URL('./family-drafts.json', import.meta.url), 'utf8'));
  const drafted = Object.fromEntries(LANGUAGES.map((code) => [code, 0]));
  for (const code of LANGUAGES) {
    for (const [scientific, name] of Object.entries(drafts[code] ?? {})) {
      if (out[code][scientific] !== name) { out[code][scientific] = name; drafted[code] += 1; }
    }
  }
  const file = {
    version: 1, source: 'Wikidata (CC0) taxon labels for the IOC bird families, plus InFlight drafts', licence: 'CC0 1.0 (Wikidata)',
    attribution: 'Family names: Wikidata (CC0), plus InFlight draft names for common families awaiting native review.',
    retrieved: new Date().toISOString().slice(0, 10), names: out,
  };
  writeFileSync(join(dir, 'families.json'), JSON.stringify(file));
  for (const code of LANGUAGES) console.log(`${code}: ${Object.keys(out[code]).length} of ${families.length} (${drafted[code]} drafts)`);
}
