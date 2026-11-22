import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESKTOP_MENU_ACTION_IDS, menuActionFor } from './desktopMenuCommands.ts';

test('Photo menu items map to the same actions as the keys', () => {
  assert.deepEqual(menuActionFor('photo-keep'), { kind: 'command', id: 'cull.keep' });
  assert.deepEqual(menuActionFor('photo-rate-4'), { kind: 'rate', rating: 4 });
  assert.deepEqual(menuActionFor('photo-rate-0'), { kind: 'rate', rating: 0 });
  assert.deepEqual(menuActionFor('view-compare'), { kind: 'view', mode: 'compare' });
});
test('unknown ids and prototype names are ignored', () => {
  assert.equal(menuActionFor('nope'), null);
  assert.equal(menuActionFor('constructor'), null);
  assert.equal(menuActionFor('photo-rate-6'), null);
});
test('every id handled here exists in the native menu, so no item is a dead end', () => {
  const rust = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  for (const id of DESKTOP_MENU_ACTION_IDS) assert.ok(rust.includes(`"${id}"`), `${id} is missing from src-tauri/src/lib.rs`);
});
