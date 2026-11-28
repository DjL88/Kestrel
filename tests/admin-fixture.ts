import type { Page } from '@playwright/test';

// A copy of the server's switch names (services/control-plane/src/appShared.ts SWITCHES). Not imported: that file pulls
// in the control plane's own packages, which the root type check does not have.
const SWITCHES: Array<{ key: string; label: string; note: string; planned?: boolean }> = [
  { key: 'managed-ai', label: 'Online photo helper', note: 'Lets people ask Google Gemini about one photo at a time, only if they agree. It sends a small copy with no camera or location details. Costs count towards the monthly spending cap.' },
  { key: 'cloud-processing', label: 'Cloud editing power', note: 'Runs heavy jobs (noise removal, enlarging, masks) in the cloud for Pro. Costs count towards the monthly spending cap.' },
  { key: 'safe-copy', label: 'Safe copy (backup)', note: 'People can choose to back up to InFlight\'s UK storage. Off stops new backups only; people can always see and delete their copy.' },
  { key: 'learning-signal', label: 'Share corrections to improve InFlight', note: 'People can choose to share anonymous fixes they make. Off stops sharing; opting out and deleting keep working.' },
  { key: 'pro-checkout', label: 'Selling Pro', note: 'People can subscribe to Pro, monthly or yearly, through Paddle, which handles the tax. Off stops new sign-ups only; existing subscribers keep Pro.' },
  { key: 'cloud-top-ups', label: 'Cloud top-ups', note: 'People can add £5, £10 or £20 of cloud credit through Paddle. Off stops new top-ups only; credit already bought still works.' },
  { key: 'email', label: 'Emails from InFlight', note: 'Sends share invitations, and alerts or news only when a phone alert cannot reach someone. Stays under Google\'s daily limit. No address is stored.' },
  { key: 'push', label: 'Phone and browser alerts', note: 'Tells people about comments and client feedback on shared projects, where they turned alerts on. Names and counts only, never comment text or photos.' },
  { key: 'product-news', label: 'News to everyone', note: 'Lets you send InFlight news from Messages: as an alert where people allow it, or by email if they asked for email news.' },
  { key: 'collaboration', label: 'Shared projects', note: 'Cloud subscribers can share a project, invite people by email and hand photos over to edit. Off stops new sharing; members can still see past versions.' },
  { key: 'vertex-learning', label: 'Model training', note: 'Trains InFlight\'s shared models from measurements and decisions people agreed to share, never photos. Runs in batches and refuses any batch that would pass £20 this month.' },
  { key: 'pro-cloud-storage', planned: true, label: 'Pro cloud storage (not built yet)', note: 'Would keep a project\'s originals in InFlight\'s UK cloud to open anywhere. Cannot be switched on until it is built and you approve the cost.' },
];

// Synthetic data for the admin console tests: made-up accounts, amounts and messages, nothing real.
const T = Date.parse('2026-11-27T09:00:00Z');
const min = 60_000;

