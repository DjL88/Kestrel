import assert from 'node:assert/strict';
import test from 'node:test';
import { readEcbRates } from '../src/commerce/priceReview.ts';
import { roundLocalProBase } from '../src/commerce/localPrice.ts';

test('the ECB review reads dated reference rates and converts EUR cross-rates to GBP', () => {
  const { rateDate, rates } = readEcbRates(
    "<Cube><Cube time='2026-11-20'><Cube currency='GBP' rate='0.8'/><Cube currency='AUD' rate='1.6'/></Cube></Cube>",
  );
  assert.equal(rateDate, '2026-11-20');
  assert.equal(rates.get('EUR'), 1);
  const gbpToAud = rates.get('AUD')! / rates.get('GBP')!;
  assert.equal(roundLocalProBase(32 * gbpToAud, 1), 65);
  assert.throws(() => readEcbRates("<Cube time='2026-11-20'/>"), /GBP reference rate/);
});
