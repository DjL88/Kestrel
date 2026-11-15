import { expect, test } from '@playwright/test';
import { createDemoShootState } from '../src/core/cullingEngine';
import { recordEdit } from '../src/core/editHistory';
import { DEFAULT_EDIT } from '../src/core/photoEdits';
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
