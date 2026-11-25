import { randomBytes } from 'node:crypto';
import type { ProPurchaseOrder } from './proSettlement.ts';
import type { sumupCheckouts } from './sumup.ts';
import { isEuVatCountry, quoteProTax, type TaxSettings } from './tax.ts';

/** Pro is a one-off licence per major version; the server decides which version is on sale, never the client. */
export const PRO_MAJOR_VERSION_ON_SALE = 1;

export interface StoredProOrder extends ProPurchaseOrder {
  checkoutId: string;
  createdAt: string;
}

export interface ProOrders {
  save(order: StoredProOrder): Promise<void>;
  get(checkoutId: string): Promise<StoredProOrder | null>;
}

/** EU buyers while the EU switch is off (the owner has not confirmed OSS registration). */
export class CheckoutCountryUnavailable extends Error {}
/** The billing country and the network location disagree, or the location is unknown: never guess the tax. */
export class CheckoutLocationUnconfirmed extends Error {}

interface Dependencies {
  checkouts: Pick<ReturnType<typeof sumupCheckouts>, 'create'>;
  orders: ProOrders;
  taxSettings: () => Promise<TaxSettings>;
  /** The verified settlement (re-fetches SumUp); safe to call repeatedly. */
  settle: (checkoutId: string) => Promise<void>;
  /** Has the account received the paid licence for this order's reference? */
  hasPaidLicence: (accountId: string, licenceId: string) => Promise<boolean>;
  /** HTTPS page SumUp returns the buyer to. */
  redirectUrl: string;
  /** Optional public address of POST /v1/billing/sumup, so SumUp can notify us if the buyer closes the window. */
  callbackUrl?: string;
  now?: () => number;
}

/**
 * Server-owned order: approved price and tax quote, bound to the signed-in account before SumUp sees it.
 * The client never supplies an amount. Fulfilment happens only through the verified settlement.
 */
export function sumupProCheckout(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  if (new URL(deps.redirectUrl).protocol !== 'https:') throw new Error('The checkout return page must use HTTPS.');
  return {
    /**
     * Owner decision (25 Nov 2026): sell worldwide with two matching location checks, the buyer's billing country and
     * the country of their network address (looked up on the server). A mismatch or unknown location is refused.
     */
    async start(input: { accountId: string; emailHash: string; country: string; networkCountry: string | null; euSalesOpen: boolean }) {
      // EU consumer VAT needs the owner's (non-Union) OSS registration first.
      if (isEuVatCountry(input.country) && !input.euSalesOpen) throw new CheckoutCountryUnavailable();
      if (!input.networkCountry || input.networkCountry !== input.country) throw new CheckoutLocationUnconfirmed();
      const at = new Date(now()).toISOString();
      const quote = quoteProTax({
        country: input.country,
        evidence: [
          { source: 'billing-address', country: input.country, observedAt: at },
          { source: 'ip-geolocation', country: input.networkCountry, observedAt: at },
        ],
      }, await deps.taxSettings());
      const reference = 'pro_' + randomBytes(12).toString('hex');
      const invoiceNumber = 'INF-' + at.slice(0, 10).replaceAll('-', '') + '-' + reference.slice(4, 14).toUpperCase();
      const created = await deps.checkouts.create({ reference, totalPence: quote.totalPence }, deps.redirectUrl, deps.callbackUrl);
      await deps.orders.save({
        checkoutId: created.checkoutId, createdAt: at, reference, accountId: input.accountId, emailHash: input.emailHash,
        majorVersion: PRO_MAJOR_VERSION_ON_SALE, invoiceNumber, quote,
      });
      return { checkoutId: created.checkoutId, url: created.url, totalPence: quote.totalPence, currency: quote.currency };
    },
    /** null when the checkout is not this account's, so another person's order is indistinguishable from none. */
    async status(input: { accountId: string; checkoutId: string }): Promise<'paid' | 'pending' | null> {
      const order = await deps.orders.get(input.checkoutId);
      if (!order || order.accountId !== input.accountId) return null;
      await deps.settle(input.checkoutId);
      return (await deps.hasPaidLicence(input.accountId, 'lic_p_' + order.reference)) ? 'paid' : 'pending';
    },
  };
}
