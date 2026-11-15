import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The stand-in model always "sees" a red kite, so the whole path can be tested without the real 89 MB model.
const standIn = readFileSync('tests/fixtures/stand-in-species.onnx');

test('species suggestions: with automatic tagging off, accept a name and it becomes a tag', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kestrel.autoTag.v1', 'off'));
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
  // The catalogue saves a moment after a change, so give it that moment before reloading.
  await page.waitForTimeout(2000);
  await page.reload();
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
  await expect(panel.getByRole('button', { name: /^Download/ })).toHaveCount(0);
  await expect(panel.getByText('Nothing else to suggest.')).toBeVisible({ timeout: 15000 });
  await expect(subject.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Red kite']);

  // A different photo this time: the first one is already tagged, so a suggestion for it would rightly stay hidden.
  await page.reload();
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'second.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
  await expect(panel.getByRole('button', { name: /^Download/ })).toHaveCount(0);
  await expect(panel.getByRole('list', { name: 'Suggested names' })).toContainText('Red kite', { timeout: 30000 });
});

test('a suggestion can be dismissed, and the choice is not kept as a tag', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kestrel.autoTag.v1', 'off'));
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

async function openBurst(page: import('@playwright/test').Page) {
  await page.route('**/stand-in-species.onnx', (route) => route.fulfill({ body: standIn, contentType: 'application/octet-stream' }));
  await page.goto('/');
  // Three shots with the same capture time are one burst. Make a project and add them.
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Burst');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const photo = readFileSync('tests/fixtures/exif-photo.jpg');
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(['DSC_0101.jpg', 'DSC_0102.jpg', 'DSC_0103.jpg'].map((name) => ({ name, mimeType: 'image/jpeg', buffer: photo })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
  const panel = page.getByRole('region', { name: 'Species suggestions' });
  await panel.getByRole('button', { name: /^Download/ }).click();
  // The photo is tagged by itself (the stand-in is always sure), then the rest of the burst is offered.
  return panel.getByRole('group', { name: 'Tag similar photos' });
}

async function tagsOf(page: import('@playwright/test').Page, filename: string) {
  await page.getByRole('button', { name: `Jump to frame ${filename}` }).click();
  await page.getByRole('region', { name: 'Photo editor' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
  const subject = page.getByRole('region', { name: 'What is in this photo' });
  await expect(subject).toBeVisible();
  return subject;
}

test('declining a burst offer leaves the other photos untagged', async ({ page }) => {
  const offer = await openBurst(page);
  await expect(offer).toContainText('2 other photos in this burst look the same', { timeout: 30000 });
  await offer.getByRole('button', { name: 'No thanks' }).click();
  await expect(offer).toHaveCount(0);
  // Disable per-photo auto-tagging before opening another frame so the assertion tests the burst action alone.
  await page.getByLabel('Automatically tag strong matches').uncheck();
  const other = await tagsOf(page, 'DSC_0102.jpg');
  await expect(other.getByRole('list', { name: 'Tags' })).toHaveCount(0);
});

test('agreeing tags the whole burst, setting Wildlife where no kind was chosen', async ({ page }) => {
  const offer = await openBurst(page);
  await expect(offer).toContainText('2 other photos in this burst look the same', { timeout: 30000 });
  await offer.getByRole('button', { name: 'Tag all 2' }).click();
  await expect(offer).toHaveCount(0);
  for (const name of ['DSC_0102.jpg', 'DSC_0103.jpg']) {
    const subject = await tagsOf(page, name);
    await expect(subject.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Red kite']);
    await expect(subject.getByRole('button', { name: 'Wildlife' })).toHaveAttribute('aria-pressed', 'true');
  }
});


test('when the model is sure the photo is tagged automatically, marked Auto, and can be kept', async ({ page }) => {
  await page.route('**/stand-in-species.onnx', (route) => route.fulfill({ body: standIn, contentType: 'application/octet-stream' }));
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
  await page.getByRole('region', { name: 'Species suggestions' }).getByRole('button', { name: /^Download/ }).click();
  const subject = page.getByRole('region', { name: 'What is in this photo' });
  const tag = subject.getByRole('list', { name: 'Tags' }).getByRole('listitem');
  await expect(tag).toContainText('Red kite', { timeout: 30000 });
  await expect(tag.getByText('Auto', { exact: true })).toBeVisible();
  await expect(subject.getByRole('button', { name: 'Wildlife' })).toHaveAttribute('aria-pressed', 'true');
  // Keeping it makes it an ordinary tag.
  await tag.getByRole('button', { name: 'Keep tag Red kite' }).click();
  await expect(tag.getByText('Auto', { exact: true })).toHaveCount(0);
  await expect(tag).toContainText('Red kite');
});

test('an automatic tag that is removed is never put back on that photo', async ({ page }) => {
  await page.route('**/stand-in-species.onnx', (route) => route.fulfill({ body: standIn, contentType: 'application/octet-stream' }));
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
  const panel = page.getByRole('region', { name: 'Species suggestions' });
  await panel.getByRole('button', { name: /^Download/ }).click();
  const subject = page.getByRole('region', { name: 'What is in this photo' });
  await expect(subject.getByRole('list', { name: 'Tags' })).toContainText('Red kite', { timeout: 30000 });
  await subject.getByRole('button', { name: 'Remove tag Red kite' }).click();
  await expect(subject.getByRole('list', { name: 'Tags' })).toHaveCount(0);
  // Looking again does not tag it a second time. The name is offered as a suggestion to accept, nothing more.
  await panel.getByRole('button', { name: 'Look again' }).click();
  await expect(panel.getByRole('button', { name: 'Use Red kite' })).toBeVisible({ timeout: 30000 });
  await expect(subject.getByRole('list', { name: 'Tags' })).toHaveCount(0);
  // Accepting it by hand makes it an ordinary tag, with no Auto marker.
  await panel.getByRole('button', { name: 'Use Red kite' }).click();
  await expect(subject.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Red kite']);
  await expect(subject.getByText('Auto', { exact: true })).toHaveCount(0);
});

test('automatic tagging can be switched off, and then a new photo is only offered a name', async ({ page }) => {
  await page.route('**/stand-in-species.onnx', (route) => route.fulfill({ body: standIn, contentType: 'application/octet-stream' }));
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles('tests/fixtures/exif-photo.jpg');
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
  const panel = page.getByRole('region', { name: 'Species suggestions' });
  await panel.getByRole('button', { name: /^Download/ }).click();
  await expect(page.getByRole('region', { name: 'What is in this photo' }).getByRole('list', { name: 'Tags' })).toContainText('Red kite', { timeout: 30000 });
  await panel.getByLabel('Automatically tag strong matches').uncheck();
  // A different photo: the model is just as sure, but nothing is added until it is accepted.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  const toProjects = page.getByRole('button', { name: 'Back to projects' });
  if (await toProjects.isVisible()) await toProjects.click();
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'another.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.getByRole('region', { name: 'Species suggestions' }).getByRole('button', { name: 'Use Red kite' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('region', { name: 'What is in this photo' }).getByRole('list', { name: 'Tags' })).toHaveCount(0);
});
