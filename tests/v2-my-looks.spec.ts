import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Your own looks (#1154, custom presets): save the current sliders under a name, apply them to another photo as one
// undoable step, rename, delete, keep them after a reload, and share them as a small file. A look is a recipe only.

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop side panel.'); });

async function openTwoPhotos(page: Page) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Looks check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const images = await page.evaluate(() => ['#6a7480', '#a07850'].map((colour) => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const ctx = c.getContext('2d')!; ctx.fillStyle = colour; ctx.fillRect(0, 0, 300, 200);
    return c.toDataURL('image/png').split(',')[1];
  }));
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles(images.map((data, i) => ({ name: `photo-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(root.getByTestId('canvas-frame').locator('img').first()).toBeVisible({ timeout: 30000 });
  const styles = root.getByRole('tab', { name: 'Photo styles' });
  if (!(await styles.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await expect(styles).toBeVisible();
  return root;
}

test('save a look, apply it as one undoable step, rename, delete, reload and share it as a file', async ({ page }) => {
  const root = await openTwoPhotos(page);
  const mine = root.getByTestId('user-looks');
  await expect(mine).toContainText('You have not saved any looks yet.');

  // Give the first photo a built-in look, then save its sliders as a look of your own.
  await root.getByRole('button', { name: /^Highland Mist/ }).click();
  await mine.getByLabel('Name for this look').fill('  Misty   morning ');
  await mine.getByRole('button', { name: 'Add as a look' }).click();
  await expect(page.getByText('Saved the look "Misty morning" on this device.')).toBeVisible();
  const tile = mine.getByRole('button', { name: /^Misty morning/ });
  await expect(tile).toBeVisible();

  // Same name again updates that look instead of adding a second one.
  await mine.getByLabel('Name for this look').fill('misty MORNING');
  await mine.getByRole('button', { name: 'Add as a look' }).click();
  await expect(page.getByText(/Updated your look "misty MORNING"/)).toBeVisible();
  await expect(mine.getByRole('listitem')).toHaveCount(1);

  // On a fresh photo, applying it is one step: Undo takes it straight back.
  await root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option').nth(1).click();
  await mine.getByRole('button', { name: /^misty MORNING/ }).click();
  await expect(mine.getByRole('button', { name: /^misty MORNING · Applied/ })).toHaveAttribute('aria-pressed', 'true');
  await root.getByRole('tab', { name: 'Advanced Edits' }).click();
  await expect(root.getByRole('slider', { name: /^Highlights/ }).first()).toHaveValue('-22');
  await expect(root.getByRole('slider', { name: /^Shadows/ }).first()).toHaveValue('26');
  await page.keyboard.press('Control+z');
  await expect(root.getByRole('slider', { name: /^Highlights/ }).first()).not.toHaveValue('-22');
  await root.getByRole('tab', { name: 'Photo styles' }).click();

  // Rename refuses an empty name, then accepts a new one.
  await mine.getByRole('button', { name: 'Rename misty MORNING' }).click();
  await mine.getByLabel('New name for misty MORNING').fill('Highland dawn');
  await mine.getByRole('button', { name: 'Use name' }).click();
  await expect(mine.getByRole('button', { name: /^Highland dawn/ })).toBeVisible();

  // It is still there after a reload: kept on this device.
  await page.reload();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kestrel.v2.userLooks') ?? '[]'));
  expect(stored).toHaveLength(1);
  expect(stored[0].name).toBe('Highland dawn');
  expect(stored[0].recipe.highlights).toBe(-22);
  expect(Object.keys(stored[0].recipe)).not.toContain('masks');
});

test('looks travel as a file: export, delete, import back, and a wrong file changes nothing', async ({ page }) => {
  const root = await openTwoPhotos(page);
  const mine = root.getByTestId('user-looks');
  await root.getByRole('button', { name: /^Golden Heather/ }).click();
  await mine.getByLabel('Name for this look').fill('Warm evening');
  await mine.getByRole('button', { name: 'Add as a look' }).click();

  const download = page.waitForEvent('download');
  await mine.getByRole('button', { name: 'Send looks to another device' }).click();
  const file = await (await download).path();
  const text = await readFile(file!, 'utf8');
  const data = JSON.parse(text);
  expect(data.format).toBe('kestrel-looks');
  expect(data.looks[0].name).toBe('Warm evening');
  expect(data.looks[0].recipe.temperature).toBe(22);

  await mine.getByRole('button', { name: 'Delete Warm evening' }).click();
  await expect(page.getByText(/Deleted the look "Warm evening"/)).toBeVisible();
  await expect(mine).toContainText('You have not saved any looks yet.');

  await mine.getByTestId('user-looks-file').setInputFiles({ name: 'keys.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"kestrel-keymap"}') });
  await expect(page.getByText('That file is not a Kestrel looks file.')).toBeVisible();
  await expect(mine).toContainText('You have not saved any looks yet.');

  await mine.getByTestId('user-looks-file').setInputFiles({ name: 'kestrel-looks.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByText('Looks added: 1. Looks updated: 0.')).toBeVisible();
  await expect(mine.getByRole('button', { name: /^Warm evening/ })).toBeVisible();
});
