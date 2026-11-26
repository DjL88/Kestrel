// Accounts sums for the admin console. Pure functions only: no network, no storage. Everything is whole pence so
// nothing drifts through floating-point rounding. A Google Cloud billing CSV is read in the browser and never uploaded.

/** "£1,234.56", "-0.12", "(3.40)", "GBP 12" → whole pence, or null when the text is not a plain amount. */
export function toPence(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text * 100) : null;
  if (typeof text !== 'string') return null;
  let s = text.trim().replace(/[£$€\s,]|GBP|USD|EUR/gi, '');
  if (s === '' || s === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  // Round half up on the third decimal place (Google reports to more places than pence).
  const pence = Number(whole) * 100 + Number((fraction + '00').slice(0, 2)) + (Number(fraction[2] ?? '0') >= 5 ? 1 : 0);
  return negative ? -pence : pence;
}

/** Small RFC 4180 reader: quoted fields, doubled quotes, CRLF, a leading byte-order mark. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

const CURRENCY_SIGNS = { '£': 'GBP', '$': 'USD', '€': 'EUR' };
const norm = h => h.trim().toLowerCase().replace(/\s*\(.*\)\s*$/, '').replace(/[_\s]+/g, ' ');
const headerCurrency = h => {
  const m = /\(([^)]*)\)\s*$/.exec(h);
  if (!m) return null;
  const v = m[1].trim();
  return CURRENCY_SIGNS[v] ?? (/^[A-Z]{3}$/i.test(v) ? v.toUpperCase() : null);
};
const monthOf = v => {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-?(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); // 01/11/2026 style dates in a UK console export
  return m ? m[3] + '-' + m[2].padStart(2, '0') : null;
};

/**
 * Reads a Google Cloud billing CSV: the Billing → Reports "Download CSV" table, or rows from the standard billing export
 * (service.description, cost, credits, currency, invoice.month). Uses the Subtotal column when there is one (cost after
 * discounts and promotions), otherwise cost plus every credit, discount and promotion column. Total rows are skipped so
 * nothing is counted twice. Different currencies are never added together.
 */
export function readGcpBilling(text) {
  const rows = parseCsv(text);
  const fail = problem => ({ ok: false, problem, totalPence: 0, services: [], currency: null, months: [], rowsRead: 0, rowsSkipped: 0 });
  const headerIndex = rows.findIndex(r => r.some(h => /^(subtotal|cost)$/.test(norm(h))));
  if (headerIndex < 0) return fail('No Cost or Subtotal column was found. Download the table from Billing → Reports as CSV, or a billing export.');
  const header = rows[headerIndex];
  const names = header.map(norm);
  const find = test => names.findIndex(test);
  const service = find(n => n === 'service description' || n === 'service' || n === 'service.description');
  const subtotal = find(n => n === 'subtotal');
  const cost = find(n => n === 'cost');
  const credits = names.map((n, i) => (/(discount|promotion|credit|saving)s?$/.test(n) && !/(type|id|name)$/.test(n) ? i : -1)).filter(i => i >= 0);
  const currencyColumn = find(n => n === 'currency');
  const monthColumn = find(n => n === 'invoice month' || n === 'invoice.month' || n === 'month' || n === 'usage start date' || n === 'usage start time');
  const amountColumns = subtotal >= 0 ? [subtotal] : [cost, ...credits];
  const declared = [...new Set(amountColumns.map(i => headerCurrency(header[i])).filter(Boolean))];
  if (declared.length > 1) return fail('The amount columns are in different currencies.');

  const byService = new Map();
  const currencies = new Set(declared);
  const months = new Set();
  let total = 0, rowsRead = 0, rowsSkipped = 0;
  for (const r of rows.slice(headerIndex + 1)) {
    const first = (r[0] ?? '').trim();
    if (/^(total|grand total|subtotal)\b/i.test(first) || (service >= 0 && /^total\b/i.test((r[service] ?? '').trim()))) { rowsSkipped++; continue; }
    const amounts = amountColumns.map(i => (r[i] ?? '').trim() === '' ? 0 : toPence(r[i]));
    if (amounts.some(a => a === null)) { rowsSkipped++; continue; }
    if (currencyColumn >= 0 && r[currencyColumn]?.trim()) currencies.add(r[currencyColumn].trim().toUpperCase());
    if (monthColumn >= 0) { const m = monthOf(r[monthColumn]); if (m) months.add(m); }
    const pence = amounts.reduce((a, b) => a + b, 0);
    const name = (service >= 0 ? r[service] : '')?.trim() || 'Other';
    byService.set(name, (byService.get(name) ?? 0) + pence);
    total += pence;
    rowsRead++;
  }
  if (currencies.size > 1) return fail('The file mixes currencies (' + [...currencies].join(', ') + '). Export it in one currency.');
  if (rowsRead === 0) return fail('The file has no cost rows.');
  const services = [...byService].map(([name, pence]) => ({ name, pence })).sort((a, b) => b.pence - a.pence || a.name.localeCompare(b.name));
  return { ok: true, problem: null, totalPence: total, services, currency: [...currencies][0] ?? null, months: [...months].sort(), rowsRead, rowsSkipped };
}

