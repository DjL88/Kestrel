import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Photo } from '../contract';
import AutoChangeBanner from './AutoChangeBanner';

const photo = {
  id: 'p1',
  editHistory: { cursor: 1, steps: [{ label: 'Auto', at: 1000, by: 'auto', changes: [{ label: 'Exposure', from: '0.00 EV', to: '+0.30 EV' }], why: ['The photo is on the dark side.'] }] },
} as unknown as Photo;
const render = (overrides: Partial<React.ComponentProps<typeof AutoChangeBanner>> = {}) => renderToStaticMarkup(React.createElement(AutoChangeBanner, {
  photo, status: undefined, comparing: false, dismissed: new Set<string>(), onDismiss: () => {}, since: 0, onUndo: () => {}, onToggleCompare: () => {}, ...overrides,
}));

test('the banner names the change and the reason and offers Undo, Before / After and Dismiss as labelled buttons', () => {
  const html = render();
  assert.match(html, /data-testid="auto-banner"/);
  assert.match(html, /Exposure \+0\.30 EV/);
  assert.match(html, /Why: The photo is on the dark side\./);
  for (const id of ['auto-banner-undo', 'auto-banner-compare', 'auto-banner-dismiss']) assert.match(html, new RegExp(`data-testid="${id}"`));
  assert.match(html, /aria-label="Dismiss"/);
  assert.match(html, /aria-pressed="false"/);
});

test('a dismissed banner, and one for an earlier session, render nothing; the dismissal lives with the caller', () => {
  assert.equal(render({ dismissed: new Set(['p1:1000']) }), '');
  assert.equal(render({ since: 2000 }), '');
  assert.equal(render({ photo: null }), '');
});
