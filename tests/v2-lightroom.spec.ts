import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop File menu.');
});

/** A small synthetic catalogue laid out like Lightroom Classic's, holding one photo with a flag, rating, keyword and edit. */
function catalogue(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'lrcat-e2e-'));
  try {
    const db = new DatabaseSync(join(dir, 'c.lrcat'));
    db.exec(`
      CREATE TABLE AgLibraryRootFolder (id_local INTEGER PRIMARY KEY, absolutePath);
      CREATE TABLE AgLibraryFolder (id_local INTEGER PRIMARY KEY, pathFromRoot, rootFolder INTEGER);
      CREATE TABLE AgLibraryFile (id_local INTEGER PRIMARY KEY, baseName, extension, folder INTEGER);
      CREATE TABLE Adobe_images (id_local INTEGER PRIMARY KEY, captureTime, masterImage INTEGER, pick, rating, rootFile INTEGER);
      CREATE TABLE Adobe_imageDevelopSettings (id_local INTEGER PRIMARY KEY, image INTEGER, text);
      CREATE TABLE AgLibraryKeyword (id_local INTEGER PRIMARY KEY, name);
      CREATE TABLE AgLibraryKeywordImage (id_local INTEGER PRIMARY KEY, image INTEGER, tag INTEGER);
      INSERT INTO AgLibraryRootFolder VALUES (1, '/Users/sam/Pictures/');
      INSERT INTO AgLibraryFolder VALUES (1, 'Coast/', 1);
      INSERT INTO AgLibraryFile VALUES (1, 'DSC_0042', 'jpg', 1), (2, 'DSC_9999', 'NEF', 1);
      INSERT INTO Adobe_images VALUES (1, NULL, NULL, 1, 3, 1), (2, NULL, NULL, 0, 5, 2);
      INSERT INTO Adobe_imageDevelopSettings VALUES (1, 1, 's = { Exposure2012 = 0.65, Contrast2012 = 20, ProcessVersion = "11.0", }');
      INSERT INTO AgLibraryKeyword VALUES (1, 'Peregrine');
      INSERT INTO AgLibraryKeywordImage VALUES (1, 1, 1);
    `);
    db.close();
    return readFileSync(join(dir, 'c.lrcat'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('?v2 File menu brings a Lightroom catalogue\'s flag, rating, keyword and edit onto the matching photo', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Lightroom check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'DSC_0042.jpg', mimeType: 'image/jpeg', buffer: readFileSync('tests/fixtures/exif-photo.jpg') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });

  await root.getByRole('button', { name: 'File', exact: true }).click();
  await expect(root.getByRole('menuitem', { name: 'Bring in a Lightroom catalogue…' })).toBeVisible();
  await page.keyboard.press('Escape');

  await root.getByTestId('lightroom-input').setInputFiles([{ name: 'Lightroom Catalog.lrcat', mimeType: 'application/octet-stream', buffer: catalogue() }]);
  await expect(root.getByText(/for 1 of the 2 photos in the catalogue/)).toBeVisible({ timeout: 15000 });
  await expect(root.getByText(/1 catalogue photos were not brought in/)).toBeVisible();
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);

  // Not a catalogue: refused in words, nothing changes.
  await root.getByTestId('lightroom-input').setInputFiles([{ name: 'notes.lrcat', mimeType: 'application/octet-stream', buffer: Buffer.from('hello') }]);
  await expect(root.getByText(/not a Lightroom Classic catalogue/)).toBeVisible({ timeout: 15000 });
  await expect(root.getByTestId('decision-filter-flagged')).toHaveText(/Flagged \(1\)/);
});
