import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop filmstrip.');
});

test('?v2 a burst is one stack that opens in place, can be split into individual photos, and grouped again', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Burst check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  // Three shots with the same capture time are one burst; one more shot has no burst.
  const shot = readFileSync('tests/fixtures/exif-photo.jpg');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
    canvas.getContext('2d')!.fillRect(0, 0, 200, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([
    ...['DSC_0101.jpg', 'DSC_0102.jpg', 'DSC_0103.jpg'].map((name) => ({ name, mimeType: 'image/jpeg', buffer: shot })),
    { name: 'solo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
  ]);
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  const controls = root.getByRole('group', { name: 'Burst of 3 frames' });
  await expect(root.getByRole('button', { name: /frames in this burst|Collapse this burst/ }).first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500); // let the import and any scoring settle: which frame is the cover can change as scores arrive
  // If the selected photo is a frame the stack would hide, the stack is open. Collapse moves the selection to the cover.
  if (await controls.isVisible()) await controls.getByRole('button', { name: 'Collapse' }).click();
  await expect(options).toHaveCount(2); // the burst folded into one stack, plus the single photo
  await expect(root.getByRole('button', { name: /Show the 3 frames in this burst/ })).toBeVisible();

  await root.getByRole('button', { name: /Show the 3 frames in this burst/ }).click();
  await expect(options).toHaveCount(4);
  const flagBest = controls.getByRole('button', { name: 'Flag the best' });
  if (await flagBest.isEnabled()) {
    await flagBest.click(); // a measured best frame is flagged; nothing else is changed
    await expect(root.getByRole('button', { name: /^Unflag / })).toHaveCount(1);
  } else {
    await expect(controls).toContainText('Not ranked yet'); // nothing is ranked, so no best is invented
  }

  await controls.getByRole('button', { name: 'Collapse' }).click();
  await expect(options).toHaveCount(2);
  await root.getByRole('button', { name: /Show the 3 frames in this burst/ }).click();
  await controls.getByRole('button', { name: 'Split into individual photos' }).click();
  await expect(options).toHaveCount(4);
  await expect(root.getByRole('button', { name: /frames in this burst/ })).toHaveCount(0);

  await root.getByRole('button', { name: /^More actions for DSC_0101/ }).click();
  await page.getByRole('menuitem', { name: 'Group this burst again' }).click();
  // Grouped again: the frames carry the burst badge once more (the stack stays open if the chosen photo is not its cover).
  await expect(root.getByRole('button', { name: /frames in this burst|Collapse this burst/ }).first()).toBeVisible();
});
