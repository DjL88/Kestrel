#!/usr/bin/env node
/**
 * Name rows for one extra species group, from its owner-approved open checklist (kept outside the repo):
 *
 *   node tools/species/group_rows.mjs odonata     <World Odonata List COLDP folder> [gbif-odonata-countries.json] out.json
 *   node tools/species/group_rows.mjs reptiles    <Reptile Database COLDP folder>     out.json
 *   node tools/species/group_rows.mjs lepidoptera <Fauna Europaea DwC folder> <INBO butterflies DwC folder> out.json
 *   node tools/species/group_rows.mjs amphibians  <gbif-amphibia.json>                out.json
 *
 * Each row: { scientific, common, family, regions, names: { language: local name } }. Accepted, living species only.
 * `regions` are the app's species regions from the countries the source records (tools/species/realms.mjs); empty means
 * unknown, which the app treats as "may occur anywhere". `common` is the English name where the source has one, else the
 * scientific name, never an invented English name. make_vectors.py turns the rows into BioCLIP name vectors.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countriesInText, countryMatchers, realmsForCountries } from './realms.mjs';

/** Language names and codes the sources use, to the app's language codes. */
const APP_LANGUAGES = {
  de: 'de', ger: 'de', deu: 'de', german: 'de', fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr', es: 'es', spa: 'es', spanish: 'es',
  it: 'it', ita: 'it', italian: 'it', pt: 'pt', por: 'pt', portuguese: 'pt', nl: 'nl', dut: 'nl', nld: 'nl', dutch: 'nl',
  da: 'da', dan: 'da', danish: 'da', sv: 'sv', swe: 'sv', swedish: 'sv', nb: 'nb', no: 'nb', nor: 'nb', nob: 'nb', norwegian: 'nb',
  fi: 'fi', fin: 'fi', finnish: 'fi', is: 'is', ice: 'is', isl: 'is', icelandic: 'is', cy: 'cy', wel: 'cy', cym: 'cy', welsh: 'cy',
  gd: 'gd', gla: 'gd', ga: 'ga', gle: 'ga', irish: 'ga',
};
const ENGLISH = new Set(['', 'en', 'eng', 'english']);
const SPECIES = /^[A-Z][a-z]+ [a-z-]+$/;

/** A tab-separated file with a header row, keys lower-cased without underscores (ID, id, name_id → id, nameid). */
function readTsv(file) {
  const [header, ...lines] = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = header.split('\t').map((c) => c.replace(/^﻿/, '').replace(/_/g, '').toLowerCase());
  return lines.map((line) => Object.fromEntries(line.split('\t').map((v, i) => [cols[i], v])));
}
const sentence = (text) => String(text ?? '').trim().replace(/\s+/g, ' ');
const titleCase = (text) => sentence(text).replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Vernacular names to an English common name and local names in the app's languages. */
function namesFrom(vernaculars, scientific, { untaggedIsEnglish = true } = {}) {
  const local = {};
  let common;
  for (const { name, language } of vernaculars) {
    const code = sentence(language).toLowerCase();
    // "Grenouille rousse (La)": a bracketed article or note is not part of the name.
    const text = sentence(name).replace(/\s*\([^)]*\)\s*$/, '');
    // A "translation" that is the Latin name again, or a Latin binomial, is not a local name.
    if (!text || text.toLowerCase() === scientific.toLowerCase() || /^[A-Z][a-z]+ [a-z]+$/.test(text) && text.split(' ')[0] === scientific.split(' ')[0]) continue;
    if (code === '' ? untaggedIsEnglish : ENGLISH.has(code)) common ??= titleCase(text);
    else if (APP_LANGUAGES[code]) local[APP_LANGUAGES[code]] ??= text;
  }
  return { common, local };
}

/** COLDP (Catalogue of Life Data Package): Name, Taxon, Distribution, VernacularName. */
function fromColdp(dir, gbifCountries) {
  // Optional: countries from GBIF occurrence facets, used where the checklist itself records no distribution.
  const fromGbifRecords = gbifCountries ? JSON.parse(readFileSync(gbifCountries, 'utf8')).countries : {};
  const names = new Map(readTsv(join(dir, 'Name.tsv')).map((n) => [n.id, n]));
  const taxa = readTsv(join(dir, 'Taxon.tsv'));
  const byId = new Map(taxa.map((t) => [t.id, t]));
  const rankOf = (t) => sentence(names.get(t.nameid)?.rank).toLowerCase();
  const familyOf = (t) => {
    for (let p = t, i = 0; p && i < 40; p = byId.get(p.parentid), i++) if (rankOf(p) === 'family') return sentence(names.get(p.nameid)?.scientificname);
    return undefined;
  };
  const matchers = countryMatchers();
  const countries = new Map();
  for (const d of readTsv(join(dir, 'Distribution.tsv'))) {
    // ISO codes as they are; free text is read for country names; other gazetteers (TDWG) are skipped.
    const codes = d.gazetteer === 'iso' ? [d.areaid || d.area] : d.gazetteer === 'text' || !d.gazetteer ? countriesInText(d.area ?? '', matchers) : [];
    countries.set(d.taxonid, [...(countries.get(d.taxonid) ?? []), ...codes]);
  }
  const vernacular = new Map();
  for (const v of readTsv(join(dir, 'VernacularName.tsv'))) vernacular.set(v.taxonid, [...(vernacular.get(v.taxonid) ?? []), v]);
  const rows = [];
  for (const t of taxa) {
    const name = names.get(t.nameid);
    if (!name || rankOf(t) !== 'species' || /^true$/i.test(t.extinct ?? '')) continue;
    const scientific = sentence(name.scientificname);
    if (!SPECIES.test(scientific)) continue;
    const { common, local } = namesFrom(vernacular.get(t.id) ?? [], scientific);
    let recorded = countries.get(t.id) ?? [];
    if (!recorded.length && fromGbifRecords[scientific]) {
      const counts = fromGbifRecords[scientific];
      const solid = counts.filter(([, n]) => n >= 10).map(([c]) => c);
      recorded = solid.length ? solid : counts.map(([c]) => c);
    }
    rows.push({ scientific, common: common ?? scientific, family: familyOf(t), regions: realmsForCountries(recorded), names: local });
  }
  return rows;
}

