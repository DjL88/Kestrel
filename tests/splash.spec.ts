import { expect, test } from '@playwright/test';

test('automated runs never see the splash, so tests never wait for it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByTestId('splash')).toHaveCount(0);
});

test('the splash plays on launch, draws every layer, then fades and leaves the app ready', async ({ page }) => {
  await page.goto('/?splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  // The brand animation is drawn as SVG by the on-demand player, on the dark brand surface.
  await expect(splash.getByTestId('splash-animation')).toHaveAttribute('data-played', 'true');
  await expect(splash.locator('svg').first()).toBeAttached();
  expect(await splash.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(14, 17, 22)');
  // It leaves by itself within about three seconds, with nothing to click.
  await expect(splash).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});

test('a tap skips it straight away', async ({ page }) => {
  await page.goto('/?splash=1');
  await expect(page.getByTestId('splash')).toBeVisible();
  const started = Date.now();
  await page.mouse.click(20, 20);
  await expect(page.getByTestId('splash')).toHaveCount(0, { timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2000);
});

test('with reduced motion the logo is still, and leaves quickly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?splash=1');
  const splash = page.getByTestId('splash');
  await expect(splash).toBeVisible();
  // Reduced motion shows the still stacked logo and never loads the player.
  await expect(splash.getByTestId('brand-logo-stacked')).toBeVisible();
  await expect(splash.getByTestId('splash-animation')).toHaveCount(0);
  expect(await splash.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(splash).toHaveCount(0, { timeout: 4000 });
});

test('it does not replay within the same session unless asked', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.goto('/');
  await expect(page.getByTestId('splash')).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.getByTestId('splash')).toHaveCount(0, { timeout: 2000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByTestId('splash')).toHaveCount(0);
});
