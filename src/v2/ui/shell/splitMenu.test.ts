import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import SplitMenu from './SplitMenu';
import { STRINGS } from '../strings';

test('the Split button names its action in words and starts closed', () => {
  const html = renderToStaticMarkup(React.createElement(SplitMenu, { onSplit: () => {}, onDuplicate: () => {}, onResize: () => {} }));
  assert.match(html, new RegExp(`>${STRINGS.canvas.splitMenu.button}<`));
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.ok(!html.includes('role="menu"'));
  assert.match(html, /min-h-11/);
});
