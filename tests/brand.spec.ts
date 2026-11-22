import { expect, test } from '@playwright/test';

test('home shows the stacked InFlight logo, the brand favicon and no old name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('brand-logo-stacked')).toBeVisible();
  await expect(page.getByTestId('brand-logo-stacked')).toHaveAttribute('alt', 'InFlight');
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/brand/favicon.svg');
  await expect(page.locator('body')).not.toContainText(/Kite44|Kestrel/);
});

test('the project page shows the horizontal logo in the middle of the header', async ({ page }, info) => {
  test.skip(info.project.name.toLowerCase().includes('phone'), 'a phone shows the chevron instead');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Brand fixture');
  await page.getByRole('button', { name: 'Create project' }).click();
  const logo = page.getByTestId('brand-logo-horizontal');
  await expect(logo).toBeVisible();
  const box = (await logo.boundingBox())!;
  const header = (await page.locator('header').first().boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(20);
  expect(Math.abs(box.x + box.width / 2 - (header.x + header.width / 2))).toBeLessThan(4);
});

test('right-click shows no browser menu on the logo, but text fields keep Cut, Copy and Paste', async ({ page }) => {
  await page.goto('/');
  const prevented = (selector: string) => page.evaluate((sel) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector(sel)!.dispatchEvent(event);
    return event.defaultPrevented;
  }, selector);
  expect(await prevented('[data-testid="brand-logo-stacked"]')).toBe(true);
  await page.getByRole('button', { name: 'New project' }).click();
  expect(await prevented('input[type="text"], input:not([type])')).toBe(false);
});
