import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_CATALOGUE } from './modelCatalogue';
import { OPTIONAL_MODELS } from '../core/optionalModels';

test('every model is listed once, each file pinned by a 64-hex checksum and a real size', () => {
  const ids = MODEL_CATALOGUE.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  const statIds = MODEL_CATALOGUE.flatMap((entry) => entry.files.map((file) => file.statId));
  assert.equal(new Set(statIds).size, statIds.length);
  for (const entry of MODEL_CATALOGUE) {
    assert.ok(entry.files.length > 0, entry.id);
    for (const file of entry.files) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/, file.statId);
      assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0, file.statId);
    }
  }
});

test('every opt-in pack appears, and memory is only ever a measured figure with where it was measured', () => {
  for (const pack of OPTIONAL_MODELS) assert.ok(MODEL_CATALOGUE.some((entry) => entry.id === pack.id), pack.id);
  for (const entry of MODEL_CATALOGUE) {
    if (entry.peakMemory) { assert.ok(entry.peakMemory.megabytes > 0); assert.ok(entry.peakMemory.where.length > 0); }
  }
});

test('the desktop vision model lists exactly the files and digests the Rust runtime pins', async () => {
  const { readFile } = await import('node:fs/promises');
  const rust = await readFile(new URL('../../crates/kestrel-vision/src/pack.rs', import.meta.url), 'utf8');
  const pinned = [...rust.matchAll(/\("onnx\/([^"]+)", ([\d_]+), "([0-9a-f]{64})"\)/g)].map((m) => ({ file: m[1], bytes: Number(m[2].replace(/_/g, '')), sha256: m[3] }));
  const entry = MODEL_CATALOGUE.find((item) => item.id === 'smolvlm2-500m-desktop');
  assert.ok(entry);
  assert.equal(pinned.length, 3);
  assert.deepEqual(entry.files.map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 })).sort((a, b) => a.file.localeCompare(b.file)),
    pinned.sort((a, b) => a.file.localeCompare(b.file)));
  assert.match(rust, new RegExp(`REVISION: &str = "${entry.version!.slice(0, 8)}`));
});

test('every opt-in pack can be downloaded and removed from Settings, and nothing built in can', () => {
  const packs = MODEL_CATALOGUE.filter((entry) => entry.pack);
  assert.deepEqual(packs.map((entry) => entry.pack!.model.id).sort(), OPTIONAL_MODELS.map((model) => model.id).sort());
  for (const entry of packs) assert.equal(entry.id, entry.pack!.model.id);
});
