import { expect, test } from '@playwright/test';
import { createDemoShootState } from '../src/core/cullingEngine';
import { encodeProjectBackup } from '../src/core/projectBackup';
import { DEFAULT_EDIT } from '../src/core/photoEdits';

test('single-photo review keeps touch controls in reach after a keypad decision', async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 640 });
  const project = createDemoShootState(1);
  project.shoot.title = 'Single photo controls fixture';
  project.filter = 'all';
  project.frames[0].edit = { ...DEFAULT_EDIT, exposure: 0.5 };

  await page.goto('/');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'fixture.kestrel.json',
    mimeType: 'application/json',
    buffer: Buffer.from(encodeProjectBackup(project)),
  });
  await page.getByRole('button', { name: 'All photos 1', exact: true }).click();
  await page.getByRole('button', { name: isMobile ? 'More' : 'Workspace options', exact: true }).click();
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('loupe');

  const controls = page.getByRole('group', { name: 'Single photo controls' });
  await expect(controls.getByRole('button', { name: /^Keep / })).toBeVisible();
  await page.keyboard.press('k');
  const review = controls.getByRole('button', { name: /back to review/ });
  await expect(review).toBeVisible();
  let rightEdge = 0;
  for (const control of await controls.getByRole('button').all()) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(rightEdge);
    rightEdge = box.x + box.width;
    expect(rightEdge).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await controls.getByRole('button', { name: 'Undo last decision' }).click();
  await expect(controls.getByRole('button', { name: /^Keep / })).toBeVisible();

  await page.getByRole('button', { name: 'To review 1', exact: true }).click();
  await controls.getByRole('button', { name: /^Keep / }).click();
  await expect(page.getByText('You’re caught up.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last decision', exact: true }).click();
  await expect(controls.getByRole('button', { name: /^Keep / })).toBeVisible();
});
