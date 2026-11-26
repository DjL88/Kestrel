/**
 * The control plane for the client-sharing UAT (tests/uat-client-share.spec.ts, board x-uat-share): the real app with
 * its collaboration and gallery stores and mailer, on Firestore (the emulator when FIRESTORE_EMULATOR_HOST is set, the
 * in-memory fake otherwise). Only the outside world is fake: Firebase sign-in (a test signing key), the preview bucket
 * (a local HTTP store that checks size and fingerprint like a signed URL) and SMTP (a transport that keeps each message).
 */
import crypto from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { CollabStore } from '../src/collaboration.ts';
import { GalleryStore } from '../src/gallery.ts';
import { FirestoreStore, type FirestoreLike } from '../src/firestoreStore.ts';
import { FirestoreMailLedger, Mailer } from '../src/mailer.ts';
import { firebaseIssuer } from '../src/oidcIdToken.ts';
import { sha256Hex } from '../src/crypto.ts';
import { newLicence } from '../src/store.ts';
import type { SafeCopyStorage } from '../src/safeCopy.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

const FIREBASE_PROJECT = 'demo-inflight-uat';

const listen = async (server: Server) => { await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; };
const closeServer = (server: Server) => new Promise<void>((r) => server.close(() => r()));

/** The preview bucket: signed URLs are plain local URLs, and an upload must match the size and fingerprint it was signed for. */
async function previewBucket() {
  const objects = new Map<string, Buffer>();
  const signed = new Map<string, { bytes: number; sha256: string }>();
  let origin = '';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const key = decodeURIComponent(url.pathname.slice('/o/'.length));
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'PUT') {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks); const want = signed.get(key);
      if (!want || want.bytes !== body.length || (want.sha256 && sha256Hex(body) !== want.sha256)) { res.writeHead(400).end('signature mismatch'); return; }
      objects.set(key, body); res.writeHead(200).end(); return;
    }
    const body = objects.get(key);
    if (!body) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'image/jpeg' }).end(body);
  });
  origin = await listen(server);
  const storage: SafeCopyStorage = {
    async signUpload(key, bytes, sha256) { signed.set(key, { bytes, sha256 }); return `${origin}/o/${encodeURIComponent(key)}`; },
    async signDownload(key) { return `${origin}/o/${encodeURIComponent(key)}`; },
    async delete(key) { objects.delete(key); },
    async read(key, maxBytes) { const b = objects.get(key); if (!b) return null; if (b.length > maxBytes) throw new Error('too large'); return b; },
    async copy(from, to) { const b = objects.get(from); if (!b) throw new Error('missing'); objects.set(to, b); },
  };
  return { storage, origin, objects, close: () => closeServer(server) };
}

/** Firestore: the emulator when one is running (FIRESTORE_EMULATOR_HOST), else the in-memory fake the unit tests use. */
async function firestore(): Promise<{ db: FirestoreLike; kind: string }> {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const { Firestore } = await import('@google-cloud/firestore') as unknown as { Firestore: new (o: object) => FirestoreLike };
    return { db: new Firestore({ projectId: `${FIREBASE_PROJECT}-${process.pid}-${Date.now()}` }), kind: `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` };
  }
  return { db: new MemoryFirestore() as unknown as FirestoreLike, kind: 'in-memory' };
}


export interface ShareServer {
  /** The control plane's origin. */
  controlPlane: string;
  /** The preview bucket's origin (signed URLs point here). */
  storage: string;
  firestoreKind: string;
  /** Every email the mailer handed to SMTP. */
  sent: { to: string; raw: string }[];
  /** A Firebase ID token for a synthetic, verified account, signed with the key this control plane trusts. */
  idToken(email: string): () => Promise<string>;
  accountIdFor(email: string): Promise<string>;
  /** Gives an account the plan that shares projects. */
  grantSharingPlan(accountId: string): Promise<void>;
  close(): Promise<void>;
}

export async function startShareServer(): Promise<ShareServer> {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'uat', alg: 'RS256' } as JsonWebKey;
  const idToken = (email: string) => async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const at = Math.floor(Date.now() / 1000);
    const head = b64({ alg: 'RS256', kid: 'uat' });
    const body = b64({ iss: firebaseIssuer(FIREBASE_PROJECT), aud: FIREBASE_PROJECT, sub: `fb-${sha256Hex(email).slice(0, 16)}`, email, email_verified: true, iat: at, exp: at + 600 });
    return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), pair.privateKey).toString('base64url')}`;
  };
  const { db, kind } = await firestore();
  const bucket = await previewBucket();
  const sent: ShareServer['sent'] = [];
  const mailer = new Mailer({
    transport: { send: async (_from, to, raw) => { sent.push({ to, raw }); } },
    ledger: new FirestoreMailLedger(db), fromAddress: 'hello@inflight.studio', siteOrigin: 'https://inflight.studio', unsubscribeKey: Buffer.alloc(32, 9),
  });
  const app = createApp({
    config: loadConfig({ KCP_DEV_MODE: '1', KCP_FIREBASE_PROJECT_ID: FIREBASE_PROJECT }),
    store: new FirestoreStore(db), provider: null, firebaseKeys: async () => [jwk],
    collab: new CollabStore(db), gallery: new GalleryStore(db, bucket.storage), mailer,
  });
  const server = createServer((req, res) => { void app.handle(req, res); });
  const controlPlane = await listen(server);
  return {
    controlPlane, storage: bucket.origin, firestoreKind: kind, sent, idToken,
    accountIdFor: async (email) => { const a = await app.store.findAccountByEmailHash(sha256Hex(email)); if (!a) throw new Error(`no account for ${email}`); return a.accountId; },
    grantSharingPlan: async (accountId) => { await app.store.insertLicence(newLicence(`lic-uat-${accountId}`, 'subscriber', Date.now(), { accountId })); },
    close: async () => { await closeServer(server); await bucket.close(); await app.store.close().catch(() => undefined); },
  };
}
