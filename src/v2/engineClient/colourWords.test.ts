import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkColour, type ColourReport } from '../../core/colourCheck';
import { colourWarningSentences, colourWords, describeColourFinding, describeColourSense } from './colourWords';
import { checkSubjectColour } from '../../core/colourSense';

const solid = (width: number, height: number, paint: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const [r, g, b] = paint(x, y);
    data.set([r, g, b, 255], (y * width + x) * 4);
  }
  return { data, width, height };
};

test('every finding is a sentence in words, never an internal code', () => {
  const report: ColourReport = {
    palette: [{ family: 'green', share: 0.6, strength: 'moderate' }],
    monochrome: false,
    findings: [
      { id: 'clippedColour', severity: 'warning', share: 0.1, families: ['red'] },
      { id: 'strongColour', severity: 'warning', share: 0.4, families: ['red', 'green'] },
      { id: 'cast', severity: 'tip', direction: 'warm', amount: 'clear' },
      { id: 'redGreenAlike', severity: 'tip', families: ['red', 'green'] },
      { id: 'muted', severity: 'info' },
      { id: 'editChange', severity: 'info', change: -0.2 },
      { id: 'subjectColour', severity: 'info', subject: 'orange', subjectStrength: 'strong', surroundings: 'green' },
    ],
  };
  const words = colourWords(report);
  assert.deepEqual(words.palette, ['green, medium: about half or more']);
  assert.deepEqual(words.notes.map((note) => note.label), ['Watch out:', 'Watch out:', 'Tip:', 'Tip:', 'Note:', 'Note:', 'Note:']);
  for (const note of words.notes) assert.doesNotMatch(note.text, /clippedColour|strongColour|redGreenAlike|editChange|subjectColour/);
  assert.match(words.notes[3].text, /colour-blind people will find them hard to tell apart/);
  assert.match(words.notes[2].text, /warm cast.*most people will notice/);
  assert.equal(describeColourFinding(report.findings[5]), 'Your edit has made the colours 20% softer than the original.');
  assert.deepEqual(colourWarningSentences(report), [
    'Some red areas are too strong to show their detail, so they look flat.',
    'Very strong red and green covers 40% of the photo. It can look unreal on screen and print badly.',
  ]);
  assert.deepEqual(colourWarningSentences(undefined), []);
});

test('a real check of a red and green picture names both colours', () => {
  const report = checkColour({ after: solid(64, 64, (x) => (x < 32 ? [200, 40, 40] : [40, 160, 40])) });
  const words = colourWords(report);
  assert.ok(words.palette.some((line) => line.startsWith('red')));
  assert.ok(words.palette.some((line) => line.startsWith('green')));
});


test('ColourSense says in words whether the subject keeps its colour, and says nothing when it cannot judge', () => {
  const subject = Float32Array.from({ length: 100 }, (_, p) => (p % 10 < 5 ? 1 : 0));
  const picture = (rgb: [number, number, number]) => solid(10, 10, (x) => (x < 5 ? rgb : [90, 110, 90]));
  const kept = describeColourSense(checkSubjectColour(picture([200, 110, 40]), picture([212, 118, 44]), subject));
  assert.deepEqual(kept, { kept: true, label: 'Subject colour:', text: 'Kept close to the original (orange).' });
  const moved = describeColourSense(checkSubjectColour(picture([200, 110, 40]), picture([205, 180, 40]), subject));
  assert.equal(moved?.kept, false);
  assert.match(moved!.text, /Moves from orange towards yellow\./);
  const clipped = describeColourSense(checkSubjectColour(picture([230, 120, 60]), picture([255, 128, 64]), subject));
  assert.match(clipped!.text, /Detail is lost in the red channel on part of the subject\./);
  assert.equal(describeColourSense(checkSubjectColour(picture([200, 110, 40]), picture([200, 110, 40]), new Float32Array(100))), undefined);
  assert.equal(describeColourSense(undefined), undefined);
});
