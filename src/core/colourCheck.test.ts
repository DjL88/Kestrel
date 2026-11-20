import assert from 'node:assert/strict';
import test from 'node:test';
import { checkColour, nameColour, strongColourMap, type ColourFinding, type Pixels } from './colourCheck';

/** A picture made of horizontal bands, each a share of the height in one colour. */
function bands(parts: Array<[number, [number, number, number]]>, width = 40, height = 100): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  let row = 0;
  for (const [share, [r, g, b]] of parts) {
    const rows = Math.round(share * height);
    for (let y = row; y < Math.min(height, row + rows); y += 1) for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    row += rows;
  }
  return { data, width, height };
}
const find = <Id extends ColourFinding['id']>(findings: ColourFinding[], id: Id) =>
  findings.find((finding) => finding.id === id) as Extract<ColourFinding, { id: Id }> | undefined;

test('colours are named in plain families, with lightness and strength', () => {
  assert.deepEqual(nameColour(200, 30, 30), { family: 'red', lightness: 'mid', strength: 'veryStrong' });
  assert.equal(nameColour(240, 140, 30).family, 'orange');
  assert.equal(nameColour(110, 70, 30).family, 'brown');
  assert.equal(nameColour(240, 220, 40).family, 'yellow');
  assert.equal(nameColour(40, 160, 60).family, 'green');
  assert.equal(nameColour(30, 90, 200).family, 'blue');
  assert.equal(nameColour(130, 60, 170).family, 'purple');
  assert.equal(nameColour(230, 90, 170).family, 'pink');
  assert.equal(nameColour(128, 128, 128).family, 'grey');
  assert.equal(nameColour(5, 5, 5).family, 'black');
  assert.equal(nameColour(250, 250, 250).family, 'white');
  assert.equal(nameColour(128, 128, 128).strength, 'none');
  assert.equal(nameColour(150, 120, 100).strength, 'muted');
  assert.equal(nameColour(20, 20, 30).lightness, 'veryDark');
});

test('a natural scene: palette largest first, and nothing to warn about', () => {
  const report = checkColour({ after: bands([[0.5, [110, 150, 200]], [0.35, [80, 120, 70]], [0.15, [150, 110, 80]]]) });
  assert.deepEqual(report.palette.map((entry) => entry.family), ['blue', 'green', 'brown']);
  assert.ok(Math.abs(report.palette[0].share - 0.5) < 0.02);
  assert.equal(report.findings.filter((finding) => finding.severity !== 'info').length, 0);
  assert.equal(report.monochrome, false);
  assert.equal(find(report.findings, 'redGreenAlike'), undefined, 'muted leaves and a brown branch are not worth a warning');
});

test('over-strong colour is reported, with which colours', () => {
  const report = checkColour({ after: bands([[0.4, [255, 0, 30]], [0.6, [120, 120, 120]]]) });
  const strong = find(report.findings, 'strongColour');
  assert.ok(strong);
  assert.equal(strong.severity, 'warning');
  assert.deepEqual(strong.families, ['red']);
  const clipped = find(report.findings, 'clippedColour');
  assert.ok(clipped, 'channels at their limits in a strong red lose detail');
  assert.deepEqual(clipped.families, ['red']);
  assert.equal(report.findings[0].severity, 'warning', 'warnings come first');
});

test('a colour cast on things that should be grey is named by direction', () => {
  const warm = checkColour({ after: bands([[1, [150, 130, 100]]]) });
  assert.deepEqual(find(warm.findings, 'cast'), { id: 'cast', severity: 'tip', direction: 'warm', amount: 'clear' });
  const cool = checkColour({ after: bands([[1, [118, 128, 145]]]) });
  assert.equal(find(cool.findings, 'cast')?.direction, 'cool');
  const green = checkColour({ after: bands([[1, [120, 138, 120]]]) });
  assert.equal(find(green.findings, 'cast')?.direction, 'green');
  const neutral = checkColour({ after: bands([[1, [128, 128, 128]]]) });
  assert.equal(find(neutral.findings, 'cast'), undefined);
});

test('black and white is never called a fault; a nearly colourless picture is only noted', () => {
  const grey = bands([[0.5, [40, 40, 40]], [0.5, [200, 200, 200]]]);
  assert.equal(checkColour({ after: grey }).monochrome, true);
  assert.deepEqual(find(checkColour({ after: grey }).findings, 'muted'), { id: 'muted', severity: 'info' });
  assert.equal(find(checkColour({ after: grey, blackAndWhite: true }).findings, 'muted'), undefined);
});

test('red and green areas of the same lightness are flagged as alike for colour-blind viewers', () => {
  const alike = checkColour({ after: bands([[0.5, [180, 70, 60]], [0.5, [100, 120, 50]]]) });
  const finding = find(alike.findings, 'redGreenAlike');
  assert.ok(finding, 'a red berry on green leaves');
  assert.ok(finding.families.includes('red') || finding.families.includes('brown') || finding.families.includes('orange'));
  // Blue against yellow stays distinct for red–green colour blindness.
  const distinct = checkColour({ after: bands([[0.5, [40, 90, 200]], [0.5, [220, 200, 50]]]) });
  assert.equal(find(distinct.findings, 'redGreenAlike'), undefined);
});

test('the edit’s effect on colour strength is said as a change', () => {
  const before = bands([[1, [150, 120, 100]]]);
  const after = bands([[1, [190, 110, 60]]]);
  const change = find(checkColour({ after, before }).findings, 'editChange');
  assert.ok(change && change.change > 0.5);
  const same = find(checkColour({ after: before, before }).findings, 'editChange');
  assert.equal(same, undefined, 'no change, nothing said');
});

test('the subject’s colour is told apart from its surroundings', () => {
  const after = bands([[0.3, [200, 110, 40]], [0.7, [70, 120, 70]]]);
  const subject = new Float32Array(after.width * after.height);
  subject.fill(1, 0, Math.round(0.3 * after.height) * after.width);
  const finding = find(checkColour({ after, subject }).findings, 'subjectColour');
  assert.ok(finding);
  assert.equal(finding.subject, 'orange');
  assert.equal(finding.surroundings, 'green');
});

test('the strong-colour map marks only intensely coloured pixels', () => {
  const map = strongColourMap(bands([[0.5, [255, 0, 30]], [0.5, [120, 120, 120]]], 10, 10));
  assert.equal(map.reduce((sum, value) => sum + value, 0), 50);
});

test('an empty or tiny picture is handled', () => {
  const report = checkColour({ after: { data: new Uint8ClampedArray(0), width: 0, height: 0 } });
  assert.deepEqual(report.palette, []);
  assert.ok(Array.isArray(report.findings));
});
