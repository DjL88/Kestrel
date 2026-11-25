import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudRunClientIp, networkCountryFrom } from '../src/networkCountry.ts';

test('only the address Cloud Run appended counts; client-written entries are ignored', () => {
  assert.equal(cloudRunClientIp({ 'x-forwarded-for': '81.2.69.142' }), '81.2.69.142');
  assert.equal(cloudRunClientIp({ 'x-forwarded-for': '1.1.1.1, 81.2.69.142' }), '81.2.69.142');
  assert.equal(cloudRunClientIp({ 'x-forwarded-for': '2a00:1450::1' }), '2a00:1450::1');
  assert.equal(cloudRunClientIp({ 'x-forwarded-for': 'not-an-ip' }), null);
  assert.equal(cloudRunClientIp({}), null);
});

test('unknown or malformed countries are null, never a guess', () => {
  const lookup = (ip: string) => ({ '81.2.69.142': 'GB', '10.0.0.1': 'ZZZ' } as Record<string, string>)[ip] ?? null;
  const country = networkCountryFrom(lookup);
  assert.equal(country({ headers: { 'x-forwarded-for': '81.2.69.142' } }), 'GB');
  assert.equal(country({ headers: { 'x-forwarded-for': '10.0.0.1' } }), null);
  assert.equal(country({ headers: { 'x-forwarded-for': '8.8.4.4' } }), null);
  assert.equal(country({ headers: {} }), null);
});
