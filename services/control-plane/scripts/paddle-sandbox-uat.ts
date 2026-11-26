/**
 * Paddle sandbox acceptance: buy → unlock → refund → lock, against the real Paddle sandbox API with a test card.
 *
 * It runs the server's own Paddle code (paddleApi, paddleProCheckout, paddleProSettlement, paddleRefundRevocation) with a
 * throwaway in-memory licence store, so it proves our code against what Paddle really returns. It never touches
 * production, Firestore or any real account, and it refuses a production key.
 *
 *   cd services/control-plane
 *   PADDLE_SANDBOX_API_KEY=... PADDLE_SANDBOX_PRO_PRICE_ID=pri_... npx tsx scripts/paddle-sandbox-uat.ts
 *
 * Optional: PADDLE_SANDBOX_CHECKOUT_URL (default https://inflight.studio/pro-checkout; Paddle's default payment link
 * also works), PADDLE_UAT_PARTIAL=1 to first check that a partial refund leaves Pro unlocked.
 *
 * One-off sandbox set-up (free, no real money, nothing goes live). Never paste a key into chat or commit it.
 *   1. Sign up at https://sandbox-login.paddle.com/signup (a separate login from any live Paddle account).
 *   2. Catalog → Products → New product "InFlight Pro" (tax category Standard digital goods); add a recurring monthly
 *      price of 2.99 GBP (Pro is sold only as a subscription). Copy the price ID (pri_...) into PADDLE_SANDBOX_PRO_PRICE_ID.
 *   3. Checkout → Checkout settings → Default payment link: https://inflight.studio/pro-checkout (or any HTTPS page you
 *      own that loads Paddle.js). Without it Paddle refuses to create a checkout.
 *   4. Developer tools → Authentication → New API key, with write access to Transactions and Adjustments and read access to Subscriptions. Copy it
 *      (it starts pdl_sdbx_) into PADDLE_SANDBOX_API_KEY in your own terminal only.
 *   5. Run the command above and follow its prompt: it prints a checkout link to pay with the test card, waits, refunds
 *      the payment through the API, and prints PASS or FAIL for each step. Delete the key afterwards if you like.
 */
import { randomBytes } from 'node:crypto';
import { emailHashOf } from '../src/entitlement.ts';
import { paddleApi, paddleApiBase, type PaddleAdjustment } from '../src/commerce/paddle.ts';
import { paddleProCheckout, type StoredProOrder } from '../src/commerce/proCheckout.ts';
import { paddleProLicenceId, paddleRefundRevocation } from '../src/commerce/paddleRefunds.ts';
import { paddleProSettlement, type ProSubscriptionRecord } from '../src/commerce/proSettlement.ts';
import type { TransactionRecord } from '../src/commerce/records.ts';
import { SqliteStore } from '../src/sqliteStore.ts';
import { licenceIsUsable } from '../src/store.ts';

const apiKey = process.env.PADDLE_SANDBOX_API_KEY?.trim();
const priceId = process.env.PADDLE_SANDBOX_PRO_PRICE_ID?.trim();
const checkoutUrl = process.env.PADDLE_SANDBOX_CHECKOUT_URL?.trim() || 'https://inflight.studio/pro-checkout';
const tryPartial = process.env.PADDLE_UAT_PARTIAL === '1';

