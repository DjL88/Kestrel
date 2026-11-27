import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Photo } from '../ui/contract';
import { NEUTRAL_RECIPE } from './recipeMap';
import EnhancePanel from '../ui/panels/EnhancePanel';

const photo = {
  id: 'p1',
  activeGroupId: 'base',
  editGroups: [{ id: 'base', recipe: NEUTRAL_RECIPE }],
} as unknown as Photo;

const render = () => renderToStaticMarkup(React.createElement(EnhancePanel, {
  photo,
  hideReadouts: false,
  onUpdateRecipe: () => {},
  onDenoise: () => {},
}));

function taggedElement(html: string, tag: 'input' | 'button', testId: string): string {
  const element = [...html.matchAll(new RegExp('<' + tag + '[^>]*>', 'g'))]
    .map((match) => match[0]).find((value) => value.includes('data-testid="' + testId + '"'));
  assert.ok(element, 'expected visible ' + testId);
  return element;
}

// Dave, 27 Nov: "don't show what we can't do". A control whose feature is not built (its recipe key is in UNMAPPED_KEYS)
// is not rendered at all. A control that cannot act on this photo right now stays visible, disabled, with its reason.
test('unbuilt enhancements are not shown at all, and no "unavailable" line is left behind', () => {
  const html = render();
  for (const id of ['v2-enhance-raw-ai', 'v2-enhance-lens-correction']) {
    assert.doesNotMatch(html, new RegExp('data-testid="' + id + '"'), id + ' is not built, so it is not shown');
  }
  assert.doesNotMatch(html, /RAW Deep Denoise/);
  assert.doesNotMatch(html, /Unavailable adjustments are disabled/);
});

test('a control that cannot act on this photo right now stays visible and is disabled accessibly, with its reason', () => {
  // TrueDetail is already working on this photo: the button stays, cannot be pressed twice, and says why.
  const html = renderToStaticMarkup(React.createElement(EnhancePanel, {
    photo, hideReadouts: false, onUpdateRecipe: () => {}, onDenoise: () => {}, trueDetail: { state: 'running', percent: 40 },
  }));
  const button = taggedElement(html, 'button', 'truedetail-run');
  assert.match(button, /disabled(?:="")?/, 'it does not accept a second press');
  assert.match(button, /aria-busy="true"/);
  assert.match(html, /role="status"[^>]*>TrueDetail is working on this photo: 40%/);
});

test('real texture edit remains enabled and is named honestly', () => {
  const html = render();
  const texture = taggedElement(html, 'input', 'v2-enhance-texture');
  assert.doesNotMatch(texture, /disabled(?:="")?/);
  assert.doesNotMatch(taggedElement(html, 'input', 'v2-enhance-luminance'), /disabled(?:="")?/);
  assert.match(html, /Texture \(existing detail\)/);
  assert.match(html, /id="denoise-colour"/);
  assert.match(html, /Output scale/);
});