/**
 * Income for one month from the Paddle payout figures the control plane recorded for each completed transaction.
 * `netPence` is what InFlight keeps (Paddle's earnings, after Paddle's fee and the buyer's tax). Only payouts in GBP are
 * added up; any other payout currency is counted and shown, never converted. Refunded sales count as nothing; a partial
 * refund has no recorded amount yet, so it is counted and flagged rather than guessed.
 */
export function summariseIncome(transactions) {
  const out = { sales: 0, earningsPence: 0, paddleFeePence: 0, buyerPaid: {}, buyerTax: {}, refunded: 0, partlyRefunded: 0, otherCurrency: 0 };
  for (const t of transactions ?? []) {
    if (t.status === 'refunded') { out.refunded++; continue; }
    if (t.currency !== 'GBP') { out.otherCurrency++; continue; }
    if (t.status === 'partially-refunded') out.partlyRefunded++;
    out.sales++;
    out.earningsPence += t.netPence ?? 0;
    out.paddleFeePence += t.storeFeeMinor ?? 0;
    if (t.buyer?.currency) {
      out.buyerPaid[t.buyer.currency] = (out.buyerPaid[t.buyer.currency] ?? 0) + (t.buyer.totalMinor ?? 0);
      out.buyerTax[t.buyer.currency] = (out.buyerTax[t.buyer.currency] ?? 0) + (t.buyer.taxMinor ?? 0);
    }
  }
  return out;
}

/**
 * Profit = income − costs. Costs come from the Google Cloud billing CSV when one for this month in GBP is loaded
 * (Google's own figures), otherwise from InFlight's cost model (an estimate). Both are always shown; only one is used.
 */
export function accountsSummary({ income, costModelPence, billing, month }) {
  const billingUsable = !!billing?.ok && (billing.currency === null || billing.currency === 'GBP')
    && (billing.months.length === 0 || (billing.months.length === 1 && billing.months[0] === month));
  const costBasis = billingUsable ? 'billing' : Number.isFinite(costModelPence) ? 'cost-model' : 'none';
  const costPence = costBasis === 'billing' ? billing.totalPence : costBasis === 'cost-model' ? costModelPence : 0;
  const incomePence = income?.earningsPence ?? 0;
  let billingNote = null;
  if (billing?.ok && !billingUsable) {
    billingNote = billing.currency && billing.currency !== 'GBP'
      ? 'The billing file is in ' + billing.currency + ', so it is not used. Export it in pounds.'
      : 'The billing file covers ' + billing.months.join(', ') + ', not ' + month + ', so it is not used.';
  }
  return { incomePence, costPence, costBasis, profitPence: incomePence - costPence, billingNote };
}

/** A month like "2026-11" → "November 2026". */
export function monthName(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export const VAT_HELP = Object.freeze([
  'Paddle is the merchant of record for every sale through the website and the desktop app. Legally, Paddle sells InFlight Pro to the buyer, then pays InFlight. Paddle works out, charges, reports and pays VAT and sales tax to the tax authorities on those sales, including UK VAT and VAT in every EU country. You do not register for EU VAT or file EU One Stop Shop (OSS) returns for Paddle sales.',
  'The buyer\'s tax shown on this page is money Paddle collected and passes to the tax authorities. It is not InFlight\'s income and you do not pay it again.',
  'InFlight\'s own sale is to Paddle (Paddle.com Market Ltd, a UK company), for the amount Paddle pays out. If you are VAT registered in the UK, ask your accountant how to treat those payouts on your VAT return. If you are not registered, the Tax section tracks UK turnover against the £90,000 registration threshold.',
  'Google Cloud bills you in pounds. If you are VAT registered, the VAT on that bill may be reclaimable as input tax; keep Google\'s invoices.',
  'Apple and Google Play will also act as merchant of record for phone app sales once those are built. They are not included here yet.',
  'This page is guidance, not tax advice. Your accountant or HMRC has the final word, and Paddle\'s own reports and invoices are the record for tax.',
]);
