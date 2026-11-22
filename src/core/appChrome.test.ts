import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepsNativeMenu } from './appChrome';

test('the browser menu is suppressed everywhere except where text is typed', () => {
  assert.equal(keepsNativeMenu({ tagName: 'IMG' }), false);
  assert.equal(keepsNativeMenu({ tagName: 'DIV' }), false);
  assert.equal(keepsNativeMenu(null), false);
  assert.equal(keepsNativeMenu({ tagName: 'INPUT', type: 'range' }), false);
  assert.equal(keepsNativeMenu({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(keepsNativeMenu({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(keepsNativeMenu({ tagName: 'INPUT' }), true);
  assert.equal(keepsNativeMenu({ tagName: 'TEXTAREA' }), true);
  assert.equal(keepsNativeMenu({ tagName: 'DIV', isContentEditable: true }), true);
});
