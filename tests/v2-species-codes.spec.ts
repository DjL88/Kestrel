import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unlockPro } from './helpers';

// A synthetic drawn photo (tests/fixtures/make_gps_fixtures.py).
const photo = readFileSync('tests/fixtures/gps-london.jpg');

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Info is reached from the desktop rail in this check');
});

test('?v2 species name box: a four-letter banding code finds the bird, and picking it fills in the name', async ({ page }) => {
  await unlockPro(page);
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Banding');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'robin.jpg', mimeType: 'image/jpeg', buffer: photo }]);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  await expect(options).toHaveCount(1, { timeout: 30000 });
  await options.first().click();
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();

  await root.getByRole('button', { name: 'Correct species name' }).click();
  const box = root.getByRole('combobox', { name: 'Correct species name' });
  await box.fill('amro');
  const suggestions = root.getByRole('listbox', { name: 'Correct species name' });
  await expect(suggestions.getByRole('option').first()).toContainText('American Robin · AMRO', { timeout: 20000 });
  await expect(suggestions.getByRole('option').first()).toContainText('Turdus migratorius');

  // Keyboard: down arrow and Enter pick it; the person still saves.
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(box).toHaveValue('American Robin');
  await expect(suggestions).toHaveCount(0);
  await root.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(root.getByText('American Robin', { exact: true }).first()).toBeVisible();

  // Any name is still accepted, with or without a suggestion.
  await root.getByRole('button', { name: 'Correct species name' }).click();
  await box.fill('Garden bird');
  await root.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(root.getByText('Garden bird', { exact: true }).first()).toBeVisible();
});
