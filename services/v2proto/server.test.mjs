import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createHmac } from 'node:crypto';

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});

test('anonymous visitors see login, never the private V2 app or assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'v2proto-'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'v2-proto.html'), 'PRIVATE BUILD CONTENT');
  await writeFile(join(directory, 'assets', 'app.js'), 'PRIVATE SCRIPT CONTENT');
  const port = await freePort();
  const child = spawn(process.execPath, ['services/v2proto/server.mjs'], {
    env: { ...process.env, PORT: String(port), V2PROTO_STATIC_ROOT: directory,
      V2PROTO_OWNER_EMAILS: 'owner@example.test', V2PROTO_GOOGLE_CLIENT_ID: 'test-client-id',
      V2PROTO_COOKIE_SECRET: 'a'.repeat(64) },
    stdio: 'ignore',
  });
  try {
    let response;
    for (let i = 0; i < 40; i++) {
      try { response = await fetch('http://127.0.0.1:' + port + '/V2Proto/'); break; }
      catch { await new Promise(r => setTimeout(r, 50)); }
    }
    assert.ok(response, 'server started');
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /Sign in with your approved Google owner account/);
    assert.doesNotMatch(page, /PRIVATE BUILD CONTENT/);
    const asset = await fetch('http://127.0.0.1:' + port + '/V2Proto/assets/app.js');
    assert.equal(asset.status, 401);
    assert.doesNotMatch(await asset.text(), /PRIVATE SCRIPT CONTENT/);
    const wrongOrigin = await fetch('http://127.0.0.1:' + port + '/V2Proto/session', {
      method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'forged' }),
    });
    assert.equal(wrongOrigin.status, 403);
    // Firebase Hosting forwards __session but strips other Cookie names.
    // Use a known test-only HMAC to exercise the authenticated request path
    // without mocking Google token signature verification.
    const sessionData = Buffer.from(JSON.stringify({
      email: 'owner@example.test', expires: Date.now() + 60000, nonce: 'test-only',
    })).toString('base64url');
    const mac = createHmac('sha256', 'a'.repeat(64)).update(sessionData).digest('base64url');
    const sessionCookie = '__session=' + sessionData + '.' + mac;
    const authenticated = await fetch('http://127.0.0.1:' + port + '/V2Proto/assets/app.js', {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(authenticated.status, 200);
    assert.equal(await authenticated.text(), 'PRIVATE SCRIPT CONTENT');

    const withoutSession = await fetch('http://127.0.0.1:' + port + '/V2Proto/assets/app.js', {
      headers: { Cookie: 'unrelated=' + encodeURIComponent(sessionCookie) },
    });
    assert.equal(withoutSession.status, 401);

    const signout = await fetch('http://127.0.0.1:' + port + '/V2Proto/signout', {
      headers: { Cookie: sessionCookie }, redirect: 'manual',
    });
    assert.equal(signout.status, 302);
    assert.match(signout.headers.get('set-cookie') || '', /^__session=;/);
  } finally {
    child.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
