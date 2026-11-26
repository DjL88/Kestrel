import test from 'node:test';
import assert from 'node:assert/strict';
import { toPence, parseCsv, readGcpBilling, summariseIncome, accountsSummary, monthName, VAT_HELP } from '../../site/assets/admin-accounts.mjs';

test('amounts become whole pence without floating-point drift', () => {
  assert.equal(toPence('£1,234.56'), 123456);
  assert.equal(toPence('-0.12'), -12);
  assert.equal(toPence('(3.40)'), -340);
  assert.equal(toPence('GBP 12'), 1200);
  assert.equal(toPence('0.1'), 10);
  assert.equal(toPence('1.005'), 101);
  assert.equal(toPence('1.004'), 100);
  assert.equal(toPence('£-2.50'), -250);
  assert.equal(toPence('0.07'), 7);
  for (const bad of ['', '-', 'n/a', '1.2.3', '12abc', null, undefined]) assert.equal(toPence(bad), null, String(bad));
  // 0.1 + 0.2 summed as pence stays exact.
  assert.equal(toPence('0.10') + toPence('0.20'), 30);
});

test('CSV reader copes with quotes, commas inside quotes, CRLF and a byte-order mark', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCsv('a,b'), [['a', 'b']]);
});

const REPORTS_CSV = [
  'Billing account name,Billing account ID',
  'My billing account,0123-4567',
  '',
  '"Service description","Service ID","SKU description","Cost type","Cost (£)","Discounts (£)","Promotions (£)","Subtotal (£)"',
  '"Cloud Run","152E","CPU Allocation Time","Usage","1.20","-0.20","0.00","1.00"',
  '"Cloud Run","152E","Memory Allocation Time","Usage","0.50","0.00","0.00","0.50"',
  '"Cloud Storage","95FF","Standard Storage London","Usage","£1,002.34","0.00","-2.00","1,000.34"',
  '"Firestore","EE2C","Read Ops","Usage","0.004","0.00","0.00","0.004"',
  '"Total","","","","1003.044","-0.20","-2.00","1001.844"',
].join('\n');

test('Google Cloud Reports CSV: subtotal per service, total row skipped, pounds detected', () => {
  const b = readGcpBilling(REPORTS_CSV);
  assert.equal(b.ok, true);
  assert.equal(b.currency, 'GBP');
  assert.deepEqual(b.services, [{ name: 'Cloud Storage', pence: 100034 }, { name: 'Cloud Run', pence: 150 }, { name: 'Firestore', pence: 0 }]);
  assert.equal(b.totalPence, 100184);
  assert.equal(b.rowsRead, 4);
  assert.equal(b.rowsSkipped, 1, 'the Total row is not counted twice');
});

test('Billing export rows: cost plus credits, invoice month read, currencies never mixed', () => {
  const csv = 'service.description,cost,credits,currency,invoice.month\nCloud Run,2.50,-0.50,GBP,202611\nGemini API,1.25,,GBP,202611\n';
  const b = readGcpBilling(csv);
  assert.equal(b.ok, true);
  assert.equal(b.totalPence, 325);
  assert.deepEqual(b.months, ['2026-11']);
  const mixed = readGcpBilling('service,cost,currency\nCloud Run,1,GBP\nCloud Run,1,USD\n');
  assert.equal(mixed.ok, false);
  assert.match(mixed.problem, /mixes currencies/);
  assert.equal(readGcpBilling('name,amount\nx,1\n').ok, false);
  assert.equal(readGcpBilling('service,cost\n').ok, false);
});

const paid = (net, fee, extra = {}) => ({ status: 'paid', currency: 'GBP', netPence: net, storeFeeMinor: fee, buyer: { currency: 'EUR', totalMinor: 3451, taxMinor: 551 }, ...extra });

test('income adds Paddle earnings in pounds only, skips refunds, flags partial refunds and other currencies', () => {
  const income = summariseIncome([
    paid(2478, 195),
    paid(2478, 195, { buyer: { currency: 'GBP', totalMinor: 3480, taxMinor: 580 } }),
    paid(2478, 195, { status: 'refunded' }),
    paid(2478, 195, { status: 'partially-refunded' }),
    paid(2000, 100, { currency: 'USD' }),
    { status: 'paid', currency: 'GBP', netPence: 2900, storeFeeMinor: null, buyer: null },
  ]);
  assert.equal(income.sales, 4);
  assert.equal(income.earningsPence, 2478 * 3 + 2900);
  assert.equal(income.paddleFeePence, 195 * 3);
  assert.deepEqual(income.buyerPaid, { EUR: 3451 * 2, GBP: 3480 });
  assert.deepEqual(income.buyerTax, { EUR: 551 * 2, GBP: 580 });
  assert.equal(income.refunded, 1);
  assert.equal(income.partlyRefunded, 1);
  assert.equal(income.otherCurrency, 1);
  assert.equal(summariseIncome([]).earningsPence, 0);
});

test('profit uses the billing file for the same month in pounds, otherwise the cost model', () => {
  const income = { earningsPence: 10_000 };
  const billing = { ok: true, currency: 'GBP', months: ['2026-11'], totalPence: 2_345 };
  assert.deepEqual(accountsSummary({ income, costModelPence: 340, billing, month: '2026-11' }),
    { incomePence: 10_000, costPence: 2_345, costBasis: 'billing', profitPence: 7_655, billingNote: null });
  const modelled = accountsSummary({ income, costModelPence: 340, billing: null, month: '2026-11' });
  assert.equal(modelled.costBasis, 'cost-model');
  assert.equal(modelled.profitPence, 9_660);
  const wrongMonth = accountsSummary({ income, costModelPence: 340, billing: { ...billing, months: ['2026-10'] }, month: '2026-11' });
  assert.equal(wrongMonth.costBasis, 'cost-model');
  assert.match(wrongMonth.billingNote, /2026-10/);
  const dollars = accountsSummary({ income, costModelPence: 340, billing: { ...billing, currency: 'USD' }, month: '2026-11' });
  assert.equal(dollars.costBasis, 'cost-model');
  assert.match(dollars.billingNote, /USD/);
  const undated = accountsSummary({ income, costModelPence: null, billing: { ...billing, months: [] }, month: '2026-11' });
  assert.equal(undated.costBasis, 'billing', 'a Reports table has no month column; the owner picks the range');
  const nothing = accountsSummary({ income: { earningsPence: 0 }, costModelPence: null, billing: null, month: '2026-11' });
  assert.deepEqual([nothing.costBasis, nothing.profitPence], ['none', 0]);
  const loss = accountsSummary({ income: { earningsPence: 100 }, costModelPence: 340, billing: null, month: '2026-11' });
  assert.equal(loss.profitPence, -240);
});

test('month names and VAT help say Paddle handles EU and UK VAT as merchant of record', () => {
  assert.equal(monthName('2026-11'), 'November 2026');
  const help = VAT_HELP.join(' ');
  assert.match(help, /merchant of record/);
  assert.match(help, /UK VAT and VAT in every EU country/);
  assert.match(help, /not tax advice/);
});