/** Fauna Europaea Lepidoptera (DwC taxon.txt, positional columns per meta.xml) with English names from the INBO checklist. */
function fromFaunaEuropaea(dir, inbo) {
  const lines = readFileSync(join(dir, 'taxon.txt'), 'utf8').split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'));
  // 0 id, 1 rank, 2 scientificName, 3 acceptedNameUsageID, 4 parentNameUsageID, 6 status, 7 genus, 9 specificEpithet
  const byId = new Map(lines.map((r) => [r[0], r]));
  const familyOf = (r) => {
    for (let p = r, i = 0; p && i < 40; p = byId.get(p[4]), i++) if (p[1] === 'family') return p[2].split(' ')[0];
    return undefined;
  };
  const english = new Map();
  if (inbo) {
    const inboTaxa = new Map(readTsv(join(inbo, 'taxon.txt')).map((t) => [t.id, t]));
    for (const v of readTsv(join(inbo, 'vernacularname.txt'))) {
      const t = inboTaxa.get(v.id);
      const scientific = t && sentence(`${t.genus} ${t.specificepithet}`);
      if (scientific && ENGLISH.has(sentence(v.language).toLowerCase())) english.set(scientific, titleCase(v.vernacularname));
    }
  }
  const rows = [];
  for (const r of lines) {
    if (r[1] !== 'species' || r[6] !== 'accepted') continue;
    const scientific = sentence(`${r[7]} ${r[9]}`);
    if (!SPECIES.test(scientific)) continue;
    rows.push({ scientific, common: english.get(scientific) ?? scientific, family: familyOf(r), regions: ['PAL'], names: {} });
  }
  return rows;
}

/** GBIF Backbone amphibians, as fetched by Kestrel-models/amphibians/fetch_amphibians.mjs. */
function fromGbif(file) {
  return JSON.parse(readFileSync(file, 'utf8')).species.filter((s) => SPECIES.test(s.scientific ?? '')).map((s) => {
    // GBIF vernaculars with no language are often regional ("Geweune Padde"), so only names marked English count.
    const { common, local } = namesFrom(s.vernacular ?? [], s.scientific, { untaggedIsEnglish: false });
    // Countries with at least 10 records; a rare species seen only a few times keeps the countries it was seen in.
    const countries = s.countries?.length ? s.countries : (s.countryCounts ?? []).map(([country]) => country);
    return { scientific: s.scientific, common: common ?? s.scientific, family: s.family, regions: realmsForCountries(countries), names: local };
  });
}

// --names FILE: Wikidata names (mammal_names.mjs output) fill English and local names the checklist does not have.
const argv = process.argv.slice(2);
const namesAt = argv.indexOf('--names');
const wikidata = namesAt >= 0 ? JSON.parse(readFileSync(argv.splice(namesAt, 2)[1], 'utf8')).names : null;
const [group, ...args] = argv;
const target = args.pop();
const rows = group === 'odonata' || group === 'reptiles' ? fromColdp(args[0], args[1])
  : group === 'lepidoptera' ? fromFaunaEuropaea(args[0], args[1])
    : group === 'amphibians' ? fromGbif(args[0]) : null;
if (!rows) throw new Error(`unknown group ${group}`);
if (wikidata) {
  for (const row of rows) {
    if (row.common === row.scientific && wikidata.en?.[row.scientific]) row.common = titleCase(wikidata.en[row.scientific]);
    for (const [code, names] of Object.entries(wikidata)) if (code !== 'en' && names[row.scientific]) row.names[code] ??= names[row.scientific];
  }
}
const seen = new Set();
const unique = rows.filter((r) => !seen.has(r.scientific) && seen.add(r.scientific));
writeFileSync(target, JSON.stringify({ group, rows: unique }));
const named = unique.filter((r) => r.common !== r.scientific).length;
const local = {};
for (const r of unique) for (const code of Object.keys(r.names)) local[code] = (local[code] ?? 0) + 1;
console.log(`${group}: ${unique.length} species, ${named} with an English name, ${unique.filter((r) => !r.regions.length).length} with no region; local names ${JSON.stringify(local)}`);
