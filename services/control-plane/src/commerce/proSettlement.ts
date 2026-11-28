import { purchaseEntitlement } from '../entitlement.ts';
import { DAY_MS, type LicenceRecord, type Store } from '../store.ts';
import type { CommerceLedger } from './ledger.ts';
import { isPaddlePaid, minorUnits, PADDLE_SUBSCRIPTION_ID, type PaddleSubscription, type PaddleTransaction } from './paddle.ts';
import type { ProPlan } from './proCheckout.ts';

/** Server-owned order, bound to a verified account before Paddle sees it. */
export interface ProPurchaseOrder {
  /** Our reference, sent to Paddle as custom_data.reference: the idempotency key for the sale and the licence. */
  reference: string;
  accountId: string;
  emailHash: string;
  majorVersion: number;
  invoiceNumber: string;
  /** The Paddle price the order was opened for. */
  priceId: string;
  /** Monthly or annual subscription. Absent on orders for the retired one-off licence, which are still honoured. */
  plan?: ProPlan;
}

/**
 * How long Pro keeps working after the paid-through date while a subscription is still running: Paddle retries a
 * failed renewal payment, a renewal notice can be late, and a device may be offline when it renews. The app's own
 * offline limit (the licence's offlineGraceDays, 30 days since the device last checked) still applies as well.
 */
export const SUBSCRIPTION_GRACE_DAYS = 14;

/** Pro subscriptions we sold, keyed by Paddle subscription ID: written only after the first payment is verified. */
export interface ProSubscriptionRecord {
  subscriptionId: string;
  reference: string;
  accountId: string;
  emailHash: string;
  licenceId: string;
  majorVersion: number;
  plan: ProPlan;
  firstTransactionId: string;
  /** The end of the last period Paddle said was paid for. */
  paidThroughMs: number | null;
  status: PaddleSubscription['status'];
  updatedAt: string;
}

export interface ProSubscriptions {
  save(record: ProSubscriptionRecord): Promise<void>;
  get(subscriptionId: string): Promise<ProSubscriptionRecord | null>;
  /** This account's subscriptions (for Manage or cancel Pro). Optional: without it, the route says there is none. */
  forAccount?(accountId: string): Promise<ProSubscriptionRecord[]>;
}

interface Dependencies {
  findOrder: (transactionId: string) => Promise<ProPurchaseOrder | null>;
  paddle: {
    getTransaction(id: string): Promise<PaddleTransaction>;
    getSubscription?(id: string): Promise<PaddleSubscription>;
    createPortalSession?(customerId: string, subscriptionId: string): Promise<{ manageUrl: string; cancelUrl: string; paymentUrl: string }>;
  };
  commerce: Pick<CommerceLedger, 'recordPaid'>;
  licences: Pick<Store, 'getAccount' | 'grantLicence'> & Partial<Pick<Store, 'setLicenceValidUntil'>>;
  /** Needed to sell subscriptions. Without it, only orders for the retired one-off licence settle. */
  subscriptions?: ProSubscriptions;
  /**
   * Called once, when this payment first creates the licence (not on Paddle's retries): server.ts emails the buyer
   * their key. A failure here never undoes the sale; the key is still handed over at sign-in.
   */
  onNewLicence?: (licence: LicenceRecord) => Promise<void>;
  now?: () => number;
}

/**
 * When Pro stops, from the subscription as Paddle has it now:
 * - running (active, trialing, past_due): the paid-through date plus SUBSCRIPTION_GRACE_DAYS;
 * - ended (canceled, paused), or a cancellation already scheduled for the end of the period: the paid-through date,
 *   with no grace, so nobody loses a period they paid for and nobody keeps Pro after cancelling.
 * After that the account is Basic. Nothing on the person's devices (projects, edits, exports) is touched.
 */
