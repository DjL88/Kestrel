import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EditRecipe, Photo } from './contract';
import { NEUTRAL_RECIPE } from '../engineClient/recipeMap';
import AdjustPanel from './panels/AdjustPanel';

// Dave, 27 Nov: "Can we group the edit sliders more distinctly into their groups?"
const render = (recipe: Partial<EditRecipe> = {}) => renderToStaticMarkup(React.createElement(AdjustPanel, {
  photo: {
    id: 'p1', title: 'p1', previewUrl: '', activeGroupId: 'base', exif: { camera: 'Test' },
    editGroups: [{ id: 'base', name: 'Base', recipe: { ...NEUTRAL_RECIPE, ...recipe } }],
  } as unknown as Photo,
  selectedPhotoCount: 1, looks: [], cvdGuidance: false, hideReadouts: false, showAdvanced: true,
  onUpdateRecipe: () => {}, onDetectColourEdges: () => {}, onApplyLensProfile: () => {}, onApplyLook: () => {},
  onHoverLook: () => {}, onResetPhoto: () => {},
} as unknown as React.ComponentProps<typeof AdjustPanel>));

const groups = ['light', 'colour', 'detail', 'effects', 'curve', 'mixer', 'grading'];

test('Advanced Edits lists its controls in labelled groups, each opening and closing from its heading', () => {
  const html = render();
  for (const id of groups) {
    assert.match(html, new RegExp(`<section aria-labelledby="adjust-${id}-heading"`), `${id} is a labelled region`);
    assert.match(html, new RegExp(`<h3 id="adjust-${id}-heading"[^>]*><button type="button" aria-expanded="true" aria-controls="adjust-${id}-body"`), `${id} opens and closes from its heading`);
  }
  for (const name of ['Light &amp; Tone', 'Colour', 'Detail', 'Effects', 'Colour grading']) assert.match(html, new RegExp(`<span class="truncate">${name}</span>`));
  // Nothing changed: no marker and no group Reset.
  assert.doesNotMatch(html, /data-testid="slider-group-changed"/);
  assert.doesNotMatch(html, /data-testid="slider-group-reset"/);
});

test('a changed group says so in words and offers its own Reset; the others do not', () => {
  const html = render({ shadows: 25 });
  const light = html.slice(html.indexOf('data-testid="slider-group-adjust-light"'), html.indexOf('data-testid="slider-group-adjust-colour"'));
  assert.match(light, /data-changed="true"/);
  assert.match(light, />Changed</);
  assert.match(light, /aria-label="Reset Light &amp; Tone"/);
  const rest = html.slice(html.indexOf('data-testid="slider-group-adjust-colour"'));
  assert.doesNotMatch(rest, />Changed</);
});
