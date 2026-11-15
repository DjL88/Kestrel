#!/usr/bin/env node
// Issue a Kestrel licence key. Run by the owner (or a payment-webhook function) with the PRIVATE key, which is never in the repo.
//   node tools/licence/issue.mjs [--key ~/.kestrel-signing/licence.key.pem]
// Prints one key. It holds no personal data: only the plan, a random id and the date.
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const flag = process.argv.indexOf('--key');
const path = flag > 0 ? process.argv[flag + 1] : `${homedir()}/.kestrel-signing/licence.key.pem`;
const privateKey = createPrivateKey(readFileSync(path));
const b64url = (buffer) => Buffer.from(buffer).toString('base64url');
const body = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id: randomBytes(9).toString('base64url'), issuedAt: Date.now() }));
console.log(`KESTREL1.${b64url(body)}.${b64url(sign(null, body, privateKey))}`);
