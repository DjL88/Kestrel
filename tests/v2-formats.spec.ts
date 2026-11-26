import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop canvas.');
});

test('?v2 the frame action bar adds, duplicates and deletes formats for real, and the formats are saved with the photo', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Formats check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
    canvas.getContext('2d')!.fillRect(0, 0, 600, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'formats-1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(root.getByTestId('canvas-frame').locator('canvas, img').first()).toBeVisible({ timeout: 30000 });

  const caption = () => root.getByTestId('canvas-frame').locator('xpath=../../div[1]/span[1]');
  const original = ((await caption().textContent()) ?? '').trim();
  const bar = root.getByRole('toolbar', { name: 'Selected format actions' });
  await expect(bar).toBeVisible();

  await bar.getByRole('button', { name: 'Duplicate format' }).click();
  await expect(caption()).toContainText(`${original} copy`);

  // The copy is a real format of this photo: it is in the export list.
  await root.getByRole('button', { name: /^Export/ }).first().click();
  await expect(page.getByRole('dialog', { name: /export/i }).getByText(`${original} copy`)).toBeVisible();
  await page.getByRole('button', { name: 'Close export dialog' }).click();

  await bar.getByRole('button', { name: 'Delete selected format' }).click();
  await expect(caption()).not.toContainText('copy');

  await bar.getByRole('button', { name: 'Add format' }).click();
  await expect(root.getByRole('heading', { name: 'Formats' }).first()).toBeVisible();
});

test('?v2 an info tooltip in a panel shows whole, in front of the panel edge and the side rail', async ({ page }) => {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Tooltip check');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
    canvas.getContext('2d')!.fillRect(0, 0, 300, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: 'tooltip.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);

  await root.getByRole('button', { name: 'Formats', exact: true }).first().click();
  const info = root.getByRole('button', { name: 'About Edit Groups' });
  await info.hover();
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'Chain formats together' });
  await expect(tooltip).toBeVisible();
  await expect(info).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id'))!);

  // Drawn in the workspace root, not inside the scrolling panel that used to cut off its left side.
  expect(await tooltip.evaluate((el) => el.parentElement?.classList.contains('inflight-v2'))).toBe(true);
  const box = (await tooltip.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  // Nothing else is drawn over its left side, where the side rail was (it lets the pointer through, so hit-testing
  // counts it only while that is switched off for a moment).
  const covered = await tooltip.evaluate((el) => {
    const r = el.getBoundingClientRect();
    (el as HTMLElement).style.pointerEvents = 'auto';
    const stack = document.elementsFromPoint(r.left + 12, r.top + r.height / 2);
    (el as HTMLElement).style.pointerEvents = '';
    return stack.indexOf(el) === -1 ? 'missing' : stack.slice(0, stack.indexOf(el)).map((e) => e.className).join(' | ');
  });
  expect(covered).toBe('');

  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
});
