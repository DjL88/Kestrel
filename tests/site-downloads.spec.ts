import { test, expect } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The website (site/) is static, so this spec serves it itself and answers latest.json from the test.
let server: Server;
let origin = '';
const LATEST = 'https://storage.googleapis.com/kestrel-hosting-kestrel-downloads/latest.json';

test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

const answer = (page: import('@playwright/test').Page, body: unknown) =>
  page.route(LATEST, (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }));

test('before a release every card says coming soon', async ({ page }) => {
  await answer(page, { status: 'coming-soon', platforms: {} });
  await page.goto(origin);
  await expect(page.locator('#release-status')).toContainText('isn’t released yet');
  for (const id of ['mac', 'windows', 'ios', 'android']) await expect(page.locator(`#${id}`)).toHaveText('Coming soon');
});

test('installer files and store listings appear on the right cards, and nothing else does', async ({ page }) => {
  await answer(page, {
    version: '26.12.0',
    files: [
      { name: 'Kestrel_26.12.0_aarch64.dmg', url: 'https://storage.googleapis.com/b/releases/26.12.0/Kestrel.dmg' },
      { name: 'Kestrel_26.12.0_x64-setup.exe', url: 'https://storage.googleapis.com/b/releases/26.12.0/Kestrel.exe' },
      { name: 'notes.txt', url: 'https://storage.googleapis.com/b/notes.txt' },
    ],
    stores: { android: 'https://play.google.com/store/apps/details?id=app.kestrel.photo', ios: 'https://testflight.apple.com/join/abc123' },
  });
  await page.goto(origin);
  await expect(page.locator('a.download')).toHaveCount(4);
  await expect(page.locator('[data-platform="mac"] a.download')).toHaveAttribute('href', /Kestrel\.dmg$/);
  await expect(page.locator('[data-platform="windows"] a.download')).toHaveAttribute('href', /Kestrel\.exe$/);
  await expect(page.locator('[data-platform="android"] a.download')).toHaveText('Get it on Google Play');
  await expect(page.locator('[data-platform="ios"] a.download')).toHaveText('Join the TestFlight beta');
});

test('a store link on any other host, or over http, is ignored', async ({ page }) => {
  await answer(page, { status: 'coming-soon', stores: { android: 'https://evil.example/store', ios: 'http://apps.apple.com/app/id1' } });
  await page.goto(origin);
  await expect(page.locator('#release-status')).not.toContainText('app stores');
  await expect(page.locator('a.download')).toHaveCount(0);
  await expect(page.locator('#android')).toHaveText('Coming soon');
  await expect(page.locator('#ios')).toHaveText('Coming soon');
});

test('store links alone are enough, before any installer exists', async ({ page }) => {
  await answer(page, { status: 'coming-soon', stores: { ios: 'https://apps.apple.com/app/id1234567890' } });
  await page.goto(origin);
  await expect(page.locator('[data-platform="ios"] a.download')).toHaveText('Get it on the App Store');
  await expect(page.locator('#release-status')).toContainText('app stores');
  await expect(page.locator('#mac')).toHaveText('Coming soon');
});

test('the Basic and Pro table says in words what each edition includes', async ({ page }) => {
  await answer(page, { status: 'coming-soon' });
  await page.goto(`${origin}/#compare`);
  const table = page.getByRole('table', { name: 'Features in InFlight Basic and InFlight Pro' });
  await expect(table.getByRole('columnheader')).toHaveText(['Feature', 'Basic (free)', 'Pro']);
  const species = table.getByRole('row', { name: /Species suggestions/ });
  await expect(species.getByRole('cell')).toHaveText(['Not included', 'Included']);
  const masks = table.getByRole('row', { name: /Masks and subject detection/ });
  await expect(masks.getByRole('cell')).toHaveText(['Included', 'Included']);
  await expect(page.getByText('nothing is on sale yet')).toBeVisible();
});

test('the table scrolls inside its box on a phone instead of widening the page', async ({ page }) => {
  await answer(page, { status: 'coming-soon' });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${origin}/#compare`);
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.view);
});
