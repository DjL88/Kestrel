import { expect, test, type Locator, type Page } from '@playwright/test';

// V2-WORKSPACE section 26.2: on a touch screen no bar, tab or rail button is smaller than 44px,
// and the tablet rail uses 48px. The phone project emulates a coarse pointer at every viewport size used here.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Requires the touch-enabled phone project.');
});

async function openPhoto(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible();
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Touch targets');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 160;
    c.getContext('2d')!.fillRect(0, 0, 240, 160);
    return c.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: 'touch.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  return studio;
}

async function smallest(buttons: Locator) {
  return buttons.evaluateAll((nodes) => nodes
    .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; })
    .map((n) => ({ label: n.getAttribute('aria-label') || n.textContent?.trim() || '?', height: n.getBoundingClientRect().height }))
    .sort((a, b) => a.height - b.height)[0]);
}

test('touch phone: top bar and tool bar buttons are at least 44px tall', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const studio = await openPhoto(page);
  for (const scope of [studio.locator('header button'), studio.locator('nav button')]) {
    const min = await smallest(scope);
    expect(min, JSON.stringify(min)).toBeDefined();
    expect(min.height, `${min.label} is ${min.height}px`).toBeGreaterThanOrEqual(44);
  }
});

test('touch tablet: top bar buttons are at least 44px and rail buttons at least 48px', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  const studio = await openPhoto(page);
  const header = await smallest(studio.locator('header button'));
  expect(header.height, `${header.label} is ${header.height}px`).toBeGreaterThanOrEqual(44);
  const rail = await smallest(studio.locator('.v2-rail button'));
  expect(rail, 'the rail is shown on a tablet').toBeDefined();
  expect(rail.height, `${rail.label} is ${rail.height}px`).toBeGreaterThanOrEqual(48);
});
