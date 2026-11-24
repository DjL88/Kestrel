import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCollage, duplicateCollagePage } from '../../core/collage';
import CollageExportDialog from '../ui/dialogs/CollageExportDialog';

function render(format: 'square' | 'a4-portrait', twoPages = false) {
  let document = createCollage(['bird-1','bird-2'], format);
  if (twoPages) document = duplicateCollagePage(document);
  return renderToStaticMarkup(React.createElement(CollageExportDialog,
    { document, onClose: () => {}, onExport: async () => {} }));
}
test('printed album defaults to PDF and offers no invalid social image export choices', () => {
  const output = render('a4-portrait');
  assert.match(output, /Photo album PDF/);
  assert.match(output, /value="pdf"/);
  assert.doesNotMatch(output, /value="jpeg"/);
  assert.doesNotMatch(output, /value="png"/);
  assert.match(output, /300 PPI/);
});
test('a two-page social collage defaults to all pages and offers JPEG and PNG only', () => {
  const output = render('square', true);
  assert.match(output, /All 2 pages/);
  assert.match(output, /value="jpeg"/);
  assert.match(output, /value="png"/);
  assert.doesNotMatch(output, /value="pdf"/);
});
