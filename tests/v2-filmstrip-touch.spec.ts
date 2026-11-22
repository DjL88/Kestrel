import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Requires the touch-enabled phone project.');
});

async function importPhoto(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible();
  await studio.getByRole('button', { name: 'New project' }).first().tap();
  await page.getByLabel('Project name', { exact: true }).fill('Phone acceptance');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().tap();
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 240;
    image.height = 160;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#586b82';
    ctx.fillRect(0, 0, image.width, image.height);
    return image.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).tap();
  await (await picker).setFiles(Array.from({ length: 5 }, (_, i) => ({ name: `phone-test-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(5);
  return studio;
}


for (const width of [320, 390]) {
  test(`filmstrip long press and photo menu at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 650 });
    const studio = await importPhoto(page);
    const strip = studio.getByRole('listbox', { name: 'Project photographs' });
    const second = strip.getByRole('option').nth(1);
    await expect(second).toBeInViewport();
    const rect = (await second.boundingBox())!;
    const x = rect.x + 34, y = rect.y + 37;
    const cdp = await context.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', point = x) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: point, y }] });
    const menu = page.getByRole('menu', { name: 'Photo actions' });

    await touch('touchStart');
    await touch('touchMove', x - 50);
    // Hold past the menu delay to exercise cancellation by movement.
    await page.waitForTimeout(560);
    await touch('touchEnd');
    await expect(menu).toHaveCount(0);

    await second.evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const after = (await second.boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: after.x + 35, y: after.y + 38 }] });
    await expect(menu).toBeVisible();
    await touch('touchEnd');
    await expect(menu).toBeVisible();

    await menu.getByRole('menuitem', { name: 'Flag / unflag' }).tap();
    await expect(second.getByRole('button', { name: 'Unflag phone-test-2.png' })).toBeVisible();
    await second.getByRole('button', { name: 'More actions for phone-test-2.png' }).tap();
    await expect(menu).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    const third = strip.getByRole('option').nth(2);
    await third.getByRole('button', { name: /phone-test-3 Ready/ }).click({ modifiers: ['Control'] });
    await third.getByRole('button', { name: 'More actions for phone-test-3.png' }).tap();
    await expect(menu.getByText('2 selected photos')).toBeVisible();
  });
}
