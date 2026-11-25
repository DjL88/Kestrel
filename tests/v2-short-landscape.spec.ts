import { expect, test, type Page } from '@playwright/test';

// Landscape phones and small tablets use the rail layout. Every rail tool must stay reachable on a short screen, the
// canvas bar must not wrap to two rows there, and a portrait tablet's docked panel leaves the photo more room.

async function openPhoto(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible();
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Short screen');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 1200;
    image.height = 800;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#586b82';
    ctx.fillRect(0, 0, image.width, image.height);
    return image.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: 'short-screen.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  return studio;
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Sets its own viewport; runs once.');
});

test('on a landscape phone every rail tool can be reached and opened', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const studio = await openPhoto(page);
  const rail = studio.getByRole('complementary', { name: 'Studio tools' });
  for (const name of ['Formats', 'Masks', 'History', 'Info', 'Settings']) {
    const tool = rail.getByRole('button', { name, exact: true });
    await tool.scrollIntoViewIfNeeded();
    await expect(tool).toBeInViewport({ ratio: 1 });
  }
  await rail.getByRole('button', { name: 'History', exact: true }).click();
  await expect(rail.getByRole('button', { name: 'History', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Labels are hidden visually on a short screen but still name the tools for screen readers (asserted by the role queries above).
  const bar = await page.getByRole('button', { name: 'All formats', exact: false }).first().evaluate((el) => el.closest('.v2-canvas-bar')!.getBoundingClientRect().height);
  expect(bar).toBeLessThan(56);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(844);
});

test('a portrait tablet docks a narrower panel', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const studio = await openPhoto(page);
  const panel = studio.getByRole('heading', { name: 'Adjust', exact: true }).first();
  await expect(panel).toBeVisible();
  expect(await studio.evaluate((el) => getComputedStyle(el).getPropertyValue('--dock-width').trim())).toBe('16rem');
  // The wide desktop keeps its usual width.
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await studio.evaluate((el) => getComputedStyle(el).getPropertyValue('--dock-width').trim())).toBe('19.75rem');
});
