#!/usr/bin/env node
/**
 * Four-letter banding codes for the North American birds in the shipped world list.
 *
 *   node tools/species/banding_codes.mjs public/models/species-world.json public/models/species-names/banding-codes.json
 *
 * Every code is worked out by `bandingCodeFor` in src/core/speciesSearch.ts from the IOC English name (IOC World Bird
 * List, CC BY 4.0, already shipped) with the published four-letter rule. No third-party code list is copied. Where two
 * North American birds would share a code, the official list breaks the tie by hand, so neither gets one here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildBandingCodes } from '../../src/core/speciesSearch.ts';

const [from = 'public/models/species-world.json', to = 'public/models/species-names/banding-codes.json'] = process.argv.slice(2);
const world = JSON.parse(readFileSync(from, 'utf8'));
const northAmerican = world.labels
  .filter((label) => Array.isArray(label.regions) && label.regions.includes('NA'))
  .map((label) => ({ scientific: label.scientific, common: label.common }));
const codes = [...buildBandingCodes(northAmerican)].sort(([a], [b]) => a.localeCompare(b));
const out = {
  version: 1,
  rule: 'Four-letter rule (Pyle and DeSante): one word, its first four letters; two words, two letters of each; three words, one letter from each of the first two and two from the last; four words, the first letter of each. Hyphens split words.',
  source: 'Worked out by Kestrel from the English names of North American birds in the IOC World Bird List 15.2 (CC BY 4.0). Not the official USGS Bird Banding Laboratory or IBP list.',
  attribution: 'Bird names: IOC World Bird List v15.2 (Gill, F., D. Donsker and P. Rasmussen, eds), CC BY 4.0, worldbirdnames.org.',
  licence: 'CC BY 4.0 (names); the codes are derived by rule',
  leftOut: northAmerican.length - codes.length,
  codes,
};
writeFileSync(to, `${JSON.stringify(out)}\n`);
console.log(`${codes.length} codes from ${northAmerican.length} North American birds (${out.leftOut} left out: shared code or no rule)`);
