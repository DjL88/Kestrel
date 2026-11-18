#!/usr/bin/env node
/**
 * Kestrel first-photograph MVP test without an installer or a cloud service.
 *
 *   node scripts/test-raw-master.mjs "/path/to/original.NEF"
 *   node scripts/test-raw-master.mjs "/path/to/original.NEF" edit.json [framing.json]
 *
 * Requires Node 22, Rust/Cargo and host Tauri compiler prerequisites.
 * Runs unit tests, renders the actual RAW to TIFF with the native code, verifies
 * TIFF metadata, and ensures the source's SHA-256 was not changed.
 *
 * By default outputs under ~/Kestrel-MVP-Tests, avoiding an iCloud/OneDrive
 * Desktop folder. Nothing is uploaded and nothing is installed.
 */
import {
  createReadStream, existsSync, mkdirSync, openSync, closeSync, readSync, statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fail = (message, status = 1) => {
  console.error('\nFAIL:', message);
  process.exit(status);
};

if (args.length < 1 || args.length > 3 || args.some(a => a === '--help' || a === '-h')) {
  console.log('Usage: node scripts/test-raw-master.mjs "<original.NEF>" [edit.json] [framing.json]');
  console.log('Outputs: ~/Kestrel-MVP-Tests (or KESTREL_MASTER_OUTPUT_DIR)');
  process.exit(args.length === 0 || args[0] === '--help' ? 0 : 2);
}
const source = resolve(args[0]);
if (!existsSync(source) || !statSync(source).isFile()) fail('Input is not a readable local RAW file.');
const inputs = args.slice(1).map(resolve);
for (const path of inputs) {
  if (!existsSync(path) || !statSync(path).isFile()) fail('Edit/crop JSON file not found: ' + path);
}
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const cargoVersion = spawnSync(cargo, ['--version'], { encoding: 'utf8' });
if (cargoVersion.error || cargoVersion.status !== 0) {
  fail('Rust/Cargo is not installed or not on PATH. See https://v2.tauri.app/start/prerequisites/');
}
console.log('Rust:', cargoVersion.stdout.trim());
const run = (program, command) => {
  console.log('\n$', program, ...command);
  const outcome = spawnSync(program, command, { cwd: root, stdio: 'inherit' });
  if (outcome.error) fail(outcome.error.message);
  if (outcome.status !== 0) fail('Native Rust command failed. Fix the error before accepting this export.', outcome.status || 1);
};
const hashFile = async (path) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const readAt = (fd, totalBytes, position) => {
  const data = Buffer.alloc(totalBytes);
  let done = 0;
  while (done < totalBytes) {
    const got = readSync(fd, data, done, totalBytes - done, position + done);
    if (!got) throw new Error('TIFF metadata ends unexpectedly.');
    done += got;
  }
  return data;
};
function tiffMetadata(path) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const read = (len, start) => {
      if (!Number.isSafeInteger(start) || start < 0 || start + len > size) {
        throw new Error('TIFF metadata pointer outside file');
      }
      return readAt(fd, len, start);
    };
    const header = read(8, 0);
    const signature = header.toString('ascii', 0, 2);
    if (signature !== 'II' && signature !== 'MM') throw new Error('Not a TIFF');
    const le = signature === 'II';
    const u16 = (buf, at = 0) => le ? buf.readUInt16LE(at) : buf.readUInt16BE(at);
    const u32 = (buf, at = 0) => le ? buf.readUInt32LE(at) : buf.readUInt32BE(at);
    if (u16(header, 2) !== 42) throw new Error('Not a classic TIFF (tag 42)');
    const ifd = u32(header, 4);
    const count = u16(read(2, ifd));
    if (count > 1024) throw new Error('Invalid TIFF tag count');
    const entries = read(count * 12, ifd + 2);
    const tags = new Map();
    for (let n = 0; n < count; n++) {
      const e = entries.subarray(n * 12, (n + 1) * 12);
      const tag = u16(e);
      if (![256, 257, 258, 262, 277, 34675].includes(tag)) continue;
      const type = u16(e, 2), elements = u32(e, 4);
      const bytesPer = { 1: 1, 3: 2, 4: 4, 7: 1 }[type];
      if (!bytesPer || elements > 1000000) throw new Error('Invalid TIFF metadata tag');
      const length = elements * bytesPer;
      const bytes = length <= 4 ? e.subarray(8, 8 + length) : read(length, u32(e, 8));
      let values;
      if (tag === 34675) values = [length];
      else if (type === 3) values = Array.from({ length: elements }, (_, i) => u16(bytes, i * 2));
      else if (type === 4) values = Array.from({ length: elements }, (_, i) => u32(bytes, i * 4));
      else throw new Error('Unexpected TIFF metadata format');
      tags.set(tag, values);
    }
    const scalar = tag => tags.get(tag)?.[0];
    const result = {
      width: scalar(256), height: scalar(257), bits: tags.get(258),
      samples: scalar(277), photometric: scalar(262), iccBytes: scalar(34675) ?? 0,
    };
    if (!result.width || !result.height || result.bits?.join(',') !== '16,16,16' ||
      result.samples !== 3 || result.photometric !== 2) throw new Error('TIFF is not valid RGB16');
    return result;
  } finally {
    closeSync(fd);
  }
}

const outputDir = resolve(process.env.KESTREL_MASTER_OUTPUT_DIR || join(homedir(), 'Kestrel-MVP-Tests'));
mkdirSync(outputDir, { recursive: true });
const stem = basename(source).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'raw';
const suffix = String(Date.now());
const output = join(outputDir, stem + '-raw16-poc-' + suffix + '.tiff');
if (existsSync(output)) fail('Output filename already exists. No files were overwritten.');
console.log('Source:', source);
console.log('Output:', output);
console.log('No cloud upload. Original read-only.');

const before = await hashFile(source);
run(cargo, ['test', '--release', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', 'raw_precision::']);
run(cargo, ['run', '--release', '--manifest-path', 'src-tauri/Cargo.toml', '--example',
  'raw16_master', '--', source, output, ...inputs]);
const after = await hashFile(source);
if (before !== after) fail('CRITICAL: original RAW checksum changed.');
if (!existsSync(output)) fail('No TIFF output was created.');
const result = tiffMetadata(output);
console.log('\nPASS: Native RAW exported an RGB16 TIFF.');
console.log('Dimensions:', result.width + ' x ' + result.height);
console.log('Bits per channel:', result.bits.join('/'));
console.log('Original unchanged:', before === after);
console.log('ICC profile embedded:', result.iccBytes > 0 ? 'YES (' + result.iccBytes + ' bytes)' : 'NO — COLOUR QUALITY GATE BLOCKED');
console.log('TIFF:', output);
console.log('\nNOT YET PROVEN: camera colour fidelity, supported HE/HE*, preview parity, denoise/feather quality.');
