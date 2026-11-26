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
