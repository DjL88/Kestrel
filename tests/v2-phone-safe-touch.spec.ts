import { expect, test, type Page } from '@playwright/test';

// Phones: every control a finger uses is at least 44px both ways, and nothing sits under a notch or the home indicator
// (viewport-fit=cover). The phone project emulates a coarse pointer.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Requires the touch-enabled phone project.');
});

async function openPhoto(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible();
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Phone polish');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 160;
    c.getContext('2d')!.fillRect(0, 0, 240, 160);
    return c.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: 'phone.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  return studio;
}

/** Every visible control smaller than 44px in either direction. A control a sibling covers or clips away is skipped. */
async function smallControls(page: Page) {
  return page.locator('.inflight-v2').evaluate((root) => {
    const controls = root.querySelectorAll<HTMLElement>('button, [role="button"], [role="tab"], select, a[href]');
    const out: string[] = [];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      if (el.closest('[aria-hidden="true"], .sr-only, [inert]')) continue;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`touch phone ${viewport.width}x${viewport.height}: no control is under 44px, in the projects list or the editor`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?v2');
    await expect(page.locator('.inflight-v2').getByText('No projects yet')).toBeVisible();
    expect(await smallControls(page), 'projects list').toEqual([]);
    await page.setViewportSize(viewport);
    await openPhoto(page);
    expect(await smallControls(page), 'editor').toEqual([]);
  });
}

test('touch phone: the workspace keeps clear of the notch and the home indicator', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top: 47, bottom: 34, left: 0, right: 0 } } as never);
  } catch {
    test.skip(true, 'This Chromium cannot emulate safe-area insets.');
  }
  const studio = await openPhoto(page);
  const box = async (selector: string) => (await studio.locator(selector).first().boundingBox())!;
  expect((await box('header')).y, 'top bar below the notch').toBeGreaterThanOrEqual(47);
  const bar = await box('nav[aria-label="Mobile studio tools"]');
  expect(bar.y + bar.height, 'tool bar above the home indicator').toBeLessThanOrEqual(844 - 34 + 0.5);
});
