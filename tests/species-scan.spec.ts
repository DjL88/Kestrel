import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The stand-in model always "sees" a red kite. The subject finder is the real bundled one.
const standIn = readFileSync('tests/fixtures/stand-in-species.onnx');

test('after import, species appears quietly and the info pop-up can change it', async ({ page }) => {
  await page.route('**/stand-in-species.onnx', (route) => route.fulfill({ body: standIn, contentType: 'application/octet-stream' }));
  await page.goto('/');
  // Photos with one clear subject, so the subject finder has something to find.
  const pictures = await page.evaluate(() => Array.from({ length: 3 }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 500;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#3b556b'; c.fillRect(0, 0, 800, 500);
    c.fillStyle = '#c0392b'; c.beginPath(); c.ellipse(560 - index * 40, 250, 130, 160, 0, 0, 7); c.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Scan');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, index) => ({ name: `bird-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30000 });

  // On the project page, not in the editor: an offer to turn it on, then progress as the photos are looked at.
  const banner = page.getByRole('region', { name: 'Species recognition' });
  await expect(banner.getByRole('button', { name: /^Download/ })).toBeHidden();
  await banner.getByText('Identify birds and animals', { exact: true }).click();
  await banner.getByRole('button', { name: /^Download/ }).click();
  await expect(page.getByTestId('subject-flash')).toHaveCount(0);

  // Every card ends up named, and marked as automatic.
  const labels = page.getByTestId('species-label');
  await expect(labels).toHaveCount(3, { timeout: 60000 });
  for (const label of await labels.all()) {
    await expect(label).toContainText('Species: Red kite');
    await expect(label.getByText('Auto', { exact: true })).toBeVisible();
  }
  await expect(banner).toHaveCount(0);

  // The info pop-up shows what was found and lets it be changed: remove the automatic name and give another.
  await page.getByRole('button', { name: 'Photo info and rating for bird-1.png' }).click();
  const info = page.getByRole('complementary', { name: 'Photo info' });
  await expect(info.getByRole('list', { name: 'Tags' })).toContainText('Red kite');
  await expect(info.getByRole('button', { name: 'Wildlife' })).toHaveAttribute('aria-pressed', 'true');
  await info.getByRole('button', { name: 'Remove tag Red kite' }).click();
  await info.getByLabel('Add a tag').fill('Common buzzard');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: 'Frame bird-1.png' }).getByTestId('species-label')).toContainText('Species: Common buzzard');
  await expect(page.getByRole('article', { name: 'Frame bird-1.png' }).getByTestId('species-label').getByText('Auto', { exact: true })).toHaveCount(0);

  // Looked at once only: after a reload nothing is looked at again, and the name stays.
  await page.waitForTimeout(2000);
  await page.reload();
  await page.getByRole('button', { name: 'Scan 3 photos' }).click();
  await expect(page.getByRole('article', { name: 'Frame bird-1.png' }).getByTestId('species-label')).toContainText('Species: Common buzzard', { timeout: 30000 });
  await expect(page.getByRole('region', { name: 'Species recognition' })).toHaveCount(0);
});
