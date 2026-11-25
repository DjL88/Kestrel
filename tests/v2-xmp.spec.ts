import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop File menu.');
});

const sidecar = (rating: number, pick: number, keyword: string) => `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpDM="http://ns.adobe.com/xmp/1.0/DynamicMedia/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmp:Rating="${rating}" xmpDM:pick="${pick}">
<dc:subject><rdf:Bag><rdf:li>${keyword}</rdf:li></rdf:Bag></dc:subject>
</rdf:Description></rdf:RDF></x:xmpmeta>`;

test('?v2 File menu saves ratings as an XMP sidecar and reads one back onto the matching photo', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('XMP check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const shot = readFileSync('tests/fixtures/exif-photo.jpg');
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0042.jpg', mimeType: 'image/jpeg', buffer: shot }]);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(1, { timeout: 30000 });
  await options.first().click();
  await page.keyboard.press('4');

  // Save: one photo gives one .xmp named after the original, carrying the rating.
  await root.getByRole('button', { name: 'File', exact: true }).click();
  const download = page.waitForEvent('download');
  await root.getByRole('menuitem', { name: 'Save ratings to XMP…' }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('DSC_0042.xmp');
  const text = readFileSync(await saved.path());
  expect(text.toString()).toMatch(/Rating="?4|<xmp:Rating>4</);

  // Read: a sidecar from another app flags the photo, rates it 2 and adds a tag.
  await root.getByTestId('xmp-input').setInputFiles([{ name: 'DSC_0042.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(sidecar(2, 1, 'Peregrine')) }]);
  await expect(root.getByText(/Read ratings, flags and tags for 1 photo/)).toBeVisible({ timeout: 15000 });
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);

  // A sidecar for a photo that is not here changes nothing and says so.
  await root.getByTestId('xmp-input').setInputFiles([{ name: 'OTHER.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(sidecar(5, -1, 'x')) }]);
  await expect(root.getByText(/None of those sidecars matches a photo here/)).toBeVisible({ timeout: 15000 });
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);
});
