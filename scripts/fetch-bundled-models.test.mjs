import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readList, sourceOf, uploadCommands, DEFAULT_HOST } from './fetch-bundled-models.mjs';

const entry = { file: 'dinov2-small-fp16.onnx', sha256: 'a'.repeat(64), bytes: 10 };

test('the committed list is valid and names every large file once', () => {
  const entries = readList(readFileSync(new URL('../models/bundled-models.json', import.meta.url), 'utf8'));
  assert.ok(entries.length >= 2);
  assert.equal(new Set(entries.map((e) => e.file)).size, entries.length);
});

test('a file is fetched by its checksum, so a host can never serve a different version under the same address', () => {
  assert.equal(sourceOf(`${DEFAULT_HOST}/`, entry), `${DEFAULT_HOST}/${'a'.repeat(64)}/dinov2-small-fp16.onnx`);
});

test('bad entries are refused before anything is downloaded', () => {
  assert.throws(() => readList(JSON.stringify({ files: [{ ...entry, file: '../x' }] })), /bad file name/);
  assert.throws(() => readList(JSON.stringify({ files: [{ ...entry, sha256: 'xyz' }] })), /bad SHA-256/);
  assert.throws(() => readList(JSON.stringify({ files: [{ ...entry, bytes: 0 }] })), /bad size/);
});

test('upload commands never overwrite and mark the files immutable', () => {
  const [command] = uploadCommands([entry]);
  assert.match(command, /cp -n public\/models\/dinov2-small-fp16\.onnx gs:\/\/kestrel-hosting-kestrel-models\/bundled\/a{64}\/dinov2-small-fp16\.onnx/);
  assert.match(command, /immutable/);
});

test('the desktop pack list is valid, and a pack is bundled only when every one of its files is in place', async () => {
  const { completePacks } = await import('./fetch-bundled-models.mjs');
  const packs = readList(readFileSync(new URL('../models/desktop-packs.json', import.meta.url), 'utf8'));
  assert.ok(packs.every((e) => typeof e.pack === 'string'));
  const encoder = packs.find((e) => e.file.includes('encoder'));
  const present = new Set(packs.map((e) => e.file).filter((file) => file !== encoder.file));
  const bundled = completePacks(packs, present);
  assert.ok(!bundled.includes('efficientsam-ti-fp16'), 'tap select needs both halves');
  assert.ok(bundled.includes('nafnet-sidd-w32-w16'));
});

test('the desktop pack pins match the app\'s own pins', async () => {
  const source = readFileSync(new URL('../src/core/optionalModels.ts', import.meta.url), 'utf8');
  for (const entry of readList(readFileSync(new URL('../models/desktop-packs.json', import.meta.url), 'utf8'))) {
    assert.ok(source.includes(`'${entry.file}', '${entry.sha256}', ${entry.bytes}`), `${entry.file} pin differs from src/core/optionalModels.ts`);
  }
});
