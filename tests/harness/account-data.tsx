/**
 * Mounts the real Settings → Account "Your data and your account" panel with the real app client, against an
 * in-memory stand-in for the control plane's /v1/me/data-export and /v1/me/deletion routes, so
 * tests/v2-dev-account-data.spec.ts can download the zip, delete with typed confirmation and undo. Served only by the
 * Vite dev server.
 */
import '../../src/index.css';
import '../../src/v2/ui/v2.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountDataPanel } from '../../src/components/AccountDataPanel';
import { accountDataClient } from '../../src/providers/accountDataClient';

const DAY = 86_400_000;
let deletion: null | { status: 'scheduled'; requestedAtMs: number; deleteAfterMs: number } = null;
const calls: string[] = [];
const exported = {
  format: 'inflight-account-data/1', generatedAt: new Date().toISOString(),
  account: { accountId: 'acc_test', createdAt: '2026-01-01T00:00:00.000Z', role: 'user', status: 'active' },
  licences: [{ licenceId: 'lic_1', plan: 'paid', status: 'active' }], devices: [{ platform: 'macos', lastSeen: '2026-11-25T00:00:00.000Z' }],
  sharedProjects: [{ projectId: 'p1', name: 'Kites', role: 'owner' }],
  cloudPhotos: [{ projectId: 'p1', project: 'Kites', photoKey: 'k1', name: 'red kite.jpg', addedByYou: true, addedAt: '2026-11-20T00:00:00.000Z', previewBytes: 1000, thumbBytes: null, originalBytes: null }],
  comments: [{ id: 'c1', projectId: 'p1', photoId: 'ph1', text: 'Lovely light', createdAt: '2026-11-20T00:00:00.000Z', resolvedAt: null, replyTo: null }],
  purchases: [{ transactionId: 'txn_1', invoiceNumber: 'INV-1', majorVersion: 1, createdAt: '2026-11-20T10:00:00Z' }],
  alertDevices: [], alertPreferences: null, emailPreferences: null, cloudBalanceMillicredits: 250_000, deletion: null,
};
const preview = { ownedSharedProjects: 1, peopleInOwnedProjects: 2, otherSharedProjects: 1, cloudPhotos: 1, licences: 1, balanceMillicredits: 250_000, blocked: null };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const route = `${init?.method ?? 'GET'} ${url.pathname}`;
  calls.push(route);
  if (route === 'POST /v1/auth/firebase') return reply(200, { accessToken: 'session-token' });
  if ((init?.headers as Record<string, string> | undefined)?.authorization !== 'Bearer session-token') return reply(401, { error: { code: 'AUTH_REQUIRED', message: 'Sign in to use this.' } });
  if (route === 'GET /v1/me/data-export') return reply(200, exported);
  if (route === 'GET /v1/me/deletion') return reply(200, { deletion, preview });
  if (route === 'POST /v1/me/deletion') {
    const { confirm } = JSON.parse(String(init?.body)) as { confirm: string };
    if (confirm.trim().toUpperCase() !== 'DELETE') return reply(400, { error: { code: 'DELETION_NOT_CONFIRMED', message: 'Type DELETE to confirm.' } });
    deletion ??= { status: 'scheduled', requestedAtMs: Date.now(), deleteAfterMs: Date.now() + 30 * DAY };
    return reply(200, { deletion });
  }
  if (route === 'POST /v1/me/deletion/cancel') { deletion = null; return reply(200, { deletion: null }); }
  return reply(404, { error: { code: 'NOT_FOUND', message: 'No such route.' } });
};

const client = accountDataClient('https://control.example.test', async () => 'firebase-id-token', fakeFetch);
const w = window as unknown as { saved: { name: string; bytes: number[] } | null; calls: string[] };
w.saved = null;
w.calls = calls;

function Harness() {
  const [note, setNote] = useState('');
  return (
    <div className="inflight-v2" style={{ padding: 24, maxWidth: 560 }}>
      <p role="status" data-testid="note">{note}</p>
      <AccountDataPanel client={client} disabled={false} className="rounded-md border px-3 py-2" onNote={setNote}
        save={(blob, name) => { void blob.arrayBuffer().then((b) => { w.saved = { name, bytes: [...new Uint8Array(b)] }; }); }} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
