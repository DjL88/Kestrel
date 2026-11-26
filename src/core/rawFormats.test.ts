import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEVELOP_RAW_EXTENSIONS, PHOTO_EXTENSIONS, RAW_FORMATS, isDevelopRawFile, isRawPreviewFile, rawFormatOf } from './rawFormats';

/** The quoted names inside one Rust array literal, found by the line that declares it. */
function rustList(path: string, declaration: string): string[] {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const line = source.split('\n').find((text) => text.includes(declaration));
  assert.ok(line, `${declaration} not found in ${path}`);
  return [...line.slice(line.indexOf('=')).matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);
}

test('every type the decoder develops is offered at import, so no developable file is hidden', () => {
  const imported = new Set(RAW_FORMATS.map((format) => format.ext));
  for (const ext of DEVELOP_RAW_EXTENSIONS) assert.ok(imported.has(ext), `${ext} is developed but not offered at import`);
});

test('only Sony SRF and SR2 are imported for their embedded preview alone', () => {
  const previewOnly = RAW_FORMATS.map((format) => format.ext).filter((ext) => !DEVELOP_RAW_EXTENSIONS.includes(ext));
  assert.deepEqual(previewOnly.sort(), ['sr2', 'srf']);
});

test('the newly offered makers are recognised by name and extension, case-insensitively', () => {
  assert.equal(rawFormatOf('L1000123.SRW')?.brand, 'Samsung');
  assert.equal(rawFormatOf('B0001234.3FR')?.brand, 'Hasselblad');
  assert.equal(rawFormatOf('B0001234.fff')?.brand, 'Hasselblad');
  assert.equal(rawFormatOf('CF012345.IIQ')?.brand, 'Phase One');
  assert.equal(rawFormatOf('L1000123.RWL')?.brand, 'Leica');
  assert.equal(rawFormatOf('CF012345.MOS')?.brand, 'Leaf');
  for (const name of ['a.srw', 'a.3FR', 'a.FFF', 'a.iiq', 'a.rwl', 'a.mos']) {
    assert.ok(isRawPreviewFile(name), name);
    assert.ok(isDevelopRawFile(name), name);
  }
  assert.equal(isDevelopRawFile('a.srf'), false);
  assert.equal(isDevelopRawFile('a.x3f'), false);
  assert.equal(isDevelopRawFile('nef'), false);
});

test("the desktop app's lists match this one, so the desktop and web accept the same files", () => {
  assert.deepEqual(rustList('src-tauri/src/preview_cache.rs', 'const RAW_EXTENSIONS').sort(), [...DEVELOP_RAW_EXTENSIONS].sort());
  assert.deepEqual(rustList('src-tauri/src/lib.rs', 'const KNOWN').sort(), PHOTO_EXTENSIONS.map((ext) => ext.slice(1)).sort());
});
