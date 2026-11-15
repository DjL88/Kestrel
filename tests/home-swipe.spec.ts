import { expect, test } from '@playwright/test';

test('home page: a finger swipe reveals Archive and Delete, a mouse never moves a row', async ({ page, context, isMobile }) => {
  test.skip(!isMobile, 'Real touch input is only available on the phone project');
  const cdp = await context.newCDPSession(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Swipe me');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const row = page.getByTestId('swipe-row').first();
  await expect(row).toBeVisible();

  // A mouse drag (synthetic pointer events) must never move a row.
  const mouseDrag = (dx: number) => row.evaluate((element, distance) => {
    const box = element.getBoundingClientRect();
    const x = box.right - 30, y = box.top + box.height / 2;
    const fire = (name: string, px: number) => element.dispatchEvent(new PointerEvent(name, { bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'mouse', clientX: px, clientY: y }));
    fire('pointerdown', x);
    for (let step = 1; step <= 6; step += 1) fire('pointermove', x + (distance * step) / 6);
    fire('pointerup', x + distance);
  }, dx);
  // A finger is real touch input from the browser, as on a phone.
  const finger = async (dx: number) => {
    const box = (await row.boundingBox())!;
    const y = box.y + box.height / 2, x0 = box.x + box.width - 40;
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await send('touchStart', x0);
    for (let i = 1; i <= 10; i += 1) { await send('touchMove', x0 + (dx * i) / 10); await page.waitForTimeout(16); }
    await send('touchEnd', x0 + dx);
  };
  const shift = () => row.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41);

  await mouseDrag(-150);
  await page.waitForTimeout(250);
  expect(await shift()).toBe(0);

  await finger(-90);
  await expect.poll(shift).toBeLessThan(-60);
  await expect(page.getByRole('button', { name: 'Archive Swipe me' }).first()).toBeVisible();

  await expect.poll(shift).toBeLessThan(-140);
  await expect(page.getByRole('button', { name: 'Delete Swipe me' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Archive Swipe me' }).first().click();
  await expect(page.getByText('Archive “Swipe me”?')).toBeVisible();
});
