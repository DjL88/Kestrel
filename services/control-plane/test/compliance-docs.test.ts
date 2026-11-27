import test from 'node:test';
import assert from 'node:assert/strict';
import { ComplianceDocuments, MemoryComplianceStorage, COMPLIANCE_MAX_BYTES, COMPLIANCE_PREFIX } from '../src/complianceDocs.ts';
import { GcsComplianceStorage, type GcsListingBucketLike } from '../src/gcsAdapters.ts';
import { startHarness } from './helpers.ts';

const MD = Buffer.from('# Illegal content risk assessment\n\nSigned copy (synthetic test text).\n');
const PDF = Buffer.from('%PDF-1.7\n% synthetic test file, not a real document\n%%EOF\n');
const b64 = (b: Buffer) => b.toString('base64');

async function harness(withStore = true) {
  const storage = new MemoryComplianceStorage();
  const h = await startHarness(undefined, undefined, withStore ? { compliance: new ComplianceDocuments(storage) } : {});
  const admin = (method: string, path: string, body?: object) => h.call(method, path, { token: h.adminToken, body });
  return { h, storage, admin };
}

test('an admin uploads a signed copy, sees it listed with its date, and downloads it through a short-lived link; both are audited', async () => {
  const { h, storage, admin } = await harness();
  try {
    const up = await admin('POST', '/v1/admin/compliance/documents', { title: 'Illegal content risk assessment (signed)', fileName: 'illegal-content-risk-assessment.md', contentType: 'text/markdown', base64: b64(MD) });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const id = up.body.document.id as string;
    assert.match(id, /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9]+-illegal-content-risk-assessment\.md$/);
    assert.equal(up.body.document.sha256, undefined, 'the hash stays in the audit log, not the reply');
    assert.ok(storage.objects.get(COMPLIANCE_PREFIX + id)!.body.equals(MD), 'stored byte for byte');

    const pdf = await admin('POST', '/v1/admin/compliance/documents', { title: "Children's access assessment", fileName: 'childrens-access.pdf', contentType: 'application/pdf', base64: b64(PDF) });
    assert.equal(pdf.status, 200, JSON.stringify(pdf.body));

    const list = await admin('GET', '/v1/admin/compliance/documents');
    assert.equal(list.status, 200);
    assert.equal(list.body.documents.length, 2);
    const listed = list.body.documents.find((d: { id: string }) => d.id === id);
    assert.equal(listed.title, 'Illegal content risk assessment (signed)');
    assert.ok(listed.uploadedAtMs > 0, 'listed with its date');

    const dl = await admin('GET', `/v1/admin/compliance/documents/${id}/download`);
    assert.equal(dl.status, 200);
    assert.match(dl.body.url, /^memory:\/\/documents\//);
    assert.ok(dl.body.expiresAtMs > Date.now(), 'a link that expires');

    const audit = (await admin('GET', '/v1/admin/audit')).body.entries as { action: string; outcome: string; detail: string }[];
    assert.ok(audit.some((e) => e.action === 'compliance.upload' && e.outcome === 'allowed' && e.detail.startsWith(id) && /sha256=[0-9a-f]{64}/.test(e.detail)), 'upload audited with its hash');
    assert.ok(audit.some((e) => e.action === 'compliance.download' && e.outcome === 'allowed' && e.detail === id), 'download audited');
  } finally { await h.close(); }
});

test('only admins reach compliance documents, and the refusal is audited', async () => {
  const { h, admin } = await harness();
  try {
    assert.equal((await h.call('GET', '/v1/admin/compliance/documents')).status, 401);
    assert.equal((await h.call('GET', '/v1/admin/compliance/documents', { token: h.user.token })).status, 403);
    assert.equal((await h.call('POST', '/v1/admin/compliance/documents', { token: h.user.token, body: { title: 'x', fileName: 'x.md', contentType: 'text/markdown', base64: b64(MD) } })).status, 403);
    const audit = (await admin('GET', '/v1/admin/audit')).body.entries as { action: string; outcome: string }[];
    assert.ok(audit.some((e) => e.action === 'compliance.upload' && e.outcome === 'denied'));
  } finally { await h.close(); }
});

