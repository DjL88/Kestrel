import { z } from 'zod';
import { openFirestore } from '../openStore.ts';
import { DEFAULT_PRICING } from '../../../../src/core/pricingMatrix.ts';

export const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const ONS = 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bt/mm23/data';
const date = /^\d{4}-\d{2}-\d{2}$/;
const settingsSchema = z.object({
  gbpProBasePence: z.number().int().positive().max(100_000),
  effectiveDate: z.string().regex(date),
  currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1).max(32),
});
const onsSchema = z.object({
  months: z.array(z.object({
    date: z.string(),
    value: z.coerce.number().positive(),
  })),
});

async function get(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Could not load public price data: ' + url);
  return response;
}

export function readEcbRates(xml: string) {
  const rateDate = xml.match(/\btime=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const rates = new Map<string, number>([['EUR', 1]]);
  for (const match of xml.matchAll(/\bcurrency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
    const value = Number(match[2]);
    if (Number.isFinite(value) && value > 0) rates.set(match[1], value);
  }
  if (!rateDate || !rates.has('GBP')) throw new Error('ECB response did not contain a GBP reference rate.');
  return { rateDate, rates };
}

/** Today's ECB reference rates as units of each currency per £1 (for the pricing matrix in Admin → Prices). */
export async function fetchEcbRatesPerGbp(request: typeof fetch = fetch) {
  const response = await request(ECB, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('The ECB reference rates could not be loaded.');
  const { rateDate, rates } = readEcbRates(await response.text());
  const gbp = rates.get('GBP')!;
  const perGbp: Record<string, number> = {};
  for (const [currency, rate] of rates) if (currency !== 'GBP') perGbp[currency] = Math.round(rate / gbp * 1e6) / 1e6;
  return { date: rateDate, perGbp };
}

const utcMonth = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', timeZone: 'UTC' });
function onsMonth(isoDate: string) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const parts = utcMonth.formatToParts(d);
  return parts.find(part => part.type === 'year')?.value + ' ' + parts.find(part => part.type === 'month')?.value.toUpperCase();
}

export function proposePrices(
  now: Date,
  approved: unknown,
  fxXml: string,
  cpi?: unknown,
  /** The live UK subscription prices in pence (the price list, Admin → Money → Prices). */
  bases?: { monthly: number; annual: number },
) {
  const settings = settingsSchema.parse(approved);
  const month = reviewMonth(now);
  const effective = Date.parse(settings.effectiveDate);
  const asOfDate = now.toISOString().slice(0, 10);
  if (!Number.isFinite(effective) || new Date(effective).toISOString().slice(0, 10) !== settings.effectiveDate ||
    settings.effectiveDate > asOfDate) throw new Error('The approved base price needs a valid effective date.');

  const { rateDate, rates } = readEcbRates(fxXml);
  const rateTime = Date.parse(rateDate);
  if (!Number.isFinite(rateTime) || new Date(rateTime).toISOString().slice(0, 10) !== rateDate ||
    now.getTime() - rateTime > 7 * 86_400_000 || rateDate > asOfDate) {
    throw new Error('ECB FX reference rates are outside the review window.');
  }

  let inflation = null;
  if (month.endsWith('-04')) {
    const { months } = onsSchema.parse(cpi);
    const baseline = months.find(row => row.date === onsMonth(settings.effectiveDate));
    const monthNames = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
    const eligible = months.flatMap(row => {
      const match = /^(\d{4}) ([A-Z]{3})$/.exec(row.date);
      const index = match ? monthNames.indexOf(match[2]) : -1;
      if (!match || index < 0) return [];
      const date = match[1] + '-' + String(index + 1).padStart(2, '0');
      return date <= month ? [{ row, date }] : [];
    }).sort((a, b) => a.date.localeCompare(b.date));
    const latest = eligible.at(-1)?.row;
    if (!baseline || !latest) throw new Error('The ONS CPI series does not cover the approved GBP price month.');
    const multiplier = latest.value / baseline.value;
    const proposedPence = Math.max(100, Math.round(settings.gbpProBasePence * multiplier / 100) * 100);
    if (!Number.isSafeInteger(proposedPence)) throw new Error('The proposed GBP price is outside the supported range.');
    inflation = { cumulativeInflation: multiplier - 1, proposedPence, baseline, latest, source: ONS };
  }

  const proposedGbpPence = inflation?.proposedPence ?? settings.gbpProBasePence;
  const prices = [...new Set(['GBP', ...settings.currencies])].map(currency => {
    const ratePerGbp = currency === 'GBP' ? 1 : (rates.get(currency) ?? 0) / rates.get('GBP')!;
    if (ratePerGbp <= 0 || !Number.isFinite(ratePerGbp)) return { currency, status: 'missing-rate' as const };
    const unroundedMajor = proposedGbpPence / 100 * ratePerGbp;
    if (!Number.isFinite(unroundedMajor)) return { currency, status: 'missing-rate' as const };
    const step = unroundedMajor >= 40 ? 5 : 1;
    const proposedMajor = currency === 'GBP' ? unroundedMajor : Math.max(step, Math.round(unroundedMajor / step) * step);
    return { currency, ratePerGbp, unroundedMajor, proposedMajor, status: 'for-review' as const };
  });
  // Pro is a subscription (26 Nov 2026): when the live price list's monthly and yearly UK prices are given, each is
  // reviewed on its own. `gbpProBasePence` (the retired one-off price) then only fills the older top-level fields.
  const multiplier = inflation ? 1 + inflation.cumulativeInflation : 1;
  const plans = bases ? Object.fromEntries((['monthly', 'annual'] as const).map(plan => {
    const basePence = bases[plan];
    const planGbpPence = Math.max(1, Math.round(basePence * multiplier));
    return [plan, { basePence, proposedGbpPence: planGbpPence, prices: [...new Set(['GBP', ...settings.currencies])].map(currency => {
      const ratePerGbp = currency === 'GBP' ? 1 : (rates.get(currency) ?? 0) / rates.get('GBP')!;
      if (ratePerGbp <= 0 || !Number.isFinite(ratePerGbp)) return { currency, status: 'missing-rate' as const };
      const unroundedMajor = planGbpPence / 100 * ratePerGbp;
      if (!Number.isFinite(unroundedMajor)) return { currency, status: 'missing-rate' as const };
      const step = unroundedMajor >= 40 ? 5 : unroundedMajor >= 10 ? 1 : 0.1;
      const proposedMajor = currency === 'GBP' ? unroundedMajor : Math.max(step, Math.round(Math.round(unroundedMajor / step) * step * 100) / 100);
      return { currency, ratePerGbp, unroundedMajor, proposedMajor, status: 'for-review' as const };
    }) }];
  })) as Record<'monthly' | 'annual', { basePence: number; proposedGbpPence: number; prices: typeof prices }> : null;
  return {
    month, status: 'pending-approval' as const, approvedBasePence: settings.gbpProBasePence,
    approvedBaseEffectiveDate: settings.effectiveDate, proposedGbpPence, prices, ...(plans ? { plans } : {}),
    rateDate, rateSource: ECB, inflation, createdAt: now.toISOString(),
  };
}

const reviewMonth = (now: Date) => new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', timeZone: 'Europe/London',
}).format(now);

