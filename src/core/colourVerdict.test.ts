import assert from 'node:assert/strict';
import test from 'node:test';
import type { ColourFinding, ColourReport } from './colourCheck';
import { colourVerdict } from './colourVerdict';

const report = (...findings: ColourFinding[]): ColourReport => ({ palette: [], findings, monochrome: false });
const area = { x: 0, y: 0, width: 0.5, height: 1 };

test('nothing found is "normal"; nothing measured is "not sure", never a guess', () => {
  assert.deepEqual(colourVerdict(report()), { kind: 'normal', more: [] });
  assert.deepEqual(colourVerdict(undefined), { kind: 'unsure', more: [] });
  assert.deepEqual(colourVerdict(null), { kind: 'unsure', more: [] });
  // Notes that are not problems do not change the verdict.
  assert.equal(colourVerdict(report({ id: 'editChange', severity: 'info', change: 0.2 })).kind, 'normal');
});

test('each finding maps to one verdict and one reasoned correction', () => {
  assert.deepEqual(colourVerdict(report({ id: 'strongColour', severity: 'warning', share: 0.3, families: ['red'] })),
    { kind: 'overSaturated', fix: { setting: 'saturation', delta: -12 }, more: [] });
  assert.deepEqual(colourVerdict(report({ id: 'strongColour', severity: 'tip', share: 0.1, families: ['red'] })).fix, { setting: 'saturation', delta: -8 });
  assert.deepEqual(colourVerdict(report({ id: 'muted', severity: 'info' })), { kind: 'underSaturated', fix: { setting: 'saturation', delta: 12 }, more: [] });
  const cast = (direction: 'warm' | 'cool' | 'green' | 'magenta', amount: 'slight' | 'clear' = 'clear') => colourVerdict(report({ id: 'cast', severity: 'tip', direction, amount }));
  assert.deepEqual(cast('warm'), { kind: 'tooWarm', fix: { setting: 'temperature', delta: -10 }, more: [] });
  assert.deepEqual(cast('cool'), { kind: 'tooCool', fix: { setting: 'temperature', delta: 10 }, more: [] });
  assert.deepEqual(cast('green'), { kind: 'greenTint', fix: { setting: 'tint', delta: 10 }, more: [] });
  assert.deepEqual(cast('magenta'), { kind: 'magentaTint', fix: { setting: 'tint', delta: -10 }, more: [] });
  assert.deepEqual(cast('warm', 'slight').fix, { setting: 'temperature', delta: -5 }, 'a slight cast gets a smaller correction');
  // Red and green alike is something to look at, not something to correct.
  assert.deepEqual(colourVerdict(report({ id: 'redGreenAlike', severity: 'tip', families: ['red', 'green'], areas: [area, area] })), { kind: 'redGreenAlike', more: [] });
});

test('the most important issue leads and the rest wait under More, one line per kind', () => {
  const verdict = colourVerdict(report(
    { id: 'redGreenAlike', severity: 'tip', families: ['red', 'green'] },
    { id: 'cast', severity: 'tip', direction: 'warm', amount: 'slight' },
    { id: 'strongColour', severity: 'warning', share: 0.3, families: ['red'] },
    { id: 'clippedColour', severity: 'warning', share: 0.02, families: ['red'] },
  ));
  assert.equal(verdict.kind, 'overSaturated');
  assert.deepEqual(verdict.more.map((issue) => issue.kind), ['tooWarm', 'redGreenAlike']);
  // A clear cast outranks colour that is only a little strong.
  const castFirst = colourVerdict(report({ id: 'strongColour', severity: 'tip', share: 0.1, families: ['red'] }, { id: 'cast', severity: 'tip', direction: 'cool', amount: 'clear' }));
  assert.equal(castFirst.kind, 'tooCool');
  assert.deepEqual(castFirst.more.map((issue) => issue.kind), ['overSaturated']);
});
