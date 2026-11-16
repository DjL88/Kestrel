import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { awsEncode, sha256Hex, signV4 } from './sigv4.ts';

const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';

test('the published AWS "get-vanilla" test vector gives the published signature', async () => {
  const headers = await signV4({
    method: 'GET', url: new URL('https://example.amazonaws.com/'), region: 'us-east-1', service: 'service',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET, payloadHash: await sha256Hex(''), now: new Date('2015-08-30T12:36:00Z'), sendContentHash: false,
  });
  assert.equal(headers.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});

test('S3 requests match signatures from an independent implementation written from the AWS rules', async () => {
  // /private/tmp/... is only there on the machine that generated it; the values are also fixed below so CI is covered.
  const known: { method: string; url: string; region: string; body: string; headers: Record<string, string>; signature: string }[] = [
    { method: 'PUT', url: 'https://s3.eu-west-2.amazonaws.com/my-photos/kestrel/v1/recipes/kite day/project.json', region: 'eu-west-2', body: '{"a":1}', headers: { 'content-type': 'application/json' }, signature: '8523808de053c4a2' },
    { method: 'GET', url: 'https://play.min.io:9000/bucket?list-type=2&prefix=kestrel/v1/recipes/&max-keys=1000', region: 'us-east-1', body: '', headers: {}, signature: '17f669561f3d8960' },
    { method: 'DELETE', url: 'https://bucket.s3.amazonaws.com/kestrel/v1/x y&z=1.json', region: 'us-east-1', body: '', headers: {}, signature: 'ac7735e3e2afc1e2' },
  ];
  for (const item of known) {
    const out = await signV4({ method: item.method, url: new URL(item.url), region: item.region, service: 's3', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET, payloadHash: await sha256Hex(item.body), now: new Date('2026-11-16T12:00:00Z'), headers: item.headers });
    assert.match(out.Authorization, new RegExp(`Signature=${item.signature}`), `${item.method} ${item.url}`);
    assert.equal(out['x-amz-content-sha256'], await sha256Hex(item.body));
  }
});

test('the secret key is never part of what is sent', async () => {
  const out = await signV4({ method: 'GET', url: new URL('https://s3.amazonaws.com/b/k'), region: 'us-east-1', service: 's3', accessKeyId: 'AK', secretAccessKey: SECRET, payloadHash: await sha256Hex(''), now: new Date() });
  assert.equal(JSON.stringify(out).includes(SECRET), false);
});

test('encoding follows the signing rules, keeping slashes only in a path', () => {
  assert.equal(awsEncode('a b/c&d~e.f-g_h'), 'a%20b%2Fc%26d~e.f-g_h');
  assert.equal(awsEncode('a b/c', true), 'a%20b/c');
  assert.equal(awsEncode('é'), '%C3%A9');
});

test('the reference file, when present on the machine that made it, agrees too', async () => {
  let reference: { method: string; host: string; path: string; query: [string, string][]; headers: Record<string, string>; payload: string; region: string; signature: string }[];
  try { reference = JSON.parse(readFileSync('/private/tmp/claude-501/sigv4-reference.json', 'utf8')); } catch { return; }
  for (const item of reference) {
    const url = new URL(`https://${item.host}${item.path}`);
    for (const [key, value] of item.query) url.searchParams.append(key, value);
    const out = await signV4({ method: item.method, url, region: item.region, service: 's3', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: SECRET, payloadHash: await sha256Hex(item.payload), now: new Date('2026-11-16T12:00:00Z'), headers: item.headers });
    assert.match(out.Authorization, new RegExp(`Signature=${item.signature}`));
  }
});
