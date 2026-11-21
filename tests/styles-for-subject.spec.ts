import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const photo = readFileSync('src/assets/images/demo_red_kite_flight_1794721996053.jpg');

async function openAuto(page: Page) {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.getByRole('tab', { name: 'Auto' }).click();
  const summary = page.getByText('Recipes', { exact: true });
  await summary.waitFor();
  if (!(await page.getByRole('group', { name: 'Photo recipes gallery' }).isVisible())) await summary.click();
  await expect(page.getByRole('group', { name: 'Photo recipes gallery' })).toBeVisible();
}

test('no style suggestions when the subject is unknown', async ({ page }) => {
  test.skip(test.info().project.name === 'phone', 'desktop layout');
  await openAuto(page);
  await expect(page.getByTestId('styles-for-subject')).toHaveCount(0);
});

// Positive path (pick a subject, apply a style, undo) needs a library photo with a subject kind: Quick edit has no Subject panel.
// Not yet covered end to end; bounds and abstention are unit-tested in src/core/styleLibrary.test.ts.
