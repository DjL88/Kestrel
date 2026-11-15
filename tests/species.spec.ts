import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The stand-in model always "sees" a red kite, so the whole path can be tested without the real 89 MB model.
const standIn = readFileSync('tests/fixtures/stand-in-species.onnx');

test('species suggestions: download once, look at the photo, accept a name, and it becomes a tag', async ({ page }) => {
  await page.route('**/stand-in-species.onnx', (route) => route.fulfill({ body: standIn, contentType: 'application/octet-stream' }));
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();

  const panel = page.getByRole('region', { name: 'Species suggestions' });
  await expect(panel.getByText(/never leave this device/)).toBeVisible();
  await panel.getByRole('button', { name: /^Download/ }).click();

  // After the download the photo is looked at, and a name is offered with how sure the model is.
  const suggestion = panel.getByRole('list', { name: 'Suggested names' }).getByRole('listitem').first();
  await expect(suggestion).toContainText('Red kite', { timeout: 30000 });
  await expect(suggestion).toContainText('Milvus milvus');
  await expect(suggestion).toContainText('likely');

  // Nothing is added until it is accepted. Accepting adds the tag and, with no kind chosen yet, sets Wildlife.
  const subject = page.getByRole('region', { name: 'What is in this photo' });
  await expect(subject.getByRole('list', { name: 'Tags' })).toHaveCount(0);
  await suggestion.getByRole('button', { name: 'Use Red kite' }).click();
  await expect(subject.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Red kite']);
  await expect(subject.getByRole('button', { name: 'Wildlife' })).toHaveAttribute('aria-pressed', 'true');
  // An accepted name is not offered again.
  await expect(panel.getByRole('list', { name: 'Suggested names' })).toHaveCount(0);

  // The model and accepted tag stay on the device. Reopening the same photo must not offer the tag again.
  await page.reload();
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
  await expect(page.getByRole('region', { name: 'Species suggestions' }).getByRole('button', { name: /^Download/ })).toHaveCount(0);
  await expect(panel.getByText('Nothing else to suggest.')).toBeVisible({ timeout: 15000 });
  await expect(subject.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Red kite']);
});

test('a suggestion can be dismissed, and the choice is not kept as a tag', async ({ page }) => {
  await page.route('**/stand-in-species.onnx', (route) => route.fulfill({ body: standIn, contentType: 'application/octet-stream' }));
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
  const panel = page.getByRole('region', { name: 'Species suggestions' });
  await panel.getByRole('button', { name: /^Download/ }).click();
  await expect(panel.getByRole('button', { name: 'Not Red kite' })).toBeVisible({ timeout: 30000 });
  await panel.getByRole('button', { name: 'Not Red kite' }).click();
  await expect(panel.getByText('Nothing else to suggest.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'What is in this photo' }).getByRole('list', { name: 'Tags' })).toHaveCount(0);
});
