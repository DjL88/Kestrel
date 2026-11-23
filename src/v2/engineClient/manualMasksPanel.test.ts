import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Photo } from '../ui/contract';
import MasksPanel from '../ui/panels/MasksPanel';
import { createMask } from '../../core/maskTypes';
import { masksToLayers } from './maskOps';

const photo = {
  id: 'p1',
  masks: masksToLayers([createMask('radial', 'oval'), createMask('linear', 'gradient')]),
} as Photo;

const html = renderToStaticMarkup(React.createElement(MasksPanel, {
  photo,
  activeMaskTool: 'area',
  onSetMaskTool: () => {},
  onAddMaskLayer: () => {},
  onToggleMaskLayer: () => {},
  onRemoveMaskLayer: () => {},
  onSetMaskEdit: () => {},
  onSetMaskFeather: () => {},
  onSetMaskGeometry: () => {},
}));

function buttonWith(label: string): string {
  const button = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map(match => match[0]).find(markup => markup.includes('>' + label + '<'));
  assert.ok(button, 'Expected a control for ' + label);
  return button;
}

test('V2 visibly enables real Oval and Gradient actions, not brush, eraser or auto-sky', () => {
  for (const label of ['Oval area', 'Gradient']) {
    assert.doesNotMatch(buttonWith(label), /\sdisabled(?:=""|\s|>)/);
  }
  for (const label of ['Brush', 'Eraser']) {
    assert.match(buttonWith(label), /\sdisabled(?:=""|\s|>)/);
  }
  assert.match(html, /Sky detection and brush painting are not connected yet/);
  assert.match(html, /Active layers \(2\)/);
});

test('manually created masks are labelled accurately rather than as detected sky', () => {
  assert.match(html, /Round area/);
  assert.match(html, /Gradient/);
  assert.match(html, /no adjustments/);
});
