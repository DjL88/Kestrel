/**
 * Buying Pro through the control plane's server-owned Paddle checkout (services/control-plane/README.md, "Buying Pro").
 * The server picks the price and binds the order to the signed-in account; the app only opens our checkout page, where
 * Paddle (the merchant of record, which handles the buyer's tax) takes the payment. The app waits for the server to say
 * the payment is verified, then activates the device as for any other Pro account. Pure: no network.
 */

/**
 * Pro is sold only as a subscription (owner decision, 26 Nov 2026): monthly or annual. Basic stays free. When a
 * subscription ends the account is Basic again; projects, edits and exports are never locked.
 */
export type ProPlan = 'monthly' | 'annual';
export const PRO_PLAN_CHOICES: readonly { plan: ProPlan; label: string; price: string }[] = [
  { plan: 'monthly', label: 'Monthly', price: '£2.99 a month' },
  { plan: 'annual', label: 'Yearly', price: '£29.99 a year' },
];
/** How long Pro keeps working after a renewal date while a device cannot check (the control plane's grace). */
export const SUBSCRIPTION_GRACE_DAYS = 14;

/** The server allows ten checkout calls a minute per account (start and checks together), so check every 10 seconds. */
export const CHECKOUT_POLL_MS = 10_000;
/** Stop checking by itself after 20 minutes. The person can check again; a paid order still settles on the server. */
export const CHECKOUT_POLL_LIMIT_MS = 20 * 60_000;

export type CheckoutStart =
  | { ok: true; checkoutId: string; url: string; totalPence: number | null; currency: string | null }
  | { ok: false; code: string; message: string };

export type CheckoutPoll = 'paid' | 'pending' | 'retry' | 'gone';

/** Calm, plain words for every answer the checkout can give. Nothing here ever touches photos or edits. */
export function checkoutErrorText(code: string | undefined): string {
  switch (code) {
    case 'CHECKOUT_DISABLED': return 'Pro subscriptions are not open yet. Everything else in InFlight keeps working.';
    case 'ALREADY_PRO': return 'This account already has Pro. Choose Check Pro online to use it on this device.';
    case 'ACCOUNT_UNVERIFIED': return 'Sign in again before subscribing to Pro. If you signed up with email, verify the address first.';
    case 'RATE_LIMITED': return 'That was a lot of attempts in a short time. Wait a minute and try again.';
    case 'CHECKOUT_UNAVAILABLE': return 'The payment page could not be opened. Nothing was charged; try again shortly.';
    case 'NOT_SIGNED_IN': return 'Sign in to subscribe to Pro.';
    case 'NOT_SET_UP': return 'This version of InFlight cannot subscribe to Pro online. Everything else keeps working.';
    default: return 'The payment page could not be opened right now. Nothing was charged; try again shortly.';
  }
}

/** The website hosts that serve our checkout page (site/pro-checkout.html), which loads Paddle.js. */
// Keep in step with the opener allow-list in src-tauri/capabilities/desktop.json.
export const CHECKOUT_SITE_HOSTS: readonly string[] = ['kestrel-hosting-kestrel.web.app', 'inflight.studio'];

/**
 * Only our own HTTPS checkout page for one Paddle transaction is opened. The address comes from our server, but the app
 * still refuses anything else, so a fault on the server can never send the person to another site to pay.
 */
export function isPaddleCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && CHECKOUT_SITE_HOSTS.includes(url.hostname)
      && url.pathname === '/pro-checkout' && CHECKOUT_ID.test(url.searchParams.get('_ptxn') ?? '');
  } catch { return false; }
}

/** A Paddle transaction ID, e.g. txn_01h04vsc0qhwtsbsxh3422wjs4. */
export const CHECKOUT_ID = /^txn_[a-z0-9]{10,60}$/;

/** The answer to POST /v1/me/checkout/pro. */
export function parseCheckoutStart(status: number, json: Record<string, unknown> | null): CheckoutStart {
  if (status === 201 || status === 200) {
    const { checkoutId, url, totalPence, currency } = json ?? {};
    if (typeof checkoutId === 'string' && CHECKOUT_ID.test(checkoutId) && isPaddleCheckoutUrl(url) && new URL(url).searchParams.get('_ptxn') === checkoutId) {
      return {
        ok: true, checkoutId, url,
        totalPence: Number.isSafeInteger(totalPence) && (totalPence as number) > 0 ? totalPence as number : null,
        currency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null,
      };
    }
    return { ok: false, code: 'CHECKOUT_UNAVAILABLE', message: checkoutErrorText('CHECKOUT_UNAVAILABLE') };
  }
  const code = typeof (json?.error as { code?: unknown } | undefined)?.code === 'string' ? (json!.error as { code: string }).code : 'UNKNOWN';
  return { ok: false, code, message: checkoutErrorText(code) };
}

