import { expect, test } from '@playwright/test';
import { createDemoShootState } from '../src/core/cullingEngine';
import { recordEdit } from '../src/core/editHistory';
import { DEFAULT_EDIT } from '../src/core/photoEdits';
import { createEmptyProject } from '../src/core/projects';
import { encodeProjectBackup } from '../src/core/projectBackup';

test('a portable backup restores the photo’s undo and redo controls', async ({ page }) => {
  const project = createDemoShootState(1);
  project.shoot.title = 'Backup fixture';
  project.frames[0] = recordEdit(project.frames[0], { edit: { ...DEFAULT_EDIT, exposure: 0.5 } }, 1000);

  await page.goto('/');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'fixture.kestrel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeProjectBackup(project)),
  });
  await expect(page.getByText('Backup fixture (restored)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const actions = page.getByRole('toolbar', { name: 'Editor actions' });
  const undo = actions.getByRole('button', { name: 'Undo', exact: true });
  const redo = actions.getByRole('button', { name: 'Redo', exact: true });
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
});


test('Projects counts the same photos as All photos after restoring a catalogue with removed items', async ({ page }) => {
  const project = createDemoShootState(2);
  project.shoot.title = 'Photo count fixture';
  project.frames[1].removedAt = 1000;

  await page.goto('/');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'count.kestrel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeProjectBackup(project)),
  });
  await expect(page.getByRole('button', { name: 'All photos 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const projectRow = page.getByRole('button', { name: /^Photo count fixture \(restored\)/ });
  await expect(projectRow).toContainText('1 photo');
  await expect(projectRow).not.toContainText('2 photos');
  await page.reload();
  await expect(projectRow).toContainText('1 photo');
});


test('originals reconnected to a restored catalogue stay available after reopening', async ({ page }) => {
  await page.goto('/');
  const filename = 'relink-fixture.png';
  const lastModified = 1700000000000;
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#457';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (character) => character.charCodeAt(0));
  });
  const project = createEmptyProject('fixture-relink', 'Relink fixture');
  const { demoVariant: _demoVariant, ...template } = createDemoShootState(1).frames[0];
  project.frames = [{
    ...template, id: 'relink-photo', filename, stableKey: `local-file://${filename}::${bytes.length}::${lastModified}`,
    isDemo: false, sourceKind: 'file', decision: 'unreviewed',
  }];
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'relink.kestrel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeProjectBackup(project)),
  });

  const reopen = page.getByRole('button', { name: 'Re-open Files', exact: true });
  await expect(reopen).toBeVisible();
  await page.locator('input[type="file"][accept=".jpg,.jpeg,.png,.webp,.nef,.nrw"]').evaluate((input: HTMLInputElement, data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data.bytes)], data.filename, { type: 'image/png', lastModified: data.lastModified }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { bytes, filename, lastModified });
  await expect(reopen).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.reload();
  await page.getByRole('button', { name: /^Relink fixture \(restored\)/ }).click();
  await expect(page.getByRole('button', { name: `View ${filename}`, exact: true })).toBeVisible();
  await expect(reopen).toHaveCount(0);
});