export async function runPriceReview(now = new Date()) {
  const db = await openFirestore({
    firestoreProjectId: process.env.KCP_FIRESTORE_PROJECT,
    firestoreDatabaseId: process.env.KCP_FIRESTORE_DATABASE,
  });
  try {
    const month = reviewMonth(now);
    const document = db.collection('pricing_reviews').doc(month);
    if ((await document.get()).exists) return;
    const snapshot = await db.collection('pricing_settings').doc('current').get();
    const settings = settingsSchema.parse(snapshot.data());
    const fx = await (await get(ECB)).text();
    const cpi = month.endsWith('-04') ? await (await get(ONS)).json() : undefined;
    const matrix = (await db.collection('pricing_settings').doc('matrix').get()).data() as { base?: Record<string, unknown> } | undefined;
    const base = (item: 'pro.monthly' | 'pro.annual') => {
      const pence = matrix?.base?.[item];
      return typeof pence === 'number' && Number.isSafeInteger(pence) && pence > 0 ? pence : DEFAULT_PRICING.base[item];
    };
    const proposal = proposePrices(now, settings, fx, cpi, { monthly: base('pro.monthly'), annual: base('pro.annual') });
    await db.runTransaction(async transaction => {
      if ((await transaction.get(document)).exists) return;
      transaction.create(document, proposal);
    });
    console.log('Pricing review saved for', month);
  } finally {
    await db.terminate();
  }
}
