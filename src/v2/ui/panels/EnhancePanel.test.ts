import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Photo } from '../contract';
import { NEUTRAL_RECIPE } from '../../engineClient/recipeMap';
import EnhancePanel from './EnhancePanel';

const photo = {
  id: 'p1',
  activeGroupId: 'base',
  editGroups: [{ id: 'base', recipe: NEUTRAL_RECIPE }],
} as unknown as Photo;

const render = () => renderToStaticMarkup(React.createElement(EnhancePanel, {
  photo,
  calmView: false,
  onUpdateRecipe: () => {},
  onDenoise: () => {},
}));

function taggedElement(html: string, tag: 'input' | 'button', testId: string): string {
  const element = [...html.matchAll(new RegExp('<' + tag + '[^>]*>', 'g'))]
    .map((match) => match[0]).find((value) => value.includes('data-testid="' + testId + '"'));
  assert.ok(element, 'expected visible ' + testId);
  return element;
}

test('unsupported enhancements are visibly and accessibly disabled in the real editor UI', () => {
  const html = render();
  for (const [tag, id] of [
    ['button', 'v2-enhance-raw-ai'],
    ['input', 'v2-enhance-luminance'],
    ['button', 'v2-enhance-lens-correction'],
  ] as const) {
    const control = taggedElement(html, tag, id);
    assert.match(control, /disabled(?:="")?/, id + ' should not accept a click');
    assert.match(control, /aria-describedby="v2-enhance-unavailable"/);
  }
  assert.match(html, /Unavailable adjustments are disabled/);
});

test('real texture edit remains enabled and is named honestly', () => {
  const html = render();
  const texture = taggedElement(html, 'input', 'v2-enhance-texture');
  assert.doesNotMatch(texture, /disabled(?:="")?/);
  assert.match(html, /Texture \(existing detail\)/);
  assert.match(html, /It cannot restore missing detail or invent feathers/);
  assert.match(html, /id="denoise-colour"/);
  assert.match(html, /Output scale/);
});