export function subscriptionValidUntil(status: PaddleSubscription['status'], paidThroughMs: number | null, nowMs: number, cancelScheduled = false): number {
  const paidThrough = paidThroughMs ?? nowMs;
  return status === 'canceled' || status === 'paused' || cancelScheduled ? paidThrough : paidThrough + SUBSCRIPTION_GRACE_DAYS * DAY_MS;
}

/**
 * Reconcile by Paddle transaction ID, from the signed webhook or from the app's status check, and keep a subscription's
 * licence in step with Paddle. The transaction and subscription are always fetched back from Paddle and matched to the
 * stored order. Safe to call any number of times: the sale and the licence both use the order's reference as their key.
 */
export function paddleProBilling(d: Dependencies) {
  const now = d.now ?? Date.now;

  async function recordSale(t: PaddleTransaction, order: { reference: string; accountId: string; invoiceNumber: string }): Promise<boolean> {
    const paidAt = new Date(Date.parse(t.billed_at ?? t.updated_at ?? '') || now()).toISOString();
    const payout = t.details.payout_totals!;
    const earnings = minorUnits(payout.earnings);
    const supplyDate = paidAt.slice(0, 10);
    const buyerCountry = t.address?.country_code ?? null;
    const sale = await d.commerce.recordPaid({
      // InFlight's sale is to Paddle (a UK reseller); Paddle accounted for the buyer's tax.
      currency: payout.currency_code, country: 'GB', jurisdiction: 'GB', customerType: 'B2B', treatment: 'merchant-of-record',
      rateBasisPoints: 0, netPence: earnings, taxPence: 0, totalPence: earnings, vatNumber: null, invoiceNotice: null,
      verification: null, evidence: buyerCountry ? [{ source: 'billing-address', country: buyerCountry, observedAt: paidAt }] : [],
      store: 'paddle',
      buyer: { country: buyerCountry, currency: t.details.totals.currency_code, totalMinor: minorUnits(t.details.totals.total), taxMinor: minorUnits(t.details.totals.tax) },
      storeFeeMinor: minorUnits(payout.fee),
      checkoutReference: order.reference,
      providerCheckoutId: t.id,
      providerTransactionId: t.id,
      accountId: order.accountId,
      status: 'paid',
      supplyDate,
      paidAt,
      retainThrough: String(Number(supplyDate.slice(0, 4)) + 10) + '-12-31',
      invoiceNumber: order.invoiceNumber,
    });
    return sale.status === 'paid' && sale.accountId === order.accountId;
  }

  /** Fetch the subscription from Paddle and move the licence's end date to match. */
  async function applySubscription(record: ProSubscriptionRecord): Promise<ProSubscriptionRecord> {
    if (!d.paddle.getSubscription || !d.subscriptions || !d.licences.setLicenceValidUntil) throw new Error('Subscriptions are not set up.');
    const s = await d.paddle.getSubscription(record.subscriptionId);
    const custom = s.custom_data ?? {};
    if (s.id !== record.subscriptionId || ('reference' in custom && custom.reference !== record.reference)
      || ('accountId' in custom && custom.accountId !== record.accountId)) {
      throw new Error('The Paddle subscription does not match the recorded order.');
    }
    const periodEnd = Date.parse(s.current_billing_period?.ends_at ?? '');
    const paidThroughMs = Number.isFinite(periodEnd) ? periodEnd : record.paidThroughMs;
    const at = now();
    const cancelScheduled = s.scheduled_change?.action === 'cancel' || s.scheduled_change?.action === 'pause';
    const validUntilMs = subscriptionValidUntil(s.status, paidThroughMs, at, cancelScheduled);
    if (!(await d.licences.setLicenceValidUntil(record.licenceId, validUntilMs, at))) {
      await d.licences.grantLicence(purchaseEntitlement({
        store: 'paddle', checkoutReference: record.reference, accountId: record.accountId, emailHash: record.emailHash,
        majorVersion: record.majorVersion, validUntilMs,
      }, at));
    }
    const next = { ...record, paidThroughMs, status: s.status, updatedAt: new Date(at).toISOString() };
    await d.subscriptions.save(next);
    return next;
  }

  /** subscription.* notifications (created, updated, past_due, paused, resumed, canceled). Unknown subscriptions are left alone. */
  async function syncSubscription(subscriptionId: string): Promise<'synced' | 'unknown'> {
    if (!d.subscriptions || !PADDLE_SUBSCRIPTION_ID.test(subscriptionId)) return 'unknown';
    const record = await d.subscriptions.get(subscriptionId);
    if (!record) return 'unknown'; // not ours, or its first payment has not been verified yet (that settles it)
    await applySubscription(record);
    return 'synced';
  }

  /** A renewal payment: record the sale and move the end date on. The webhook's subscription_id is only a pointer. */
  async function settleRenewal(transactionId: string, subscriptionId: string | undefined): Promise<'paid' | 'pending' | 'unknown'> {
    if (!subscriptionId || !d.subscriptions || !PADDLE_SUBSCRIPTION_ID.test(subscriptionId)) return 'unknown';
    const record = await d.subscriptions.get(subscriptionId);
    if (!record) return 'unknown';
    const t = await d.paddle.getTransaction(transactionId);
    if (t.id !== transactionId || t.subscription_id !== subscriptionId
      || (t.custom_data?.accountId !== undefined && t.custom_data.accountId !== record.accountId)) {
      throw new Error('The Paddle renewal does not match the recorded subscription.');
    }
    if (!isPaddlePaid(t) || !t.details.payout_totals) return 'pending';
    const at = new Date(now()).toISOString();
    // Each renewal is its own sale, keyed by Paddle's transaction ID.
    if (!(await recordSale(t, { reference: 'paddle_' + t.id, accountId: record.accountId, invoiceNumber: 'INF-' + at.slice(0, 10).replaceAll('-', '') + '-' + t.id.slice(-10).toUpperCase() }))) return 'pending';
    await applySubscription(record);
    return 'paid';
  }

  async function settle(transactionId: string, hint?: { subscriptionId?: string }): Promise<'paid' | 'pending' | 'unknown'> {
    const order = await d.findOrder(transactionId);
    if (!order) return settleRenewal(transactionId, hint?.subscriptionId);

    const account = await d.licences.getAccount(order.accountId);
    if (!account || account.emailHash !== order.emailHash) throw new Error('Pro payment has no matching account.');
    const t = await d.paddle.getTransaction(transactionId);
    // A one-off order never has a subscription; a subscription order has one once it is paid (Paddle makes it then).
    const subscriptionOk = order.plan ? !t.subscription_id || PADDLE_SUBSCRIPTION_ID.test(t.subscription_id) : !t.subscription_id;
    if (t.id !== transactionId || t.custom_data?.reference !== order.reference || t.custom_data?.accountId !== order.accountId
      || !subscriptionOk || t.items.length !== 1 || t.items[0]!.quantity !== 1
      || (t.items[0]!.price?.id ?? t.items[0]!.price_id) !== order.priceId) {
      throw new Error('The Paddle transaction does not match the recorded order.');
    }
    // 'completed' is Paddle's signal to fulfil: paid, and the payout figures are final.
    if (!isPaddlePaid(t) || !t.details.payout_totals) return 'pending';
    if (order.plan && !t.subscription_id) throw new Error('The Paddle payment for a subscription has no subscription.');
    if (!(await recordSale(t, order))) return 'pending';

    const paidAtMs = Date.parse(t.billed_at ?? t.updated_at ?? '') || now();
    const grant = { store: 'paddle' as const, checkoutReference: order.reference, accountId: order.accountId, emailHash: order.emailHash, majorVersion: order.majorVersion };
    if (!order.plan) {
      // The retired one-off licence: bought before 26 Nov 2026, honoured for good.
      const granted = await d.licences.grantLicence(purchaseEntitlement(grant, paidAtMs));
      if (granted.created && d.onNewLicence) await d.onNewLicence(granted.licence).catch(() => undefined);
      return 'paid';
    }
    if (!d.subscriptions) throw new Error('Subscriptions are not set up.');
    // A subscription: Pro until the paid-through date plus grace. Start with a short window; applySubscription sets the real one.
    const granted = await d.licences.grantLicence(purchaseEntitlement({ ...grant, validUntilMs: paidAtMs + SUBSCRIPTION_GRACE_DAYS * DAY_MS }, paidAtMs));
    const existing = await d.subscriptions.get(t.subscription_id!);
    await applySubscription(existing ?? {
      subscriptionId: t.subscription_id!, reference: order.reference, accountId: order.accountId, emailHash: order.emailHash,
      licenceId: granted.licence.licenceId, majorVersion: order.majorVersion, plan: order.plan, firstTransactionId: transactionId,
      paidThroughMs: null, status: 'active', updatedAt: new Date(now()).toISOString(),
    });
    return 'paid';
  }

  /**
   * Manage or cancel Pro: the account's newest subscription as Paddle has it now, with Paddle's own pages to cancel it
   * or change the card. null when the account has no subscription (Basic, a gift, or a one-off licence bought earlier).
   */
  async function manage(accountId: string): Promise<SubscriptionManagement | null> {
    if (!d.subscriptions?.forAccount || !d.paddle.getSubscription || !d.paddle.createPortalSession) return null;
    const records = (await d.subscriptions.forAccount(accountId)).filter((r) => r.accountId === accountId);
    const record = records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!record) return null;
    const s = await d.paddle.getSubscription(record.subscriptionId);
    if (s.id !== record.subscriptionId || !s.customer_id) throw new Error('The Paddle subscription has no customer.');
    const periodEnd = Date.parse(s.current_billing_period?.ends_at ?? '');
    const paidThroughMs = Number.isFinite(periodEnd) ? periodEnd : record.paidThroughMs;
    const scheduledEnd = s.scheduled_change?.action === 'cancel' ? Date.parse(s.scheduled_change.effective_at) : NaN;
    const state: SubscriptionManagement['state'] = s.status === 'canceled' ? 'ended'
      : Number.isFinite(scheduledEnd) ? 'ending' : s.status === 'past_due' ? 'payment-due' : s.status === 'paused' ? 'paused' : 'renewing';
    const links = s.status === 'canceled' ? null : await d.paddle.createPortalSession(s.customer_id, s.id);
    return { plan: record.plan, state, paidThroughMs: Number.isFinite(scheduledEnd) ? scheduledEnd : paidThroughMs, ...(links ?? {}) };
  }

  /**
   * Pro Plus: true while the account has a Pro Plus subscription that Paddle has not cancelled and whose paid-through
   * date (or grace after it) has not passed. Decides the 5,000 cloud photo allowance; anything else is Pro's 500.
   */
  async function hasPlus(accountId: string): Promise<boolean> {
    if (!d.subscriptions?.forAccount) return false;
    const at = now();
    return (await d.subscriptions.forAccount(accountId)).some((r) => r.accountId === accountId && (r.plan === 'plus' || r.plan === 'plusAnnual')
      && r.status !== 'canceled' && (r.paidThroughMs ?? 0) + SUBSCRIPTION_GRACE_DAYS * DAY_MS > at);
  }

  return { settle, syncSubscription, manage, hasPlus };
}

export interface SubscriptionManagement {
  plan: ProPlan;
  /** renewing: renews by itself · ending: cancelled, Pro lasts to paidThroughMs · payment-due: Paddle is retrying the card. */
  state: 'renewing' | 'ending' | 'payment-due' | 'paused' | 'ended';
  paidThroughMs: number | null;
  /** Paddle's pages (absent once the subscription has ended). */
  manageUrl?: string;
  cancelUrl?: string;
  paymentUrl?: string;
}

/** The settlement on its own (the signature app.ts and older tests use). */
export const paddleProSettlement = (d: Dependencies) => paddleProBilling(d).settle;
