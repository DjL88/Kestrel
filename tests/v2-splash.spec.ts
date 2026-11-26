import { expect, test } from '@playwright/test';


test('?v2 automated runs never see the splash', async ({ page }) => {
  await page.goto('/?v2&stub=1');
  await expect(page.locator('.inflight-v2')).toBeVisible();
  await expect(page.getByTestId('splash')).toHaveCount(0);
});

test('?v2 plays the launch animation, grows into the welcome, and Continue as guest leaves the workspace ready', async ({ page }) => {
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await expect(splash.getByTestId('splash-animation')).toHaveAttribute('data-played', 'true');
  // The splash stays: the logo rises and the welcome appears beneath it, on the same layer.
  await expect(splash.getByRole('heading', { name: 'Welcome to InFlight' })).toBeVisible({ timeout: 8000 });
  await expect(splash.getByTestId('splash-animation')).toBeVisible();
  await expect(splash).not.toHaveAttribute('aria-hidden', 'true');
  await splash.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(splash).toHaveCount(0, { timeout: 2000 });
  await expect(page.locator('.inflight-v2')).toBeVisible();
});

test('?v2 a key press shows the welcome at once and does not trigger a shortcut underneath', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await page.keyboard.press('g');
  await expect(splash.getByRole('heading', { name: 'Welcome to InFlight' })).toBeVisible();
  // G opens the grid view; the key that skipped the animation must not have done so, nor any key while the welcome shows.
  await expect(page.getByLabel('All photos grid view')).toHaveCount(0);
  await page.keyboard.press('g');
  await expect(page.getByLabel('All photos grid view')).toHaveCount(0);
  await splash.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(splash).toHaveCount(0, { timeout: 2000 });
  // The phone studio has no Studio tools side panel to wait for, and no keyboard grid shortcut to prove live.
  if (test.info().project.name === 'phone') return;
  // And the shortcut is live once the layer is gone (so the checks above are not vacuous). autostart opens the studio in
  // the background, which can take a few seconds on a busy machine: wait until it is there to take the key.
  await expect(page.getByRole('complementary', { name: 'Studio tools' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('All photos grid view')).toHaveCount(0);
  await page.keyboard.press('g');
  await expect(page.getByLabel('All photos grid view')).toBeVisible();
});

test('?v2 with reduced motion shows the still logo at the top and the welcome at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByTestId('brand-logo-stacked')).toBeVisible();
  await expect(splash.getByTestId('splash-animation')).toHaveCount(0);
  await expect(splash.getByRole('heading', { name: 'Welcome to InFlight' })).toBeVisible();
});

test('?v2 a returning guest who chose to skip gets the animation only, then the workspace', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('inflight.launch.launched', '1'); localStorage.setItem('inflight.launch.skip', '1'); });
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  await expect(splash).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByTestId('launch-welcome')).toHaveCount(0);
  await expect(page.locator('.inflight-v2')).toBeVisible();
});

test('?v2 the welcome keeps room for the risen logo, so the heading sits just beneath it', async ({ page }) => {
  await page.goto('/?v2&stub=1&splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash.getByTestId('splash-animation')).toHaveAttribute('data-played', 'true');
  await page.keyboard.press('Enter');
  const heading = splash.getByRole('heading', { name: 'Welcome to InFlight' });
  await expect(heading).toBeVisible();
  const measure = () => splash.getByTestId('splash-animation').evaluate((host) => {
    let top = Infinity; let bottom = -Infinity;
    for (const path of host.querySelectorAll('path')) {
      const box = path.getBoundingClientRect();
      if (box.width && box.height) { top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom); }
    }
    return { top, bottom };
  });
  // Wait for the 400 ms rise to settle: the logo's top holds still across two readings.
  let previous = Number.NaN;
  await expect.poll(async () => { const { top } = await measure(); const settled = top === previous; previous = top; return settled; }).toBe(true);
  const logo = await measure();
  const headingTop = (await heading.boundingBox())!.y;
  expect(logo.top).toBeGreaterThanOrEqual(16);
  expect(logo.top).toBeLessThanOrEqual(32);
  expect(headingTop).toBeGreaterThan(logo.bottom);
  expect(headingTop - logo.bottom).toBeLessThan(32);
});
