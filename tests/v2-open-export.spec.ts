import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop File menu.');
});

test('?v2 File menu exports the whole project in open formats: XMP with ratings, CSV and full recipes', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Open export');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0042.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') }]);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(1, { timeout: 30000 });
  await options.first().click();
  await page.keyboard.press('3');

  await root.getByRole('button', { name: 'File', exact: true }).click();
  const download = page.waitForEvent('download');
  await root.getByRole('menuitem', { name: 'Export everything in open formats…' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('Open export - InFlight export.zip');
  const files = unzipSync(new Uint8Array(readFileSync(await saved.path())));
  expect(Object.keys(files).sort()).toEqual(['README.txt', 'catalogue.csv', 'recipes.json', 'xmp/DSC_0042.xmp']);
  expect(strFromU8(files['xmp/DSC_0042.xmp'])).toMatch(/xmp:Rating="3"/);
  expect(JSON.parse(strFromU8(files['recipes.json'])).photos[0].file).toBe('DSC_0042.jpg');
  await expect(root.getByText(/in open formats \(XMP, CSV and JSON\)/)).toBeVisible();
});
