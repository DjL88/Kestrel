import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// /admin → More → Compliance documents: a short list with Download, and an Upload form for a signed copy.
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  server = await startSiteServer(0);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

const DOC = { id: '2026-11-26-illegal-content-risk-assessment-draft.md', title: 'Illegal content risk assessment (draft v0.1 - unsigned)', fileName: 'illegal-content-risk-assessment-draft.md', contentType: 'text/markdown', bytes: 21_500, uploadedAtMs: Date.UTC(2026, 10, 26, 15), uploadedBy: null };

async function signIn(page: Page, compliance: unknown) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  await page.route('**/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.includes('/compliance/')) calls.push({ method: req.method(), path, body: req.method() === 'POST' ? req.postDataJSON() : null });
    if (path === '/v1/admin/compliance/documents' && req.method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ document: DOC }) });
    if (path.endsWith('/download')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://signed.example.test/documents/doc.md', expiresAtMs: Date.now() + 600_000, fileName: DOC.fileName }) });
    const responses: Record<string, unknown> = {
      '/v1/admin/config': { passwordSignIn: true, googleClientId: '' },
      '/v1/auth/session': { accessToken: 'admin-test-session' },
      '/v1/admin/overview': { accounts: 0, licences: 0, activations: 0, licenceIssuing: false, store: 'sqlite' },
      '/v1/admin/licensees': { licences: [] }, '/v1/admin/usage': { accounts: [] },
      '/v1/admin/payments': { connected: false, transactions: [] }, '/v1/admin/messages': { messages: [] },
      '/v1/admin/pricing/review': { review: null }, '/v1/admin/audit': { entries: [] }, '/v1/admin/flags': { flags: {} },
      '/v1/admin/switches': { switches: [] }, '/v1/admin/safety': { checks: null, cases: [], notices: [] }, '/v1/admin/balance-refunds': { refunds: [] },
    };
    if (path === '/v1/admin/compliance/documents') {
      return compliance === null
        ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"COMPLIANCE_NOT_CONFIGURED","message":"Not set up"}}' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(compliance) });
    }
    await route.fulfill({ status: path in responses ? 200 : 404, contentType: 'application/json', body: JSON.stringify(responses[path] ?? { error: { message: 'Not set up' } }) });
  });
  await page.goto(origin + '/admin.html');
  await page.locator('#password-form').getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('link', { name: 'Compliance documents' }).click();
  return calls;
}

test('lists each document with its date, downloads through a short-lived link, and uploads a signed copy', async ({ page }) => {
  const calls = await signIn(page, { documents: [DOC], maxBytes: 8_000_000 });
  const section = page.locator('#compliance');
  await expect(section.getByRole('heading', { name: 'Compliance documents' })).toBeVisible();
  await expect(section.getByText(DOC.title)).toBeVisible();
  await expect(section.getByText('26 Nov 2026')).toBeVisible();

  // The signed link answers as an attachment, so the browser downloads it and the page stays put.
  await page.route('https://signed.example.test/**', route => route.fulfill({ status: 200, contentType: 'text/markdown', headers: { 'content-disposition': 'attachment; filename="doc.md"' }, body: '# doc' }));
  const fetched = page.waitForRequest('https://signed.example.test/documents/doc.md');
  await section.getByRole('button', { name: 'Download ' + DOC.title }).click();
  await fetched;
  expect(calls.some(c => c.method === 'GET' && c.path === `/v1/admin/compliance/documents/${DOC.id}/download`)).toBe(true);
  await expect(page.getByText('Downloading ' + DOC.fileName + '.')).toBeVisible();

  await section.getByLabel('Title').fill('Illegal content risk assessment, signed');
  await section.getByLabel('File (PDF or Markdown)').setInputFiles({ name: 'signed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% synthetic\n%%EOF\n') });
  await section.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('Uploaded. It is listed below.')).toBeVisible();
  const upload = calls.find(c => c.method === 'POST')!.body as { title: string; fileName: string; contentType: string; base64: string };
  expect(upload.title).toBe('Illegal content risk assessment, signed');
  expect(upload.contentType).toBe('application/pdf');
  expect(Buffer.from(upload.base64, 'base64').toString('latin1').startsWith('%PDF-')).toBe(true);
});

test('without the store it says so plainly and hides the upload form', async ({ page }) => {
  await signIn(page, null);
  await expect(page.locator('#compliance-unavailable')).toBeVisible();
  await expect(page.locator('#compliance-form')).toBeHidden();
});
