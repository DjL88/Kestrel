import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The admin console opens on Today: a short summary and the "Needs you" list. Other pages are in the menu.
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

async function signIn(page: Page, extra: Record<string, unknown> = {}) {
  const posts: Array<{ path: string; body: unknown }> = [];
  let refunds = (extra['/v1/admin/balance-refunds'] as { refunds: unknown[] } | undefined)?.refunds ?? [];
  await page.route('**/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && path.startsWith('/v1/admin/')) {
      posts.push({ path, body: req.postDataJSON() });
      if (path.endsWith('/refunded')) refunds = [];
    }
    const responses: Record<string, unknown> = {
      '/v1/admin/config': { passwordSignIn: true, googleClientId: '' },
      '/v1/auth/session': { accessToken: 'admin-test-session' },
      '/v1/admin/overview': { accounts: 3, licences: 1, activations: 1, licenceIssuing: false, store: 'sqlite' },
      '/v1/admin/licensees': { licences: [] }, '/v1/admin/usage': { accounts: [] },
      '/v1/admin/payments': { connected: false, transactions: [] }, '/v1/admin/messages': { messages: [] },
      '/v1/admin/pricing/review': { review: null }, '/v1/admin/audit': { entries: [] }, '/v1/admin/flags': { flags: {} },
      '/v1/admin/switches': { switches: [] }, '/v1/admin/safety': { notices: [] },
      ...extra,
      '/v1/admin/balance-refunds': { refunds },
    };
    if (path.endsWith('/refunded')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"refund":{}}' });
    if (path in extra && extra[path] === undefined) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"Store unavailable"}}' });
    await route.fulfill({ status: path in responses ? 200 : 404, contentType: 'application/json', body: JSON.stringify(responses[path] ?? { error: { message: 'Not set up' } }) });
  });
  await page.goto(origin + '/admin.html');
  await page.locator('#password-form').getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return posts;
}

test('with nothing to do Today says All good and the other pages stay out of the way', async ({ page }) => {
  await signIn(page);
  await expect(page.getByText('All good.', { exact: true })).toBeVisible();
  await expect(page.locator('#needs-list li')).toHaveCount(0);
  await expect(page.locator('#flags')).toBeHidden();
  await expect(page.locator('#overview')).toBeHidden();
  await page.getByRole('navigation', { name: 'Admin pages' }).getByRole('link', { name: 'Advanced' }).click();
  await expect(page.locator('#flags')).toBeVisible();
  await expect(page.locator('#needs')).toBeHidden();
  await page.getByRole('navigation', { name: 'Admin pages' }).getByRole('link', { name: /^Today/ }).click();
  await expect(page.getByText('All good.', { exact: true })).toBeVisible();
});

test('a source that cannot be read is never shown as all good', async ({ page }) => {
  await signIn(page, { '/v1/admin/messages': undefined });
  await expect(page.locator('#needs-unknown')).toContainText('Could not check: messages');
  await expect(page.getByText('All good.', { exact: true })).toBeHidden();
});

test('a refund owed after account deletion is listed and can be marked refunded', async ({ page }) => {
  const posts = await signIn(page, {
    '/v1/admin/balance-refunds': { refunds: [{ accountId: 'acc_test1', millicredits: 412000, pence: 412, owedAtMs: Date.parse('2026-11-24T10:00:00Z'), status: 'owed' }] },
    '/v1/admin/messages': { messages: [{ messageId: 'm1', name: 'Sam', email: 'sam@example.test', message: 'Hi', status: 'new', receivedAtMs: 1 }] },
  });
  await expect(page.locator('#needs-list')).toContainText('1 refund owed after account deletion');
  await expect(page.locator('#needs-list')).toContainText('£4.12');
  await expect(page.locator('#needs-list')).toContainText('1 new message');
  await page.getByRole('link', { name: 'Open refunds: 1 refund owed after account deletion' }).click();
  await page.getByRole('button', { name: 'Mark the refund to acc_test1 as paid' }).click();
  const ask = page.getByRole('dialog');
  await ask.getByLabel('Paddle reference for this refund (from the Paddle dashboard)').fill('tx');
  await ask.getByRole('button', { name: 'Mark refunded' }).click();
  await expect(ask).toContainText('Enter the Paddle reference so the refund can be traced.');
  expect(posts.some(p => p.path.endsWith('/refunded')), 'nothing sent with a reference too short to trace').toBe(false);
  await ask.getByLabel('Paddle reference for this refund (from the Paddle dashboard)').fill('txn_test_123');
  await ask.getByLabel('Paddle reference for this refund (from the Paddle dashboard)').press('Enter');
  await expect(page.locator('#status')).toContainText('Marked refunded.');
  expect(posts).toContainEqual({ path: '/v1/admin/balance-refunds/acc_test1/refunded', body: { paddleReference: 'txn_test_123' } });
  await page.getByRole('navigation', { name: 'Admin pages' }).getByRole('link', { name: /^Today/ }).click();
  await expect(page.locator('#needs-list')).not.toContainText('refund');
});
