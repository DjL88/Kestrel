#!/usr/bin/env node
/**
 * Download a small, multi-brand set of camera RAW files into ./raw-samples (git-ignored) for decode tests.
 *
 *   node scripts/fetch-raw-samples.mjs            download what is missing
 *   node scripts/fetch-raw-samples.mjs --list     show the set without downloading
 *
 * Source: https://raw.pixls.us, a public RAW sample archive whose files are CC0 unless its table says otherwise.
 * Check the licence column there before redistributing any file. These are for local testing only and are never
 * committed. They exercise decoding for each maker; they are low-ISO and say nothing about noise reduction quality.
 * Then run the native decode check with:  KESTREL_RAW_SAMPLES=$PWD/raw-samples cargo test --release raw::
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const BASE = 'https://raw.pixls.us/data';
// [maker, camera, file, approximate size in MB, what it exercises]
export const SAMPLES = [
  ['Nikon', 'Z 8', 'Nikon_Z8_high_efficiency_low.NEF', 23, 'Nikon High Efficiency'],
  ['Nikon', 'Z 8', 'Nikon_Z8_raw_high_efficiency_hight.NEF', 34, 'Nikon High Efficiency (higher quality)'],
  ['Nikon', 'Z 8', 'Nikon_Z8_raw_14_bit_lossless_compression.NEF', 58, 'Nikon 14-bit lossless'],
  ['Canon', 'EOS R5', 'Canon_EOS_R5_CRAW_ISO_100_nocrop_nodual.CR3', 16, 'Canon CR3, compressed CRAW'],
  ['Canon', 'EOS R5', 'Canon_EOS_R5_RAW_ISO_100_crop_nodual.CR3', 17, 'Canon CR3, full RAW'],
  ['Sony', 'ILCE-7M4', 'ILCE-7M4_DSC06681_APS-C-Raw-Compressed.ARW', 19, 'Sony ARW, compressed'],
  ['Sony', 'ILCE-7M4', 'ILCE-7M4_DSC06676_FullFrame-LossLess-Compressed-Small.ARW', 22, 'Sony ARW, lossless compressed'],
  ['Fujifilm', 'X-T5', 'DSCF0022.RAF', 27, 'Fujifilm RAF (X-Trans, not Bayer)'],
  ['Panasonic', 'DC-S5', 'dc-s5_6k4k.RW2', 34, 'Panasonic RW2'],
  ['OM Digital Solutions', 'OM-3', 'P5048182.ORF', 21, 'OM System ORF'],
  ['Pentax', 'K-3 Mark III', 'IMGP9854.PEF', 31, 'Pentax PEF'],
  ['Pentax', 'K-3 Mark III', '_IMG0114.DNG', 31, 'Adobe DNG'],
];

const folder = new URL('../raw-samples/', import.meta.url);
const urlFor = ([maker, camera, file]) => `${BASE}/${[maker, camera, file].map(encodeURIComponent).join('/')}`;

if (process.argv.includes('--list')) {
  for (const sample of SAMPLES) console.log(`${String(sample[3]).padStart(4)} MB  ${sample[2].padEnd(60)} ${sample[4]}`);
  console.log(`Total about ${SAMPLES.reduce((sum, sample) => sum + sample[3], 0)} MB`);
  process.exit(0);
}

mkdirSync(folder, { recursive: true });
let failed = 0;
for (const sample of SAMPLES) {
  const target = new URL(sample[2], folder);
  if (existsSync(target) && statSync(target).size > 1_000_000) { console.log(`have     ${sample[2]}`); continue; }
  const response = await fetch(urlFor(sample));
  if (!response.ok || !response.body) { console.log(`FAILED   ${sample[2]} (${response.status})`); failed += 1; continue; }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  console.log(`fetched  ${sample[2]}  ${(statSync(target).size / 1e6).toFixed(1)} MB`);
}
process.exit(failed ? 1 : 0);
