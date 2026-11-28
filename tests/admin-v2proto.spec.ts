import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// /admin → Publish to V2Proto: pick a green main commit, confirm in words, watch a calm status. The endpoint is stubbed.
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

const sha = (c: string) => c.repeat(40);
const COMMITS = [
  { sha: sha('a'), message: 'Newest change, checks still running', committedAtMs: Date.UTC(2026, 10, 28, 12), ci: 'pending' },
  { sha: sha('b'), message: 'Phone: tap the photo to hide the bars', committedAtMs: Date.UTC(2026, 10, 28, 11), ci: 'green' },
  { sha: sha('c'), message: 'A broken change', committedAtMs: Date.UTC(2026, 10, 28, 10), ci: 'red' },
  { sha: sha('d'), message: 'Earlier good change', committedAtMs: Date.UTC(2026, 10, 27, 10), ci: 'green' },
];

async function open(page: Page, overview: unknown, afterPublish?: unknown) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  let published = false;
  await page.route('**/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.includes('/v2proto')) calls.push({ method: req.method(), path, body: req.method() === 'POST' ? req.postDataJSON() : null });
    if (path === '/v1/admin/v2proto/publish') {
      published = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ last: { sha: sha('b'), message: COMMITS[1].message, atMs: Date.now(), by: 'owner-account-1', buildId: 'x', state: 'queued' } }) });
    }
    if (path === '/v1/admin/v2proto') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(published && afterPublish ? afterPublish : overview) });
    const responses: Record<string, unknown> = {
      '/v1/admin/config': { passwordSignIn: true, googleClientId: '' },
      '/v1/auth/session': { accessToken: 'admin-test-session' },
      '/v1/admin/overview': { accounts: 0, licences: 0, activations: 0, licenceIssuing: false, store: 'sqlite' },
      '/v1/admin/licensees': { licences: [] }, '/v1/admin/usage': { accounts: [] },
      '/v1/admin/payments': { connected: false, transactions: [] }, '/v1/admin/messages': { messages: [] },
      '/v1/admin/pricing/review': { review: null }, '/v1/admin/audit': { entries: [] }, '/v1/admin/flags': { flags: {} },
      '/v1/admin/switches': { switches: [] }, '/v1/admin/safety': { notices: [] }, '/v1/admin/balance-refunds': { refunds: [] },
    };
    await route.fulfill({ status: path in responses ? 200 : 404, contentType: 'application/json', body: JSON.stringify(responses[path] ?? { error: { message: 'Not set up' } }) });
  });
  await page.goto(origin + '/admin.html');
  await page.locator('#password-form').getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('navigation', { name: 'Admin pages' }).getByRole('link', { name: 'Publish to V2Proto' }).click();
  return calls;
}

test('only green commits can be published, and the confirm names the commit and the private preview', async ({ page }) => {
  const last = { sha: sha('d'), message: COMMITS[3].message, atMs: Date.UTC(2026, 10, 27, 18), by: 'owner-account-1', buildId: 'y', state: 'done' };
  const calls = await open(page, { configured: true, commits: COMMITS, latestGreenSha: sha('b'), last },
    { configured: true, commits: COMMITS, latestGreenSha: sha('b'), last: { sha: sha('b'), message: COMMITS[1].message, atMs: Date.now(), by: 'owner-account-1', buildId: 'x', state: 'building' } });
  const section = page.locator('#v2proto');
  await expect(section.getByText('Done: V2Proto now shows it. Commit ddddddd')).toBeVisible();
  await expect(section.getByText('latest green commit')).toBeVisible();
  // Failed and running checks are marked in words, and cannot be published.
  await expect(section.getByText('Failed', { exact: true })).toBeVisible();
  await expect(section.getByText('Still running', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Publish commit aaaaaaa to V2Proto' })).toBeDisabled();
  await expect(section.getByRole('button', { name: 'Publish commit ccccccc to V2Proto' })).toBeDisabled();

  // Going back is a Go back in the question: nothing is sent.
  await section.getByRole('button', { name: 'Publish commit bbbbbbb to V2Proto' }).click();
  const ask = page.locator('#ask');
  await expect(ask).toContainText('bbbbbbb');
  await expect(ask).toContainText('private V2Proto preview');
  await expect(ask).toContainText('public website, downloads, updater and app stores are not touched');
  await ask.getByRole('button', { name: 'Go back' }).click();
  expect(calls.filter(c => c.method === 'POST')).toEqual([]);

  // Confirming sends exactly this commit, twice named, and the status moves on.
  await section.getByRole('button', { name: 'Publish commit bbbbbbb to V2Proto' }).click();
  await ask.getByRole('button', { name: 'Publish to V2Proto' }).click();
  await expect(page.getByText('Started. V2Proto will show commit bbbbbbb when the build is done.')).toBeVisible();
  expect(calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', path: '/v1/admin/v2proto/publish', body: { sha: sha('b'), confirmedSha: sha('b') } }]);
  await expect(section.getByText('Building. Commit bbbbbbb')).toBeVisible();
});

test('a rollback to an earlier green commit asks about that commit only', async ({ page }) => {
  const calls = await open(page, { configured: true, commits: COMMITS, latestGreenSha: sha('b'), last: null });
  await page.locator('#v2proto').getByRole('button', { name: 'Publish commit ddddddd to V2Proto' }).click();
  await expect(page.locator('#ask')).toContainText('ddddddd (Earlier good change)');
  await page.locator('#ask').getByRole('button', { name: 'Publish to V2Proto' }).click();
  await expect.poll(() => calls.filter(c => c.method === 'POST').length).toBe(1);
  expect((calls.find(c => c.method === 'POST')!.body as { sha: string }).sha).toBe(sha('d'));
});

test('a failed build says why in plain words; not set up says so and shows no buttons', async ({ page }) => {
  await open(page, { configured: true, commits: COMMITS, latestGreenSha: sha('b'), last: { sha: sha('b'), message: 'x', atMs: Date.now(), by: 'owner-account-1', buildId: 'x', state: 'failed', reason: 'The build ran but a step failed. The Cloud Build log says which.' } });
  await expect(page.locator('#v2proto-last')).toContainText('Failed. Commit bbbbbbb');
  await expect(page.locator('#v2proto-last')).toContainText('a step failed');
  const second = await page.context().newPage();
  await open(second, { configured: false, reason: 'not set up' });
  await expect(second.locator('#v2proto-unavailable')).toBeVisible();
  await expect(second.locator('#v2proto-body')).toBeHidden();
});
