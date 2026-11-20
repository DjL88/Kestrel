import { z } from 'zod';
import { openFirestore } from '../openStore.ts';
import { reviewGbpProPrice, roundLocalProBase } from './localPrice.ts';

const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
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

const utcMonth = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', timeZone: 'UTC' });
function onsMonth(isoDate: string) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const parts = utcMonth.formatToParts(d);
  return parts.find(part => part.type === 'year')?.value + ' ' + parts.find(part => part.type === 'month')?.value.toUpperCase();
}

export async function runPriceReview(now = new Date()) {
  const db = await openFirestore({
    firestoreProjectId: process.env.KCP_FIRESTORE_PROJECT,
    firestoreDatabaseId: process.env.KCP_FIRESTORE_DATABASE,
  });
  try {
    const month = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Europe/London' }).format(now);
    const document = db.collection('pricing_reviews').doc(month);
    if ((await document.get()).exists) return;
    const snapshot = await db.collection('pricing_settings').doc('current').get();
    const settings = settingsSchema.parse(snapshot.data());
    if (!Number.isFinite(Date.parse(settings.effectiveDate)) || settings.effectiveDate > now.toISOString().slice(0, 10)) {
      throw new Error('The approved base price needs a valid effective date.');
    }
    const { rateDate, rates } = readEcbRates(await (await get(ECB)).text());
    if (now.getTime() - Date.parse(rateDate) > 7 * 86_400_000 || rateDate > now.toISOString().slice(0, 10)) {
      throw new Error('ECB FX reference rates are outside the review window.');
    }
    let inflation = null;
    if (month.endsWith('-04')) {
      const { months } = onsSchema.parse(await (await get(ONS)).json());
      const baseline = months.find(row => row.date === onsMonth(settings.effectiveDate));
      const latest = months.at(-1);
      if (!baseline || !latest) throw new Error('The ONS CPI series does not cover the approved GBP price month.');
      inflation = { ...reviewGbpProPrice(settings.gbpProBasePence, baseline.value, latest.value), baseline, latest, source: ONS };
    }
    const proposedGbpPence = inflation?.proposedPence ?? settings.gbpProBasePence;
    const prices = [...new Set(['GBP', ...settings.currencies])].map(currency => {
      const ratePerGbp = currency === 'GBP' ? 1 : (rates.get(currency) ?? 0) / rates.get('GBP')!;
      if (ratePerGbp <= 0) return { currency, status: 'missing-rate' };
      const quoted = proposedGbpPence / 100 * ratePerGbp;
      const proposal = currency === 'GBP' ? quoted : roundLocalProBase(quoted, 1);
      return { currency, ratePerGbp, unroundedMajor: quoted, proposedMajor: proposal, status: 'for-review' };
    });
    await db.runTransaction(async transaction => {
      if ((await transaction.get(document)).exists) return;
      transaction.create(document, {
        month, status: 'pending-approval', approvedBasePence: settings.gbpProBasePence,
        approvedBaseEffectiveDate: settings.effectiveDate, proposedGbpPence, prices,
        rateDate, rateSource: ECB, inflation, createdAt: now.toISOString(),
      });
    });
    console.log('Pricing review saved for', month);
  } finally {
    await db.terminate();
  }
}