test('wrong types, fake PDFs, binary "Markdown", unknown ids and oversize files are refused', async () => {
  const { h, admin } = await harness();
  try {
    const up = (body: object) => admin('POST', '/v1/admin/compliance/documents', { title: 'Doc', ...body });
    assert.equal((await up({ fileName: 'a.docx', contentType: 'text/markdown', base64: b64(MD) })).status, 400, 'extension must match');
    assert.equal((await up({ fileName: 'a.pdf', contentType: 'application/pdf', base64: b64(MD) })).status, 400, 'not a PDF');
    assert.equal((await up({ fileName: 'a.md', contentType: 'text/markdown', base64: b64(Buffer.from([0x23, 0x00, 0xff])) })).status, 400, 'not text');
    assert.equal((await up({ fileName: 'a.html', contentType: 'text/html', base64: b64(MD) })).status, 400, 'type not allowed');
    assert.equal((await admin('GET', '/v1/admin/compliance/documents/..%2Fevidence/download')).status, 404);
    assert.equal((await admin('GET', '/v1/admin/compliance/documents/2026-01-01-none.md/download')).status, 404);
    const docs = new ComplianceDocuments(new MemoryComplianceStorage());
    await assert.rejects(docs.upload({ title: 'Big', fileName: 'big.md', contentType: 'text/markdown', body: Buffer.alloc(COMPLIANCE_MAX_BYTES + 1, 0x61), by: 'a', atMs: Date.now() }), /8 MB or less/);
  } finally { await h.close(); }
});

test('without the bucket the routes say it is not set up', async () => {
  const { h, admin } = await harness(false);
  try {
    // Looking is a normal answer (the admin page asks every five minutes); trying to upload is still refused.
    const r = await admin('GET', '/v1/admin/compliance/documents');
    assert.equal(r.status, 200);
    assert.equal(r.body.configured, false);
    const upload = await admin('POST', '/v1/admin/compliance/documents', { title: 'Risk assessment', fileName: 'r.md', contentType: 'text/markdown', base64: Buffer.from('# r').toString('base64') });
    assert.equal(upload.status, 503);
    assert.equal(upload.body.error?.code ?? upload.body.code, 'COMPLIANCE_NOT_CONFIGURED');
  } finally { await h.close(); }
});

test('a copy seeded into the bucket by hand is listed; GCS writes never overwrite and links download as an attachment', async () => {
  const saved: { name: string; opts: unknown }[] = [];
  let signed: Record<string, unknown> = {};
  const bucket: GcsListingBucketLike = {
    async getFiles() { return [[{ name: 'documents/2026-11-26-illegal-content-risk-assessment.md', metadata: { size: '120', timeCreated: '2026-11-26T15:00:00Z', contentType: 'text/markdown', metadata: { title: 'Illegal content risk assessment' } } }]]; },
    file: (name: string) => ({
      async getSignedUrl(opts) { signed = opts; return [`https://signed.example/${name}`]; },
      async exists() { return [true]; }, async delete() { return undefined; },
      async save(_data, opts) { saved.push({ name, opts }); },
    }),
  };
  const docs = new ComplianceDocuments(new GcsComplianceStorage(bucket, () => 1_000));
  const [seeded] = await docs.list();
  assert.equal(seeded!.id, '2026-11-26-illegal-content-risk-assessment.md');
  assert.equal(seeded!.uploadedBy, null, 'a hand-seeded copy has no uploader');
  assert.equal(seeded!.uploadedAtMs, Date.parse('2026-11-26T15:00:00Z'));
  const link = await docs.download(seeded!.id);
  assert.equal(link.expiresAtMs, 1_000 + 10 * 60_000);
  assert.match(String(signed.responseDisposition), /^attachment; filename="2026-11-26-illegal-content-risk-assessment.md"$/);
  await docs.upload({ title: 'T', fileName: 'x.md', contentType: 'text/markdown', body: MD, by: 'acct', atMs: 0 });
  assert.deepEqual((saved[0]!.opts as { preconditionOpts: unknown }).preconditionOpts, { ifGenerationMatch: 0 }, 'never replaces an object');
});
