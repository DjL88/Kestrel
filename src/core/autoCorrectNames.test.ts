import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_RULES, friendlyCamera, friendlyLens, renameRule, rulesInUse, tidyLens } from './autoCorrectNames.ts';
import { formatCameraLabel } from './exifParser.ts';

/** The catalogue's raw label from EXIF Make and Model, as import stores it. */
const label = (make: string, model: string) => formatCameraLabel(make, model)!;

test('camera makers are tidied and never repeated', () => {
  assert.equal(friendlyCamera(label('NIKON CORPORATION', 'NIKON Z 8')), 'Nikon Z8');
  assert.equal(friendlyCamera(label('NIKON CORPORATION', 'NIKON Z5_2')), 'Nikon Z5 II');
  assert.equal(friendlyCamera(label('NIKON CORPORATION', 'NIKON Z 6_3')), 'Nikon Z6 III');
  assert.equal(friendlyCamera(label('NIKON CORPORATION', 'NIKON D850')), 'Nikon D850');
  assert.equal(friendlyCamera(label('Canon', 'Canon EOS R5')), 'Canon EOS R5');
  assert.equal(friendlyCamera(label('FUJIFILM', 'X-T5')), 'Fujifilm X-T5');
  assert.equal(friendlyCamera(label('OM Digital Solutions', 'OM-1')), 'OM System OM-1');
  assert.equal(friendlyCamera(label('OLYMPUS CORPORATION', 'E-M1MarkIII')), 'Olympus OM-D E-M1 Mark III');
  assert.equal(friendlyCamera(label('LEICA CAMERA AG', 'LEICA Q3')), 'Leica Q3');
  assert.equal(friendlyCamera(label('RICOH IMAGING COMPANY, LTD.', 'PENTAX K-3 Mark III')), 'Pentax K-3 Mark III');
  assert.equal(friendlyCamera(label('Hasselblad', 'X2D 100C')), 'Hasselblad X2D 100C');
  assert.equal(friendlyCamera(label('Apple', 'iPhone 15 Pro')), 'Apple iPhone 15 Pro');
});

test('Sony and Panasonic codes read as the cameras are sold', () => {
  assert.equal(friendlyCamera(label('SONY', 'ILCE-7RM5')), 'Sony α7R V');
  assert.equal(friendlyCamera(label('SONY', 'ILCE-7M4')), 'Sony α7 IV');
  assert.equal(friendlyCamera(label('SONY', 'ILCE-1')), 'Sony α1');
  assert.equal(friendlyCamera(label('SONY', 'ILCE-9M3')), 'Sony α9 III');
  assert.equal(friendlyCamera(label('SONY', 'ILCE-6700')), 'Sony α6700');
  assert.equal(friendlyCamera(label('SONY', 'ILCE-7CM2')), 'Sony α7C II');
  assert.equal(friendlyCamera(label('SONY', 'DSC-RX100M7')), 'Sony RX100 VII');
  assert.equal(friendlyCamera(label('Panasonic', 'DC-S5M2')), 'Panasonic Lumix S5 II');
  assert.equal(friendlyCamera(label('Panasonic', 'DC-GH6')), 'Panasonic Lumix GH6');
});

test('a code no rule knows is left as it is, never guessed', () => {
  assert.equal(friendlyCamera(label('DJI', 'FC3582')), 'DJI FC3582');
  assert.equal(friendlyCamera('Mystery Cam 3000'), 'Mystery Cam 3000');
  assert.equal(friendlyCamera(''), '');
  assert.equal(friendlyCamera(undefined), '');
});

test('lens names: brand words, mount spacing, f/ and en dashes', () => {
  assert.equal(tidyLens('NIKKOR Z 100-400mm f/4.5-5.6 VR S'), 'Nikkor Z 100–400mm f/4.5–5.6 VR S');
  assert.equal(tidyLens('FE 70-200mm F2.8 GM OSS II'), 'FE 70–200mm f/2.8 GM OSS II');
  assert.equal(tidyLens('XF16-55mmF2.8 R LM WR'), 'XF 16–55mm f/2.8 R LM WR');
  assert.equal(tidyLens('RF100-500mm F4.5-7.1 L IS USM'), 'RF 100–500mm f/4.5–7.1 L IS USM');
  assert.equal(tidyLens('SIGMA 150-600mm F5-6.3 DG DN OS | S'), 'Sigma 150–600mm f/5–6.3 DG DN OS | S');
  assert.equal(tidyLens('EF24-70mm f/2.8L II USM'), 'EF 24–70mm f/2.8L II USM');
  assert.equal(tidyLens('smc PENTAX-DA 18-55mm F3.5-5.6 AL'), 'smc PENTAX-DA 18–55mm f/3.5–5.6 AL');
  // Already tidy: unchanged.
  assert.equal(tidyLens('Nikkor Z 24–120mm f/4 S'), 'Nikkor Z 24–120mm f/4 S');
});

test('your rules win, a rule can be turned off, and turning built-in rules off is remembered by id', () => {
  const raw = label('NIKON CORPORATION', 'NIKON Z5_2');
  const mine = renameRule('camera', raw, 'Dave’s Z5');
  assert.equal(friendlyCamera(raw, rulesInUse({ yours: [mine] })), 'Dave’s Z5');
  assert.equal(friendlyCamera(raw, rulesInUse({ yours: [{ ...mine, on: false }] })), 'Nikon Z5 II');
  // Turning off Nikon's maker rule leaves the raw value as it is.
  assert.equal(friendlyCamera(raw, rulesInUse({ builtinOff: ['make:NIKON CORPORATION', 'make:NIKON'] })), 'NIKON Z5_2');
  // Lens tidying off: the raw lens name stays.
  assert.equal(friendlyLens('NIKKOR Z 100-400mm f/4.5-5.6 VR S', rulesInUse({ builtinOff: ['tidy:lens'] })), 'NIKKOR Z 100-400mm f/4.5-5.6 VR S');
  // Saved rules are checked: an empty "With" is ignored.
  assert.equal(rulesInUse({ yours: [{ ...mine, with: '  ' }] }).filter((rule) => rule.source === 'yours').length, 0);
  assert.ok(BUILTIN_RULES.every((rule) => rule.source === 'builtin'));
  assert.equal(new Set(BUILTIN_RULES.map((rule) => rule.id)).size, BUILTIN_RULES.length, 'built-in rule ids are unique');
});
