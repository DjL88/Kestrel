/**
 * firestore.rules on the real Firestore emulator: no client SDK can read or write anything, including a team comment
 * on a client's photo, whoever is signed in. The control plane's Admin SDK is unaffected (it bypasses rules).
 *
 * Runs only when KCP_FIRESTORE_EMULATOR_JAR points at the emulator jar (Java 11+), for example
 *   KCP_FIRESTORE_EMULATOR_JAR=~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar \
 *     node --import tsx --test services/control-plane/test/firestore-rules.emulator.test.ts
 * Otherwise it is skipped, so `npm test` needs no Java.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, collection, getDocs, query, where } from 'firebase/firestore';

const JAR = process.env.KCP_FIRESTORE_EMULATOR_JAR;
const PORT = Number(process.env.KCP_FIRESTORE_EMULATOR_PORT ?? 8397);
const PROJECT = 'demo-inflight-rules';
const BASE = `http://127.0.0.1:${PORT}`;
const rules = readFileSync(fileURLToPath(new URL('../../../firestore.rules', import.meta.url)), 'utf8');

async function waitUp(ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(BASE + '/')).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('The Firestore emulator did not start.');
}

/** A client SDK signed in as `uid` (the emulator accepts an unsigned token). */
function clientAs(uid: string, claims: Record<string, unknown> = {}) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo' }, `rules-${uid}-${Math.random()}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', PORT, { mockUserToken: { user_id: uid, sub: uid, ...claims } });
  return { app, db };
}

test('firestore.rules: no client SDK reads or writes anything, including team comments on a client\'s photo', { skip: !JAR && 'set KCP_FIRESTORE_EMULATOR_JAR to run on the emulator' }, async () => {
  const emulator: ChildProcess = spawn('java', ['-jar', JAR!, '--host', '127.0.0.1', '--port', String(PORT)], { stdio: 'ignore' });
  try {
    await waitUp(60_000);
    const loaded = await fetch(`${BASE}/emulator/v1/projects/${PROJECT}:securityRules`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }),
    });
    assert.equal(loaded.status, 200, await loaded.text());

    // Seed as the server would (the "owner" token bypasses rules, like the Admin SDK).
    const seeded = await fetch(`${BASE}/v1/projects/${PROJECT}/databases/(default)/documents/collab_comments?documentId=proj1%7Cteam1`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
      body: JSON.stringify({ fields: { projectId: { stringValue: 'proj1' }, photoId: { stringValue: 'p1' }, authorAccountId: { stringValue: 'editor1' }, text: { stringValue: 'Team only' } } }),
    });
    assert.equal(seeded.status, 200, await seeded.text());

    for (const [uid, claims] of [['client1', { r: 'client', p: 'proj1' }], ['editor1', {}], ['anyone', {}]] as const) {
      const { app, db } = clientAs(uid, claims);
      try {
        await assert.rejects(getDoc(doc(db, 'collab_comments', 'proj1|team1')), /permission/i, `${uid} cannot read a comment`);
        await assert.rejects(getDocs(query(collection(db, 'collab_comments'), where('projectId', '==', 'proj1'))), /permission/i, `${uid} cannot list comments`);
        await assert.rejects(setDoc(doc(db, 'collab_comments', `proj1|${uid}`), { text: 'x' }), /permission/i, `${uid} cannot write`);
        await assert.rejects(getDoc(doc(db, 'collab_projects', 'proj1')), /permission/i, `${uid} cannot read the project`);
      } finally { await deleteApp(app); }
    }
  } finally { emulator.kill(); }
});
