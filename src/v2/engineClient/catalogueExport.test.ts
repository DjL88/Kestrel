import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { createDemoShootState } from '../../core/cullingEngine';
import { parseDevelopSettings } from '../../core/lightroomCatalogue';
import type { CullingState } from '../../core/types';
import { buildCatalogueExport, cameraRawSettings, sidecarWithEdit } from './catalogueExport';
import { developToRecipe } from './lightroomOps';
import { applyRecipePatch, editToRecipe } from './recipeMap';

function shoot(): CullingState {
  const base = createDemoShootState(3);
  const edit = applyRecipePatch(undefined, { exposure: 0.7, contrast: 20, highlights: -40, shadows: 35, clarity: 12, vibrance: 8, dehaze: 15, vignette: -20 }).edit;
  return {
    ...base,
    shoot: { ...base.shoot, title: 'Skye, May' },
    frames: base.frames.map((frame, i) => ({
      ...frame, isDemo: false, removedAt: undefined, filename: `DSC_000${i}.NEF`, autoTags: ['Suggested'],
      decision: i === 0 ? 'keep' : i === 1 ? 'reject' : 'unreviewed', rating: i === 0 ? 4 : 0,
      tags: i === 0 ? ['Golden eagle', 'Suggested'] : i === 2 ? ['=HYPERLINK("x")'] : [], edit: i === 0 ? edit : undefined, editHistory: undefined,
    })),
  };
}

test('the open-format export holds a sidecar per photo, a CSV, the full recipes and a README, and no pixels', () => {
  const state = shoot();
  const output = buildCatalogueExport(state, new Date('2026-11-25T12:00:00Z'))!;
  assert.equal(output.name, 'Skye May - InFlight export.zip');
  assert.equal(output.photos, 3);
  assert.equal(output.edited, 1);
  return output.blob.arrayBuffer().then((buffer) => {
    const files = unzipSync(new Uint8Array(buffer));
    assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'catalogue.csv', 'recipes.json', 'xmp/DSC_0000.xmp', 'xmp/DSC_0001.xmp', 'xmp/DSC_0002.xmp']);
    const xmp = strFromU8(files['xmp/DSC_0000.xmp']);
    assert.match(xmp, /xmp:Rating="4"/);
    assert.match(xmp, /xmpDM:pick="1"/);
    assert.match(xmp, /crs:Exposure2012="\+0\.70"/);
    assert.match(xmp, /<rdf:li>Golden eagle<\/rdf:li>/);
    assert.doesNotMatch(xmp, /Suggested/, 'tags the app suggested and the person never kept are not exported as keywords');
    assert.doesNotMatch(strFromU8(files['xmp/DSC_0001.xmp']), /crs:/, 'no edit, no Camera Raw settings');
    const csv = strFromU8(files['catalogue.csv']);
    assert.match(csv, /DSC_0000\.NEF,,flagged,4,Golden eagle,/);
    assert.match(csv, /DSC_0001\.NEF,,set aside,/);
    assert.match(csv, /"'=HYPERLINK\(""x""\)"/, 'a keyword is never run as a spreadsheet formula');
    const recipes = JSON.parse(strFromU8(files['recipes.json']));
    assert.equal(recipes.format, 'inflight-recipes');
    assert.deepEqual(recipes.photos[0].edit, state.frames[0].edit, 'the full recipe, lossless');
  });
});

test('Camera Raw settings round-trip through InFlight\'s own Lightroom reader to the same sliders', () => {
  const [frame] = shoot().frames;
  const settings = cameraRawSettings(frame)!;
  const lua = `s = { ${Object.entries(settings).map(([key, value]) => `${key} = ${/^[+-]?\d/.test(value) ? value.replace(/^\+/, '') : `"${value}"`},`).join('\n')} }`;
  const back = editToRecipe(applyRecipePatch(undefined, developToRecipe(parseDevelopSettings(lua))).edit);
  const original = editToRecipe(frame.edit);
  for (const key of ['exposure', 'contrast', 'highlights', 'shadows', 'clarity', 'vibrance', 'dehaze', 'vignette'] as const) {
    assert.equal(back[key], original[key], key);
  }
  assert.equal(cameraRawSettings({ edit: undefined }), null);
  assert.equal(sidecarWithEdit({ ...frame, edit: undefined }).bytes.length > 0, true);
});

test('black and white is written as Convert to Greyscale, not as a saturation number', () => {
  const [frame] = shoot().frames;
  const mono = { ...frame, edit: applyRecipePatch(undefined, { saturation: -100 }).edit };
  const settings = cameraRawSettings(mono)!;
  assert.equal(settings.ConvertToGrayscale, 'True');
  assert.equal(settings.Saturation, undefined);
});