export const ADMIN_DATA: Record<string, unknown> = {
  '/v1/admin/config': { passwordSignIn: true, googleClientId: '' },
  '/v1/auth/session': { accessToken: 'admin-test-session' },
  '/v1/admin/overview': {
    accounts: 42, licences: 12, activations: 15, licenceIssuing: true, store: 'firestore', paymentsConnected: true, aiDisabled: false, aiProvider: 'gemini',
    proSubscribers: { monthly: 5, annual: 3 }, spend: { month: '2026-11', spentPence: 412, ceilingPence: 1500 },
  },
  '/v1/admin/licensees': { licences: [
    { licenceId: 'lic_test01', status: 'active', accountId: 'acc_test01', note: 'Tester', validUntilMs: null, maxDevices: 3, managedAi: false, aiQuota: null,
      devices: [{ activationId: 'act_1', platform: 'windows', appVersion: '26.11.4', lastSeenMs: T - 30 * min }] },
  ] },
  '/v1/admin/usage': { aiDisabled: false, aiProvider: 'gemini', accounts: [] },
  '/v1/admin/payments': { connected: true, transactions: [
    { checkoutReference: 'c1', invoiceNumber: 'INV-0001', paidAt: '2026-11-26T12:00:00Z', status: 'paid', country: 'GB', currency: 'GBP', totalPence: 299, netPence: 249, taxPence: 50, accountId: 'acc_test01' },
    { checkoutReference: 'c2', invoiceNumber: 'INV-0002', paidAt: '2026-11-20T12:00:00Z', status: 'paid', country: 'DE', currency: 'GBP', totalPence: 2999, netPence: 2520, taxPence: 479, accountId: 'acc_test02' },
  ] },
  '/v1/admin/messages': { messages: [
    { messageId: 'm1', name: 'Sam Example', email: 'sam@example.test', message: 'Does InFlight read Fuji RAF files?', status: 'new', receivedAtMs: T - 90 * min },
  ] },
  '/v1/admin/pricing/review': { review: null },
  '/v1/admin/pricing': { matrix: { version: 1, base: { 'pro.monthly': 299, 'pro.annual': 2999, 'plus.monthly': 999, 'plus.annual': 9999 }, rates: { date: null, perGbp: {} }, currencies: {}, updatedAt: null }, prices: [], paddle: null },
  '/v1/admin/audit': { entries: [
    ...Array.from({ length: 6 }, (_, i) => ({ at_ms: T - i * 2 * min, actor: 'acc_owner01', action: 'user.signin', outcome: 'allowed', detail: 'firebase' })),
    { at_ms: T - 20 * min, actor: 'acc_owner01', action: 'switch.set', outcome: 'allowed', detail: 'push on' },
    { at_ms: T - 30 * min, actor: 'anonymous', action: 'admin.signin', outcome: 'denied', detail: 'not on the allow-list (abc123def456)' },
  ] },
  '/v1/admin/flags': { flags: {
    accountData: { default: true, rules: [] },
    cloudRecipe: { default: true, rules: [] },
  } },
  // The server's own switch names and notes (services/control-plane/src/appShared.ts), so the page is shown as it really reads.
  '/v1/admin/switches': { switches: SWITCHES.map((w) => ({ key: w.key, label: w.label, note: w.note,
    on: ['managed-ai', 'push', 'email', 'collaboration'].includes(w.key), configured: !w.planned && w.key !== 'learning-signal' })) },
  '/v1/admin/paddle/key': { rotatedAt: '2026-11-24T03:00:00Z', expiresAt: '2027-02-22T03:00:00Z', activated: true, lastRunAt: '2026-11-24T03:00:00Z', lastRunOk: true, lastRunReason: null },
  '/v1/admin/mail': { on: true, day: '2026-11-27', sent: 3, cap: 450, account: 'gmail', from: null, providerLimit: 500, warn: false },
  '/v1/admin/learning': { on: false, newPhotos: 120, photoThreshold: 1000, lastRunAtMs: null, manualRequested: false, running: false, month: '2026-11', reservedPence: 0, ceilingPence: 2000, runReservePence: 500, runs: [] },
  '/v1/admin/compliance/documents': { documents: [], maxBytes: 8000000 },
  '/v1/admin/safety': { notices: [] },
  '/v1/admin/balance-refunds': { refunds: [] },
  '/v1/admin/accounts': { month: '2026-11', paymentsConnected: true, transactions: [], costModel: { reservedPence: 412, ceilingPence: 1500 } },
  '/v1/admin/tax': { settings: { ukVatRegistered: false, ukVatNumber: null, b2cPricing: 'inclusive', localTaxes: {} }, turnover: { rollingPence: 3298, state: 'ok' }, thresholdPence: 9_000_000, warningPence: 7_500_000 },
};

/**
 * Serves the synthetic data above for every /v1 call and signs in with the local password form. `extra` replaces
 * answers; a path mapped to `undefined` answers 500, as a store that cannot be read would.
 */
export async function signInAdmin(page: Page, origin: string, extra: Record<string, unknown> = {}) {
  const posts: Array<{ path: string; body: unknown }> = [];
  await page.route('**/v1/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST' && path.startsWith('/v1/admin/')) posts.push({ path, body: req.postDataJSON() });
    const responses = { ...ADMIN_DATA, ...extra };
    if (path in extra && extra[path] === undefined) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"Store unavailable"}}' });
    if (req.method() === 'POST' && !(path in responses)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    await route.fulfill({ status: path in responses ? 200 : 503, contentType: 'application/json', body: JSON.stringify(responses[path] ?? { error: { message: 'Not set up on this server.' } }) });
  });
  await page.goto(origin + '/admin.html');
  await page.locator('#password-form').getByLabel('Email').fill('admin@example.test');
  await page.locator('#password-form').getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return posts;
}
