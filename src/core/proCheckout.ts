/**
 * Buying Pro through the control plane's server-owned SumUp checkout (services/control-plane/README.md, "Buying Pro").
 * The server prices the order and binds it to the signed-in account; the app only opens SumUp's page, waits for the
 * server to say the payment is verified, then activates the device as for any other Pro account. Pure: no network.
 */

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
    case 'CHECKOUT_DISABLED': return 'Buying Pro is not open yet. Everything else in InFlight keeps working.';
    case 'COUNTRY_UNAVAILABLE': return 'Pro is not on sale in your country yet. Everything else in InFlight keeps working, and nothing was charged.';
    case 'LOCATION_UNCONFIRMED': return 'We could not confirm your country: the billing country you chose and your network location differ. If you use a VPN, turn it off and try again. Nothing was charged.';
    case 'ALREADY_PRO': return 'This account already has Pro. Choose Check Pro online to use it on this device.';
    case 'ACCOUNT_UNVERIFIED': return 'Sign in again before buying Pro. If you signed up with email, verify the address first.';
    case 'RATE_LIMITED': return 'That was a lot of attempts in a short time. Wait a minute and try again.';
    case 'CHECKOUT_UNAVAILABLE': return 'The payment page could not be opened. Nothing was charged; try again shortly.';
    case 'NOT_SIGNED_IN': return 'Sign in to buy Pro.';
    case 'NOT_SET_UP': return 'This version of InFlight cannot buy Pro online. Everything else keeps working.';
    default: return 'The payment page could not be opened right now. Nothing was charged; try again shortly.';
  }
}

/**
 * Only SumUp's own HTTPS pages are opened. The address comes from our server, but the app still refuses anything
 * else, so a fault on the server can never send the person to another site to pay.
 */
export function isSumUpCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'sumup.com' || url.hostname.endsWith('.sumup.com'));
  } catch { return false; }
}

const CHECKOUT_ID = /^[A-Za-z0-9-]{1,64}$/;

/** The answer to POST /v1/me/checkout/pro. */
export function parseCheckoutStart(status: number, json: Record<string, unknown> | null): CheckoutStart {
  if (status === 201 || status === 200) {
    const { checkoutId, url, totalPence, currency } = json ?? {};
    if (typeof checkoutId === 'string' && CHECKOUT_ID.test(checkoutId) && isSumUpCheckoutUrl(url)) {
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

/** The billing country to suggest first: the region of the person's language setting (en-GB → GB), if it has one. */
export function suggestedCountry(locales: readonly string[]): string | null {
  for (const locale of locales) {
    try {
      const region = new Intl.Locale(locale).maximize().region;
      if (region && /^[A-Z]{2}$/.test(region) && COUNTRY_CODES.includes(region)) return region;
    } catch { /* not a valid locale */ }
  }
  return null;
}

/** "£49.00" style price, or null when the server did not say. */
export function priceText(totalPence: number | null, currency: string | null, locale?: string): string | null {
  if (totalPence === null || currency === null) return null;
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(totalPence / 100); } catch { return null; }
}

/** ISO 3166-1 alpha-2 countries offered as a billing country. Names come from Intl.DisplayNames in the person's language. */
export const COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT ' +
  'JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL ' +
  'NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
  'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');