const results: { step: string; ok: boolean; detail: string }[] = [];
function record(step: string, ok: boolean, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
  if (!ok) finish(1);
}
function finish(code: number): never {
  console.log('\n' + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} | ${r.step}`).join('\n'));
  process.exit(code);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, minutes: number, probe: () => Promise<T | undefined>): Promise<T> {
  const until = Date.now() + minutes * 60_000;
  for (let i = 0; Date.now() < until; i++) {
    const got = await probe();
    if (got !== undefined) return got;
    if (i % 6 === 0) console.log(`   … waiting for ${what}`);
    await sleep(10_000);
  }
  record(what, false, `nothing after ${minutes} minutes`);
  throw new Error('unreachable');
}

if (!apiKey || !priceId) {
  console.error('Set PADDLE_SANDBOX_API_KEY and PADDLE_SANDBOX_PRO_PRICE_ID first (the steps at the top of this script).');
  process.exit(2);
}
if (!apiKey.startsWith('pdl_sdbx_')) {
  console.error('That is not a sandbox API key (sandbox keys start pdl_sdbx_). This script only runs against the sandbox.');
  process.exit(2);
}

const paddle = paddleApi({ apiKey, environment: 'sandbox' });
const store = new SqliteStore(':memory:');
const orders = new Map<string, StoredProOrder>();
const ledger = new Map<string, TransactionRecord>();
const findOrder = async (id: string) => orders.get(id) ?? null;
const subscriptions = new Map<string, ProSubscriptionRecord>();
const settle = paddleProSettlement({
  findOrder, paddle, licences: store,
  subscriptions: { save: async (s) => { subscriptions.set(s.subscriptionId, s); }, get: async (id) => subscriptions.get(id) ?? null },
  commerce: { recordPaid: async (r) => { if (!ledger.has(r.checkoutReference)) ledger.set(r.checkoutReference, r); return ledger.get(r.checkoutReference)!; } },
});
const claimed = new Set<string>();
const revoke = paddleRefundRevocation({
  findOrder, paddle, licences: store, now: Date.now,
  events: { claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)), release: async (id) => { claimed.delete(id); } },
});
// In production each webhook carries its own event id; here each adjustment stands for one notification.
const refund = (adjustmentId: string, eventId = 'evt_uat_' + adjustmentId) => revoke(eventId, adjustmentId);
const checkout = paddleProCheckout({ paddle, orders: { save: async (o) => { orders.set(o.transactionId, o); }, get: findOrder }, priceIds: { monthly: priceId }, checkoutUrl, settle });

async function createAdjustment(transactionId: string, type: 'full' | 'partial'): Promise<string> {
  // Partial refunds name a line item and an amount; full refunds do not.
  const full = await fetch(paddleApiBase('sandbox') + '/transactions/' + transactionId, { headers: { Authorization: 'Bearer ' + apiKey } });
  const lineItemId = ((await full.json()) as { data?: { details?: { line_items?: { id: string }[] } } }).data?.details?.line_items?.[0]?.id;
  const body = type === 'full'
    ? { action: 'refund', type: 'full', transaction_id: transactionId, reason: 'InFlight sandbox acceptance test' }
    : { action: 'refund', type: 'partial', transaction_id: transactionId, reason: 'InFlight sandbox acceptance test (partial)', items: [{ item_id: lineItemId, type: 'partial', amount: '100' }] };
  const res = await fetch(paddleApiBase('sandbox') + '/adjustments', {
    method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Paddle-Version': '1' }, body: JSON.stringify(body),
  });
  const json = await res.json() as { data?: { id?: string }; error?: { detail?: string } };
  if (!res.ok || !json.data?.id) record(`Paddle accepts a ${type} refund`, false, `${res.status} ${json.error?.detail ?? ''}`);
  return json.data!.id!;
}

async function approved(id: string): Promise<PaddleAdjustment> {
  return waitFor('Paddle to approve refund ' + id + ' (approve it in the sandbox dashboard if it stays pending)', 30, async () => {
    const a = await paddle.getAdjustment(id);
    if (a?.status === 'rejected') record('refund approved', false, 'Paddle rejected it');
    return a?.status === 'approved' ? a : undefined;
  });
}

const accountId = 'acc_uat_' + randomBytes(6).toString('hex');
const email = `uat+${randomBytes(4).toString('hex')}@example.test`;
await store.createAccount({ accountId, emailHash: emailHashOf(email), passwordHash: 'uat-only', role: 'user', status: 'active', createdAtMs: Date.now(), aiConsent: false });
const proUnlocked = async () => (await store.listLicencesForAccount(accountId)).some((l) => l.paid && licenceIsUsable(l, Date.now()));

// 1. Buy
const started = await checkout.start({ accountId, emailHash: emailHashOf(email), plan: 'monthly' }).catch((error: unknown) => {
  record('server-bound sandbox transaction created', false, `${(error as Error).message} ${String((error as { cause?: unknown }).cause ?? '')} (check the key, the price ID, the default payment link, and that sandbox-api.paddle.com is reachable)`);
  throw error;
});
record('server-bound sandbox transaction created', /^txn_/.test(started.checkoutId), started.checkoutId);
record('Pro is locked before payment', !(await proUnlocked()));
console.log(`\nOpen this checkout and pay with the test card:\n\n   ${started.url}\n
   Card 4242 4242 4242 4242, any future expiry, CVC 100, any name, any email and postcode.
   (If the page does not open Paddle's form, set a default payment link in the sandbox: Checkout → Checkout settings.)\n`);
await waitFor('the sandbox payment to complete', 20, async () => ((await settle(started.checkoutId)) === 'paid' ? true : undefined));

// 2. Unlock
record('payment verified with Paddle and Pro unlocked', await proUnlocked());
record('status check says paid', (await checkout.status({ accountId, checkoutId: started.checkoutId })) === 'paid');
record('repeating settlement grants nothing new', (await settle(started.checkoutId)) === 'paid' && (await store.listLicencesForAccount(accountId)).length === 1);

// 3. Optional partial refund: Pro stays
if (tryPartial) {
  const partial = await approved(await createAdjustment(started.checkoutId, 'partial'));
  record('partial refund handled', (await refund(partial.id)) === 'kept');
  record('Pro still unlocked after a partial refund', await proUnlocked());
}

// 4. Full refund → lock
const full = await approved(await createAdjustment(started.checkoutId, 'full'));
record('full refund handled', (await refund(full.id)) === 'revoked', full.id);
const order = orders.get(started.checkoutId)!;
record('Pro locked after the full refund', !(await proUnlocked()) && (await store.getLicence(paddleProLicenceId(order)))?.status === 'revoked');
record('the same notification again is a duplicate', (await refund(full.id)) === 'duplicate' && !(await proUnlocked()));
record('a second notification for the same refund changes nothing', (await refund(full.id, 'evt_uat_again')) === 'revoked' && !(await proUnlocked()));
await settle(started.checkoutId);
record('a repeated completed notification cannot unlock it again', !(await proUnlocked()));
finish(0);
