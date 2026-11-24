import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let origin: string;
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

async function signIn(page: Page, grantStatus = 200) {
  const grants: unknown[] = [];
  await page.route('**/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const responses: Record<string, unknown> = {
      '/v1/admin/config': { passwordSignIn: true, googleClientId: '' },
      '/v1/auth/session': { accessToken: 'admin-test-session' },
      '/v1/admin/overview': { accounts: 0, licences: 0, activations: 0, licenceIssuing: false, store: 'sqlite' },
      '/v1/admin/licensees': { licences: [] },
      '/v1/admin/usage': { accounts: [] },
      '/v1/admin/payments': { connected: false, transactions: [] },
      '/v1/admin/messages': { messages: [] },
      '/v1/admin/pricing/review': { review: null },
      '/v1/admin/audit': { entries: [] },
      '/v1/admin/flags': { flags: {} },
    };
    let status = path in responses ? 200 : 404;
    let body = responses[path] ?? { error: { message: 'Not mocked' } };
    if (path === '/v1/admin/licences/grant') {
      expect(req.method()).toBe('POST');
      expect(req.headers().authorization).toBe('Bearer admin-test-session');
      grants.push(req.postDataJSON());
      status = grantStatus;
      body = status === 200 ? { created: grants.length === 1, attachedNow: false } : { error: { message: 'Grant unavailable on this server.' } };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(origin + '/admin.html');
  await page.locator('#password-form').getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#issue-unavailable')).toBeVisible();
  return grants;
}

test('admin can grant free Pro by verified email even when signed key issuing is disabled', async ({ page }) => {
  const grants = await signIn(page);
  await expect(page.getByRole('button', { name: 'Issue key', exact: true })).toBeDisabled();
  const submit = page.getByRole('button', { name: 'Grant free Pro', exact: true });
  await expect(submit).toBeEnabled();
  await page.getByLabel('Recipient address').fill('tester@example.test');
  await page.getByLabel('Include the online helper allowance', { exact: true }).check();
  await submit.click();
  await expect(page.locator('#grant-result')).toContainText('Free Pro granted. It will attach');
  expect(grants).toEqual([{ email: 'tester@example.test', plan: 'paid', majorVersion: 1, managedAi: true }]);
  await page.getByLabel('Recipient address').fill('tester@example.test');
  await submit.click();
  await expect(page.locator('#grant-result')).toContainText('already exists');
  await expect(page.getByRole('button', { name: 'Issue key', exact: true })).toBeDisabled();
});

test('failed grant preserves recipient and never claims success', async ({ page }) => {
  const grants = await signIn(page, 503);
  await page.getByLabel('Recipient address').fill('tester@example.test');
  await page.getByRole('button', { name: 'Grant free Pro', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Grant unavailable on this server.');
  await expect(page.locator('#grant-result')).toBeEmpty();
  await expect(page.getByLabel('Recipient address')).toHaveValue('tester@example.test');
  expect(grants).toHaveLength(1);
});
