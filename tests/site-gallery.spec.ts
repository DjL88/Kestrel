import { test, expect } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The client gallery page is static (site/gallery.html); the control plane is stood in for with page.route.
let server: Server;
let origin = '';
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

const pixel = (colour: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${colour}"/></svg>`)}`;

test('a client sees only the filmstrip and photos, and can favourite, comment and approve when allowed', async ({ page }) => {
  const sent: any[] = [];
  let opened: any = null;
  await page.route('**/v1/gallery/open', async (route) => {
    opened = route.request().postDataJSON();
    if (!opened.password) return route.fulfill({ status: 401, json: { error: { code: 'GALLERY_PASSWORD', message: 'Enter the gallery password.' } } });
    return route.fulfill({ json: {
      name: 'Raptor selects', expiresAtMs: Date.UTC(2026, 11, 25), watermark: true,
      allow: { comments: true, favourites: true, approval: true, downloads: false },
      photos: [{ photoId: 'p1', url: pixel('#335') }, { photoId: 'p2', url: pixel('#553') }],
    } });
  });
  await page.route('**/v1/gallery/feedback', async (route) => { sent.push(route.request().postDataJSON()); await route.fulfill({ json: { received: true } }); });

  await page.goto(`${origin}/gallery.html#t=${'k'.repeat(43)}`);
  await page.getByLabel('This gallery has a password').fill('kestrel-proof');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Raptor selects' })).toBeVisible();
  expect(opened.token).toBe('k'.repeat(43));
  await expect(page.getByRole('navigation', { name: 'Photographs' }).getByRole('button')).toHaveCount(2);
  await expect(page.locator('#proof')).toBeVisible();
  await expect(page.locator('#download')).toBeHidden();
  await expect(page.locator('nav, header').filter({ hasText: /Export|Settings|Edit/ })).toHaveCount(0);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#counter')).toHaveText('2 of 2');
  await page.getByRole('button', { name: /Favourite/ }).click();
  await expect(page.getByRole('button', { name: /Favourite/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Favourite/ })).toContainText('chosen');
  await page.getByLabel('Comment on this photo').fill('Could the sky be a touch lighter?');
  await page.getByRole('button', { name: 'Request changes' }).click();
  await expect(page.locator('#note')).toHaveText('Change request sent to the photographer.');
  await page.getByRole('button', { name: 'Approve the whole selection' }).click();
  expect(sent.map((s) => [s.kind, s.photoId])).toEqual([['favourite', 'p2'], ['request-changes', 'p2'], ['approve-all', null]]);
  expect(sent[1].text).toBe('Could the sky be a touch lighter?');
  expect(new Set(sent.map((s) => s.visitor)).size).toBe(1);
});

test('an incomplete or expired link says so in words', async ({ page }) => {
  await page.goto(`${origin}/gallery.html`);
  await expect(page.locator('#status')).toContainText('incomplete');
  await page.route('**/v1/gallery/open', (route) => route.fulfill({ status: 410, json: { error: { code: 'GALLERY_EXPIRED', message: 'This gallery has expired. Ask the photographer for a new link.' } } }));
  await page.goto(`${origin}/gallery.html#t=${'z'.repeat(43)}`);
  await expect(page.locator('#status')).toContainText('expired');
});

test('anyone can report a gallery, or one photograph in it, in words and without an account', async ({ page }) => {
  let reported: any = null;
  await page.route('**/v1/gallery/open', (route) => route.fulfill({ json: {
    name: 'Raptor selects', expiresAtMs: Date.UTC(2026, 11, 25), watermark: false,
    allow: { comments: false, favourites: false, approval: false, downloads: false },
    photos: [{ photoId: 'p1', url: pixel('#335') }, { photoId: 'p2', url: pixel('#553') }],
  } }));
  await page.route('**/v1/gallery/report', async (route) => { reported = route.request().postDataJSON(); await route.fulfill({ json: { noticeId: 'ntc_abc123', receipt: 'r'.repeat(24), receivedAtMs: 1, urgent: false } }); });
  await page.goto(`${origin}/gallery.html#t=${'k'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: 'Raptor selects' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('link', { name: 'Report this gallery' }).click();
  await page.getByLabel('What is wrong').selectOption('copyright');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.locator('#report-note')).toContainText('why');
  await page.getByLabel('Why is it illegal or against the policy?').fill('This is my photograph, used without permission.');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.locator('#report-note')).toContainText('good faith');
  expect(reported).toBeNull();
  await page.getByLabel(/in good faith/).check();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.locator('#report-note')).toContainText('ntc_abc123');
  expect(reported).toEqual({ token: 'k'.repeat(43), photoId: 'p2', category: 'copyright', explanation: 'This is my photograph, used without permission.', goodFaith: true });
});

test('a gallery under review says so, and can still be reported', async ({ page }) => {
  await page.route('**/v1/gallery/open', (route) => route.fulfill({ status: 451, json: { error: { code: 'GALLERY_UNDER_REVIEW', message: 'This gallery is unavailable while a report about it is reviewed.' } } }));
  await page.goto(`${origin}/gallery.html#t=${'k'.repeat(43)}`);
  await expect(page.locator('#status')).toContainText('reviewed');
  await page.getByRole('link', { name: 'Report this gallery' }).click();
  await expect(page.locator('#report-scope')).toBeHidden();
});
