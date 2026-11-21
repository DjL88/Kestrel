import { expect, test, type Page } from '@playwright/test';
import { openInfoFor, subjectTab } from './helpers';

test.use({ serviceWorkers: 'block' });

const demo = 'src/assets/images/demo_collie_coco_run_1794721997913.jpg';

async function openSubjectReview(page: Page) {
  await page.goto('/');
  const blank = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return canvas.toDataURL().split(',')[1];
  });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Subject review');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const input = page.getByTestId('local-file-input');
  await input.setInputFiles(demo);
  await expect(page.getByRole('article', { name: /Frame demo_collie/ })).toBeVisible();
  const add = page.getByRole('button', { name: /add photos/i });
  await add.first().click();
  await input.setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: Buffer.from(blank, 'base64') });
  await expect(page.getByRole('article', { name: 'Frame blank.png' })).toBeVisible();
}

test('inspect original-sized subject crops, then switch photos without carrying over results', async ({ page }) => {
  await openSubjectReview(page);
  await openInfoFor(page, demo.split('/').at(-1)!);
  await subjectTab(page);
  const panel = page.getByRole('region', { name: 'Find subjects' });
  await panel.getByRole('button', { name: 'Find subjects' }).click();
  await expect(panel.getByRole('status')).toHaveText(/looking for subjects/i);
  await expect(panel.getByRole('status')).toHaveText(/view its crop at 100%/, { timeout: 40000 });
  await panel.getByRole('listitem').getByRole('button').first().click();
  const crop = panel.getByRole('img');
  await expect(crop).toBeVisible();
  const width = await crop.evaluate((node: HTMLCanvasElement) => ({ native: node.width, shown: node.getBoundingClientRect().width }));
  expect(width.native).toBeGreaterThan(1);
  expect(width.shown).toBe(width.native);
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 2' })).toBeVisible();

  await openInfoFor(page, 'blank.png');
  await subjectTab(page);
  await expect(panel.getByRole('listitem')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Find subjects' }).click();
  await expect(panel.getByRole('status')).toHaveText('No clear subjects found.', { timeout: 40000 });
});

test('a missing local model is retryable and is not reported as an empty scan', async ({ page }) => {
  const model = /yolox_tiny[^/]*\.onnx(?:\?|$)/;
  await page.route(model, (route) => route.fulfill({ status: 404 }));
  await openSubjectReview(page);
  await openInfoFor(page, 'blank.png');
  await subjectTab(page);
  const panel = page.getByRole('region', { name: 'Find subjects' });
  const find = panel.getByRole('button', { name: 'Find subjects' });
  await find.click();
  await expect(panel.getByRole('status')).toHaveText(/could not check this photo/i);
  await page.unroute(model);
  await find.click();
  await expect(panel.getByRole('status')).toHaveText('No clear subjects found.', { timeout: 40000 });
});
