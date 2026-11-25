import test from 'node:test';
import assert from 'node:assert/strict';
import { channelCurveLuts, gradeParams, gradePixel, isNeutralChannelCurves, isNeutralGrade, validChannelCurves, validGrade, type ColourGrade } from './colourGrade';
import { applyPhotoEdit, applyPhotoEditLinear, isNeutralTone, type PhotoEdit } from './photoEdits';
import { editRgb16, master16Blocker } from './master16';

const grade = (shadows: [number, number], highlights: [number, number], balance = 0): ColourGrade => ({ shadows, midtones: [0, 0], highlights, balance });
const pixel = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);

test('a grade is validated strictly and a grade with no strength is neutral', () => {
  assert.ok(validGrade(grade([200, 0.5], [40, 0.3])));
  assert.ok(!validGrade({ ...grade([200, 0.5], [40, 0.3]), balance: 2 }));
  assert.ok(!validGrade({ ...grade([200, 1.5], [40, 0.3]) }));
  assert.ok(!validGrade({ ...grade([0, 0], [0, 0]), extra: 1 }));
  assert.ok(isNeutralGrade(grade([200, 0], [40, 0])));
  assert.ok(isNeutralGrade(undefined));
  assert.ok(isNeutralTone({ exposure: 0, warmth: 0, colour: 0, grade: grade([200, 0], [40, 0]) }));
});

test('cool shadows and warm highlights tint each range and leave luma about the same', () => {
  const edit: PhotoEdit = { exposure: 0, warmth: 0, colour: 0, grade: grade([220, 1], [35, 1]) };
  const dark = pixel(40, 40, 40);
  const light = pixel(215, 215, 215);
  applyPhotoEdit(dark, edit);
  applyPhotoEdit(light, edit);
  assert.ok(dark[2] > dark[0], `shadow should be bluer: ${dark}`);
  assert.ok(light[0] > light[2], `highlight should be warmer: ${light}`);
  const luma = (p: Uint8ClampedArray) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  assert.ok(Math.abs(luma(light) - 215) < 4, `highlight luma kept: ${luma(light)}`);
});

test('balance moves the split between shadow and highlight tints', () => {
  const out = new Float32Array([0.5, 0.5, 0.5]);
  gradePixel(out, gradeParams(grade([240, 1], [0, 0], 1)));
  const towardsShadows = out[2] - out[0];
  const out2 = new Float32Array([0.5, 0.5, 0.5]);
  gradePixel(out2, gradeParams(grade([240, 1], [0, 0], -1)));
  assert.ok(towardsShadows > out2[2] - out2[0]);
});

test('channel curves are validated, compose after the master curve and change only their channel', () => {
  assert.ok(validChannelCurves({ red: [[0, 0], [0.5, 0.6], [1, 1]] }));
  assert.ok(!validChannelCurves({ alpha: [[0, 0], [1, 1]] }));
  assert.ok(isNeutralChannelCurves({ red: [[0, 0], [1, 1]] }));
  assert.equal(channelCurveLuts(undefined, undefined), null);
  const luts = channelCurveLuts([[0, 0.1], [1, 1]], { red: [[0, 0], [0.5, 0.7], [1, 1]] })!;
  assert.ok(luts[0][256] > luts[1][256]);
  assert.ok(Math.abs(luts[1][0] - 0.1) < 1e-6, 'master curve still applies to green');
  const p = pixel(128, 128, 128);
  applyPhotoEdit(p, { exposure: 0, warmth: 0, colour: 0, channelCurves: { red: [[0, 0], [0.5, 0.7], [1, 1]] } });
  assert.ok(p[0] > 160 && p[1] === 128 && p[2] === 128, `${p}`);
});

test('the 16-bit export accepts valid advanced edits, matches the float path and refuses malformed ones', () => {
  const edit: PhotoEdit = { exposure: 0, warmth: 0, colour: 0, grade: grade([220, 0.6], [35, 0.6]), channelCurves: { blue: [[0, 0], [0.5, 0.4], [1, 1]] } };
  assert.equal(master16Blocker(edit, undefined), null);
  assert.match(master16Blocker({ ...edit, grade: { ...edit.grade!, balance: 9 } }, undefined) ?? '', /colour grading/);
  assert.match(master16Blocker({ ...edit, channelCurves: { blue: [[0.5, 0], [0.2, 1]] } }, undefined) ?? '', /channel curves/);
  const image = { width: 1, height: 1, data: new Uint16Array([30000, 30000, 30000]) };
  editRgb16(image as never, edit);
  const v = 30000 / 65535;
  const lin = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const floats = new Float32Array([lin, lin, lin, 1]);
  applyPhotoEditLinear(floats, edit);
  for (let c = 0; c < 3; c += 1) assert.ok(Math.abs(image.data[c] / 65535 - floats[c]) < 0.002);
  assert.ok(image.data[2] < 30000, 'blue curve pulled blue down in the TIFF');
});
