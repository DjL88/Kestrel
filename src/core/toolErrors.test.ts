import assert from 'node:assert/strict';
import test from 'node:test';
import { friendlyToolError } from './toolErrors';

test('a failed dynamic import becomes a calm sentence with no web address in it', () => {
  const raw = new TypeError('Failed to fetch dynamically imported module: https://ais-dev-v37447.run.app/node_modules/.vite/deps/onnxruntime-web_wasm.js?v=ba7f1226');
  const message = friendlyToolError(raw);
  assert.match(message, /could not load/i);
  assert.match(message, /Reload the page/);
  assert.doesNotMatch(message, /https?:|\.js|vite|node_modules/);
});

test('other loading failures are treated the same way', () => {
  for (const text of ['Importing a module script failed.', 'Failed to fetch', 'WebAssembly.instantiate(): network error', 'Load failed']) {
    assert.match(friendlyToolError(new Error(text)), /could not load/i, text);
  }
});

test('messages we wrote ourselves are kept, and unknown problems get a generic one', () => {
  assert.equal(friendlyToolError(new Error('The subject model file does not match its checksum, so it was not used.')),
    'The subject model file does not match its checksum, so it was not used.');
  assert.equal(friendlyToolError(new Error('Something odd')), 'The subject tools hit a problem. Please try again.');
  assert.equal(friendlyToolError(undefined), 'The subject tools hit a problem. Please try again.');
  assert.match(friendlyToolError(new Error('Failed to fetch'), 'denoise tool'), /denoise tool could not load/);
});
