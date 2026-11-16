#!/usr/bin/env node
/**
 * Puts the species model next to the app, so the browser downloads it from the app's own site (no cross-origin
 * rules to worry about). Run it before `npm run build` when deploying, or once for local use:
 *
 *     npm run model:species
 *
 * The file is kept out of git. It is downloaded from a release asset (server to server, so no CORS), checked against
 * its SHA-256, and written to public/models/. The app is then built with VITE_SPECIES_MODEL_URL=/models/<file>.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = 'bioclip-image-int8.onnx';
const SHA256 = 'ea4095eb31a279643dc7ea89b90b2168b4807df0fce3c40b72a43a771caee8a2';
const BYTES = 89041951;
const SOURCE = process.env.SPECIES_MODEL_SOURCE ?? `https://github.com/DjL88/Kestrel/releases/download/species-model-1/${FILE}`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'public', 'models');
const target = join(folder, FILE);
const includeLicence = () => {
  mkdirSync(folder, { recursive: true });
  copyFileSync(join(root, 'docs', 'notices', 'bioclip.txt'), join(folder, 'bioclip.txt'));
};
const sum = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (existsSync(target) && sum(readFileSync(target)) === SHA256) {
  includeLicence();
  console.log(`${FILE} is already in place and matches its checksum.`);
  process.exit(0);
}
console.log(`Downloading ${FILE} (${Math.round(BYTES / 1e6)} MB) from ${SOURCE}`);
const response = await fetch(SOURCE, { redirect: 'follow' });
if (!response.ok) { console.error(`Download failed: ${response.status} ${response.statusText}`); process.exit(1); }
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length !== BYTES || sum(bytes) !== SHA256) {
  console.error('The downloaded file does not match its recorded size and SHA-256, so it was not kept.');
  process.exit(1);
}
includeLicence();
writeFileSync(`${target}.part`, bytes);
renameSync(`${target}.part`, target);
console.log(`Saved ${target}\nBuild with: VITE_SPECIES_MODEL_URL=/models/${FILE} npm run build`);
