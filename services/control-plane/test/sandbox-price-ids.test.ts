import test from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_SANDBOX_PRICE_IDS, assertNoSandboxPricesInProduction } from '../src/commerce/sandboxPriceIds.ts';

test('a sandbox Paddle price can never be configured in production', () => {
  const [monthly, yearly] = KNOWN_SANDBOX_PRICE_IDS;
  assert.throws(() => assertNoSandboxPricesInProduction('production', { plus: monthly }), /plus is a sandbox Paddle price/);
  assert.throws(() => assertNoSandboxPricesInProduction('production', { monthly: 'pri_live00000000000000000000', plusAnnual: yearly }), /plusAnnual/);
  assert.doesNotThrow(() => assertNoSandboxPricesInProduction('sandbox', { plus: monthly, plusAnnual: yearly }));
  assert.doesNotThrow(() => assertNoSandboxPricesInProduction('production', { plus: 'pri_01live0000000000000000000', plusAnnual: undefined }));
});
