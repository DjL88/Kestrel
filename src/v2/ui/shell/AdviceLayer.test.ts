import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OnImageAdvice } from '../../../core/onImageAdvice.ts';
import AdviceLayer, { AdviceReadout, AdviceToggle } from './AdviceLayer.tsx';

const advice = (over: Partial<OnImageAdvice> = {}): OnImageAdvice => ({
  clipping: {
    highlightShare: 0.034, shadowShare: 0,
    highlights: [{ x: 0.5, y: 0, width: 0.25, height: 0.25 }], shadows: [],
  },
  colour: { verdict: 'kept', before: 'blue', after: 'blue', nearGrey: false, hueShift: 1, saturationChange: 0, newlyClipped: { red: 0, green: 0, blue: 0 }, outside: [] },
  ...over,
});

test('clipped areas are drawn as a hatch pattern at their place, with a word for each, and no colour carries the meaning', () => {
  const markup = renderToStaticMarkup(createElement('svg', { viewBox: '0 0 400 200' },
    createElement(AdviceLayer, { picture: { width: 400, height: 200 }, advice: advice(), focus: null })));
  assert.match(markup, /data-testid="advice-clip-hi"[^>]*aria-label="Clipped highlights"/);
  assert.match(markup, /x="200" y="0" width="100" height="50" fill="url\(#[^)]+-hi\)"/);
  assert.match(markup, /<pattern[^>]*patternTransform="rotate\(45\)"/);
  assert.match(markup, /<pattern[^>]*patternTransform="rotate\(-45\)"/, 'shadows hatch the other way');
  assert.doesNotMatch(markup, /data-testid="advice-focus"/);
  assert.match(markup, /pointer-events:none/, 'read-only: nothing here takes a click');
});

test('the focus ring says what it is in words', () => {
  const markup = renderToStaticMarkup(createElement('svg', { viewBox: '0 0 400 200' },
    createElement(AdviceLayer, { picture: { width: 400, height: 200 }, advice: advice(), focus: { kind: 'eyeMaybe', x: 0.25, y: 0.5 } })));
  assert.match(markup, /data-testid="advice-focus" data-kind="eyeMaybe"[^>]*aria-label="Eye, check it"/);
  assert.match(markup, /cx="100" cy="100"/);
});

test('the readout always gives a colour verdict, even when all is well, and the chip names the share', () => {
  const markup = renderToStaticMarkup(createElement(AdviceReadout, { advice: advice(), cvdGuidance: false }));
  assert.match(markup, /Highlights clipped about 3%/);
  assert.match(markup, /data-testid="advice-colour" data-kind="kept" data-shape="tick"/);
  assert.match(markup, />Subject colour kept</);
  const clean = renderToStaticMarkup(createElement(AdviceReadout, { advice: advice({ clipping: { highlightShare: 0, shadowShare: 0, highlights: [], shadows: [] } }), cvdGuidance: false }));
  assert.doesNotMatch(clean, /advice-chip/);
  assert.match(clean, />Subject colour kept</);
});

test('each colour verdict has its own words and shape', () => {
  const kinds = [
    [{ verdict: 'unknown', reason: 'noSubject' }, 'Subject colour not checked', 'ring'],
    [{ verdict: 'changed', before: 'blue', after: 'blue', nearGrey: false, hueShift: 0, saturationChange: 0.3, newlyClipped: { red: 0, green: 0, blue: 0 }, outside: ['saturation'] }, 'Subject colour adjusted', 'diamond'],
    [{ verdict: 'changed', before: 'blue', after: 'blue', nearGrey: false, hueShift: 0, saturationChange: 0.8, newlyClipped: { red: 0, green: 0, blue: 0 }, outside: ['saturation'] }, 'Subject colour: check it', 'triangle'],
  ] as const;
  for (const [colour, words, shape] of kinds) {
    const markup = renderToStaticMarkup(createElement(AdviceReadout, { advice: advice({ colour: colour as unknown as OnImageAdvice['colour'] }), cvdGuidance: false }));
    assert.ok(markup.includes(`>${words}<`), words);
    assert.ok(markup.includes(`data-shape="${shape}"`), shape);
  }
});

test('Colour-vision support adds what moved, in words, beside the verdict', () => {
  const moved = advice({ colour: { verdict: 'changed', before: 'blue', after: 'blue', nearGrey: false, hueShift: 0, saturationChange: 0.3, newlyClipped: { red: 0, green: 0, blue: 0 }, outside: ['saturation'] } });
  assert.doesNotMatch(renderToStaticMarkup(createElement(AdviceReadout, { advice: moved, cvdGuidance: false })), /advice-colour-detail/);
  assert.match(renderToStaticMarkup(createElement(AdviceReadout, { advice: moved, cvdGuidance: true })), /data-testid="advice-colour-detail"/);
});

test('the toolbar switch is a real button that says whether it is on', () => {
  const on = renderToStaticMarkup(createElement(AdviceToggle, { shown: true, onToggle: () => undefined }));
  assert.match(on, /^<button type="button"/);
  assert.match(on, /aria-pressed="true"/);
  assert.match(on, /aria-label="Advice on the photo"/);
  assert.match(renderToStaticMarkup(createElement(AdviceToggle, { shown: false, onToggle: () => undefined })), /aria-pressed="false"/);
});
