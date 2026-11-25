import { expect, test } from '@playwright/test';

test('?v2 hub: rename, archive, restore and delete a project (originals untouched, delete is confirmed)', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  const first = studio.getByRole('button', { name: /^Project actions for / }).first();
  await expect(first).toBeVisible();
  const label = (await first.getAttribute('aria-label'))!.replace('Project actions for ', '');

  await first.click();
  await studio.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('Project name').fill('Renamed shoot');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(studio.getByRole('button', { name: 'Project actions for Renamed shoot' })).toBeVisible();

  await studio.getByRole('button', { name: 'Project actions for Renamed shoot' }).click();
  await studio.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(studio.getByRole('button', { name: 'Project actions for Renamed shoot' })).toHaveCount(0);
  await studio.getByRole('button', { name: /^Archived \(1\)/ }).click();
  await studio.getByRole('button', { name: 'Project actions for Renamed shoot' }).click();
  await studio.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(studio.getByText('Nothing is archived.')).toBeVisible();
  await studio.getByRole('button', { name: 'Back to projects' }).click();

  await studio.getByRole('button', { name: 'Project actions for Renamed shoot' }).click();
  await studio.getByRole('menuitem', { name: /^Delete/ }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Your original photo files are never touched');
  await dialog.getByRole('button', { name: 'Keep project' }).click();
  await expect(studio.getByRole('button', { name: 'Project actions for Renamed shoot' })).toBeVisible();
  await studio.getByRole('button', { name: 'Project actions for Renamed shoot' }).click();
  await studio.getByRole('menuitem', { name: /^Delete/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete project' }).click();
  await expect(studio.getByRole('button', { name: 'Project actions for Renamed shoot' })).toHaveCount(0);
  expect(label.length).toBeGreaterThan(0);
});

test('?v2 settings: Privacy has a guarded erase-this-device and a forget-me request route', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: /settings/i }).first().click();
  await page.getByRole('tab', { name: 'Privacy' }).or(page.getByRole('button', { name: 'Privacy' })).first().click();
  const erase = page.getByRole('button', { name: 'Erase this device' });
  await expect(erase).toBeDisabled();
  await page.getByLabel('Type ERASE to confirm').fill('ERASE');
  await expect(erase).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Ask InFlight to erase my account data' })).toHaveAttribute('href', '/#contact');
});

test('?v2 hub: list view by default with favourite samples, smaller tiles on request, remembered after reload', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  const layout = studio.getByRole('group', { name: 'Project layout' });
  await expect(layout.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  const firstRow = studio.getByTestId('project-row').first();
  await expect(firstRow).toBeVisible();
  await expect(firstRow.getByRole('img', { name: /^Cover photograph for / })).toBeVisible();
  await expect(firstRow.getByTestId('project-samples').locator('img')).toHaveCount(3);
  const rowBox = (await firstRow.boundingBox())!;
  expect(rowBox.height).toBeLessThan(140);

  await layout.getByRole('button', { name: 'Tiles' }).click();
  await expect(studio.getByTestId('project-row')).toHaveCount(0);
  const tile = studio.getByTestId('project-tile').first();
  await expect(tile).toBeVisible();
  const tileBox = (await tile.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(tileBox.width).toBeLessThan(viewport.width < 640 ? viewport.width / 2 : 260);

  await page.reload();
  await expect(studio.getByRole('group', { name: 'Project layout' }).getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true');
  await studio.getByRole('group', { name: 'Project layout' }).getByRole('button', { name: 'List' }).click();
  await expect(studio.locator('[data-project-layout]')).toHaveAttribute('data-project-layout', 'list');
  await studio.getByRole('button', { name: /^Project actions for / }).first().click();
  await expect(studio.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
});

test('?v2 hub on a phone: a finger swipe reveals Rename, Archive and Delete; a mouse drag never moves a row', async ({ page, context, isMobile }) => {
  test.skip(!isMobile, 'Real touch input is only available on the phone project');
  const cdp = await context.newCDPSession(page);
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  const body = studio.getByTestId('project-row-body').first();
  await expect(body).toBeVisible();
  const name = (await studio.getByRole('button', { name: /^Project actions for / }).first().getAttribute('aria-label'))!.replace('Project actions for ', '');
  const shift = () => body.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41);

  await body.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.right - 30, y = box.top + box.height / 2;
    const fire = (type: string, px: number) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'mouse', clientX: px, clientY: y }));
    fire('pointerdown', x);
    for (let step = 1; step <= 6; step += 1) fire('pointermove', x - (200 * step) / 6);
    fire('pointerup', x - 200);
  });
  await page.waitForTimeout(250);
  expect(await shift()).toBe(0);

  const box = (await body.boundingBox())!;
  const y = box.y + box.height / 2, x0 = box.x + box.width - 40;
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await send('touchStart', x0);
  for (let i = 1; i <= 10; i += 1) { await send('touchMove', x0 - (120 * i) / 10); await page.waitForTimeout(16); }
  await send('touchEnd', x0 - 120);
  await expect.poll(shift).toBeLessThan(-200);

  const row = studio.getByTestId('project-row').first();
  await expect(row.getByRole('button', { name: 'Rename', exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Delete…', exact: true }).tap();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Your original photo files are never touched');
  await dialog.getByRole('button', { name: 'Keep project' }).tap();
  await expect(studio.getByRole('button', { name: `Project actions for ${name}` })).toBeVisible();
  await expect.poll(shift).toBe(0);
});
