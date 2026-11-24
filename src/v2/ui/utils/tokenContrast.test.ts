import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Every text colour must be readable on every surface it sits on: WCAG 2.2 AA, 4.5:1 for normal-size text.
// The V2 interface uses small text (11 to 13 px) almost everywhere, so there is no large-text allowance here.

const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `missing ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['bg-app', 'bg-canvas', 'bg-surface', 'bg-surface-raised', 'bg-surface-hover', 'bg-input'];
const TEXT = ['text-primary', 'text-secondary', 'text-muted'];
const ACCENT_TEXT = ['brand-accent', 'semantic-info', 'semantic-success', 'semantic-warning', 'semantic-danger'];

for (const [theme, selector] of [['dark', '.inflight-v2[data-v2-theme="dark"]'], ['light', '.inflight-v2[data-v2-theme="light"]']] as const) {
  const t = block(selector);

  test(`${theme} theme: body text passes AA on every surface`, () => {
    for (const fg of TEXT) for (const bg of SURFACES) {
      const ratio = contrast(t[fg], t[bg]);
      assert.ok(ratio >= 4.5, `${theme} --${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${theme} theme: accent and status colours pass AA as text on panels`, () => {
    for (const fg of ACCENT_TEXT) for (const bg of ['bg-surface', 'bg-surface-raised', 'bg-input']) {
      const ratio = contrast(t[fg], t[bg]);
      assert.ok(ratio >= 4.5, `${theme} --${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${theme} theme: text on the accent button passes AA`, () => {
    const ratio = contrast(t['text-on-accent'], t['brand-accent']);
    assert.ok(ratio >= 4.5, `${theme} --text-on-accent on --brand-accent is ${ratio.toFixed(2)}:1`);
  });
}

test('the contrast formula matches known WCAG values', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
});