/** The answer to GET /v1/me/checkout/pro/:id. Anything unclear means "check again later", never "paid". */
export function parseCheckoutPoll(status: number, json: Record<string, unknown> | null): CheckoutPoll {
  if (status === 200 && json?.status === 'paid') return 'paid';
  if (status === 200 && json?.status === 'pending') return 'pending';
  if (status === 404) return 'gone';
  return 'retry';
}

/** Whether to keep checking by itself, given when checking began. */
export const keepPolling = (startedMs: number, nowMs: number) => nowMs - startedMs < CHECKOUT_POLL_LIMIT_MS;

/** "£49.00" style price, or null when the server did not say. */
export function priceText(totalPence: number | null, currency: string | null, locale?: string): string | null {
  if (totalPence === null || currency === null) return null;
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(totalPence / 100); } catch { return null; }
}

/** Paddle's customer portal hosts (production and sandbox): the only places Manage or cancel Pro ever opens. */
export function isPaddlePortalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname === 'customer-portal.paddle.com' || url.hostname === 'sandbox-customer-portal.paddle.com');
  } catch { return false; }
}

export type SubscriptionState = 'renewing' | 'ending' | 'payment-due' | 'paused' | 'ended';
export type SubscriptionManage =
  | { ok: true; plan: ProPlan; state: SubscriptionState; paidThroughMs: number | null; manageUrl?: string; cancelUrl?: string; paymentUrl?: string }
  | { ok: false; code: string; message: string };

const STATES: readonly SubscriptionState[] = ['renewing', 'ending', 'payment-due', 'paused', 'ended'];

/** The answer to POST /v1/me/subscription/manage. A link that is not Paddle's portal is dropped, never opened. */
export function parseSubscriptionManage(status: number, json: Record<string, unknown> | null): SubscriptionManage {
  if (status === 200 && json && (json.plan === 'monthly' || json.plan === 'annual') && STATES.includes(json.state as SubscriptionState)) {
    const link = (v: unknown) => (isPaddlePortalUrl(v) ? { url: v } : null);
    const manage = link(json.manageUrl), cancel = link(json.cancelUrl), payment = link(json.paymentUrl);
    return {
      ok: true, plan: json.plan, state: json.state as SubscriptionState,
      paidThroughMs: Number.isSafeInteger(json.paidThroughMs) ? json.paidThroughMs as number : null,
      ...(manage ? { manageUrl: manage.url } : {}), ...(cancel ? { cancelUrl: cancel.url } : {}), ...(payment ? { paymentUrl: payment.url } : {}),
    };
  }
  const code = typeof (json?.error as { code?: unknown } | undefined)?.code === 'string' ? (json!.error as { code: string }).code : 'UNKNOWN';
  const message = code === 'NO_SUBSCRIPTION' ? 'This account has no Pro subscription to manage. A one-off licence bought earlier never needs cancelling.'
    : code === 'RATE_LIMITED' ? 'That was a lot of attempts in a short time. Wait a minute and try again.'
    : code === 'NOT_SET_UP' ? 'This version of InFlight cannot manage Pro online. You can cancel from the link in your Paddle receipt.'
    : 'Your subscription could not be checked just now. Nothing has changed. You can also cancel from the link in your Paddle receipt.';
  return { ok: false, code, message };
}

/** Plain words for where the subscription stands. Ending always says what happens next: Basic, nothing locked. */
export function subscriptionStateText(m: Extract<SubscriptionManage, { ok: true }>, locale?: string): string {
  const day = m.paidThroughMs === null ? null : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(m.paidThroughMs);
  const plan = m.plan === 'annual' ? 'Yearly' : 'Monthly';
  switch (m.state) {
    case 'renewing': return `${plan} Pro renews by itself${day ? ` on ${day}` : ''}.`;
    case 'ending': return `Cancelled. Pro lasts${day ? ` until ${day}` : ' until the end of the period you paid for'}, then this account goes back to Basic. Your projects, edits and exports are never locked.`;
    case 'payment-due': return `The last payment did not go through, and Paddle is trying again. Pro keeps working for up to ${SUBSCRIPTION_GRACE_DAYS} days${day ? ` after ${day}` : ''}. You can update your card below.`;
    case 'paused': return `Paused. This account is on Basic until the subscription resumes. Your work is never locked.`;
    case 'ended': return 'This subscription has ended, so this account is on Basic. Your projects, edits and exports are never locked. You can subscribe again at any time.';
  }
}
