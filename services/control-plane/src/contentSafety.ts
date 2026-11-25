/**
 * Acceptable-use and safety checks (site/acceptable-use.html). They apply ONLY to what people put online: photos in a
 * shared project's cloud store and previews published to a client gallery. Photos that stay on a device, and the app's
 * local work, never reach this code. Safe copy (a person's own private backup) is not scanned.
 *
 * On every commit of a cloud or gallery picture, before anyone else can see it:
 * 1. Known child sexual abuse material: the picture is matched against a hash list (Microsoft PhotoDNA Cloud Service,
 *    or an exact-hash list such as the IWF's MD5/SHA-1 list). A match blocks it, moves the bytes to a private evidence
 *    key (kept a year, as US 18 U.S.C. 2258A asks after a report), suspends the account and files a CyberTipline report
 *    with NCMEC when the reporter is configured; NCMEC passes reports to police abroad, including the NCA. UK cases are
 *    also marked for a direct NCA report.
 * 2. Other clearly unsafe content: an AI classifier (Google Cloud Vision SafeSearch). A flag holds the picture back from
 *    sharing and opens a review case. It is NEVER reported automatically and never suspends anyone.
 * Nobody, admins included, is ever given a way to see a held or blocked picture: no route signs a URL for the evidence
 * or for a held object, and cases carry only metadata.
 *
 * A checker that cannot answer fails closed (the picture is not published; the person can retry). Without any checker
 * configured, production refuses publishing (SAFETY_NOT_CONFIGURED) so sharing cannot open unscanned.
 */
import { createHash } from 'node:crypto';
import { randomId } from './crypto.ts';
import type { FirestoreLike, FsData } from './firestoreStore.ts';

// ---- What the checks need from storage ------------------------------------------------------------------------------

export interface ScannableStorage {
  /** The stored bytes, or null when nothing is there. Refuses objects larger than maxBytes. */
  read(key: string, maxBytes: number): Promise<Buffer | null>;
  /** Server-side copy within the same private bucket. */
  copy(from: string, to: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// ---- Checkers -------------------------------------------------------------------------------------------------------

export interface HashMatch { matched: boolean; source: string; matchId?: string }
export interface HashMatcher { readonly name: string; readonly maxBytes: number; match(image: Buffer): Promise<HashMatch> }
export interface ClassifierVerdict { flagged: boolean; labels: Record<string, string> }
export interface SafetyClassifier { readonly name: string; classify(image: Buffer): Promise<ClassifierVerdict> }

/** An exact-hash list (MD5, SHA-1 or SHA-256 hex, one per line), as the IWF and NCMEC distribute to members. */
export class ExactHashListMatcher implements HashMatcher {
  readonly name = 'exact-hash-list';
  readonly maxBytes = 50_000_000;
  private readonly hashes: Set<string>;
  constructor(list: Iterable<string>, private readonly source = 'hash-list') {
    this.hashes = new Set([...list].map((h) => h.trim().toLowerCase()).filter((h) => /^([0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/.test(h)));
  }
  get size() { return this.hashes.size; }
  async match(image: Buffer): Promise<HashMatch> {
    for (const algo of ['md5', 'sha1', 'sha256'] as const) {
      const digest = createHash(algo).update(image).digest('hex');
      if (this.hashes.has(digest)) return { matched: true, source: this.source, matchId: `${algo}:${digest}` };
    }
    return { matched: false, source: this.source };
  }
}

/**
 * Microsoft PhotoDNA Cloud Service (free for qualified organisations; needs an approved subscription key).
 * POST the image bytes to /photodna/v1.0/Match. Status code 3000 is success. Images must be 50 px+ and at most 4 MB.
 */
export class PhotoDnaMatcher implements HashMatcher {
  readonly name = 'photodna';
  readonly maxBytes = 4_000_000;
  constructor(private readonly subscriptionKey: string, private readonly fetcher: typeof fetch = fetch, private readonly endpoint = 'https://api.microsoftmoderator.com/photodna/v1.0/Match') {}
  async match(image: Buffer): Promise<HashMatch> {
    const r = await this.fetcher(`${this.endpoint}?enhance=false`, {
      method: 'POST', headers: { 'content-type': 'image/jpeg', 'ocp-apim-subscription-key': this.subscriptionKey }, body: new Uint8Array(image),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`PhotoDNA answered ${r.status}`);
    const data = (await r.json()) as { IsMatch?: boolean; Status?: { Code?: number }; TrackingId?: string; MatchDetails?: { MatchFlags?: { Source?: string }[] } };
    if (data.Status?.Code !== 3000) throw new Error(`PhotoDNA status ${data.Status?.Code ?? 'missing'}`);
    if (data.IsMatch !== true) return { matched: false, source: 'photodna' };
    return { matched: true, source: `photodna:${data.MatchDetails?.MatchFlags?.[0]?.Source ?? 'unknown'}`, matchId: data.TrackingId };
  }
}

export const LIKELIHOODS = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'] as const;
const atLeast = (value: string | undefined, min: typeof LIKELIHOODS[number]) => LIKELIHOODS.indexOf((value ?? 'UNKNOWN') as typeof LIKELIHOODS[number]) >= LIKELIHOODS.indexOf(min);

/**
 * Google Cloud Vision SafeSearch (paid per image after the free tier; the service account calls it, no key in Git).
 * Flags explicit adult content (LIKELY or more) and graphic violence (VERY_LIKELY). "Racy" alone never flags: swimwear,
 * sport and wildlife photography are normal work here.
 */
export class CloudVisionSafeSearch implements SafetyClassifier {
  readonly name = 'cloud-vision-safesearch';
  constructor(private readonly token: () => Promise<string>, private readonly fetcher: typeof fetch = fetch) {}
  async classify(image: Buffer): Promise<ClassifierVerdict> {
    const r = await this.fetcher('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.token()}` },
      body: JSON.stringify({ requests: [{ image: { content: image.toString('base64') }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Cloud Vision answered ${r.status}`);
    const data = (await r.json()) as { responses?: { safeSearchAnnotation?: Record<string, string>; error?: { message?: string } }[] };
    const first = data.responses?.[0];
    if (!first || first.error || !first.safeSearchAnnotation) throw new Error('Cloud Vision gave no SafeSearch answer');
    return safeSearchVerdict(first.safeSearchAnnotation);
  }
}

export function safeSearchVerdict(a: Record<string, string>): ClassifierVerdict {
  const labels = Object.fromEntries(['adult', 'violence', 'racy', 'medical', 'spoof'].map((k) => [k, String(a[k] ?? 'UNKNOWN')]));
  return { flagged: atLeast(a.adult, 'LIKELY') || atLeast(a.violence, 'VERY_LIKELY'), labels };
}

// ---- Reporting ------------------------------------------------------------------------------------------------------

export interface CyberTipReporter { submit(c: SafetyCase, evidence: Buffer): Promise<{ reportId: string }> }

const xml = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!);
const xmlField = (body: string, tag: string) => body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];

/**
 * NCMEC CyberTipline Reporting API for registered electronic service providers (submit, upload, finish). It needs the
 * ESP registration and credentials NCMEC issues; the test environment (exttest.cybertip.org) is the default until the
 * owner switches to production. NOT RUN against NCMEC yet: verify against their test service before relying on it.
 */
export class NcmecCyberTipline implements CyberTipReporter {
  constructor(private readonly opts: { username: string; password: string; base?: string; reporterEmail: string; companyName: string }, private readonly fetcher: typeof fetch = fetch) {}
  private get base() { return this.opts.base ?? 'https://exttest.cybertip.org/ispws'; }
  private async post(path: string, body: BodyInit, contentType?: string) {
    const headers: Record<string, string> = { authorization: `Basic ${Buffer.from(`${this.opts.username}:${this.opts.password}`).toString('base64')}` };
    if (contentType) headers['content-type'] = contentType;
    const r = await this.fetcher(this.base + path, { method: 'POST', headers, body, signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    if (!r.ok || xmlField(text, 'responseCode') !== '0') throw new Error(`CyberTipline ${path} failed: ${r.status} ${xmlField(text, 'responseDescription') ?? ''}`.trim());
    return text;
  }
  async submit(c: SafetyCase, evidence: Buffer) {
    const report = `<?xml version="1.0" encoding="UTF-8"?>
<report xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://report.cybertip.org/ispws/xsd">
  <incidentSummary><incidentType>Child Pornography (possession, manufacture, and distribution)</incidentType><incidentDateTime>${new Date(c.atMs).toISOString()}</incidentDateTime></incidentSummary>
  <reporter><reportingPerson><email>${xml(this.opts.reporterEmail)}</email></reportingPerson><companyTemplate>${xml(this.opts.companyName)}</companyTemplate></reporter>
  <personOrUserReported><espIdentifier>${xml(c.accountId)}</espIdentifier>${c.country ? `<additionalInfo>Network country ${xml(c.country)}</additionalInfo>` : ''}</personOrUserReported>
</report>`;
    const reportId = xmlField(await this.post('/submit', report, 'text/xml; charset=utf-8'), 'reportId');
    if (!reportId) throw new Error('CyberTipline gave no report id');
    const form = new FormData();
    form.set('id', reportId);
    form.set('file', new Blob([new Uint8Array(evidence)], { type: 'image/jpeg' }), `${c.caseId}.jpg`);
    await this.post('/upload', form);
    await this.post('/finish', new URLSearchParams({ id: reportId }), 'application/x-www-form-urlencoded');
    return { reportId };
  }
}

// ---- Cases and notices ----------------------------------------------------------------------------------------------

export type SafetyScope = 'gallery' | 'cloud';
export type CaseKind = 'hash-match' | 'ai-flag';
export type CaseStatus = 'report-pending' | 'reported' | 'review' | 'released' | 'upheld';
export interface SafetyCase {
  caseId: string; kind: CaseKind; scope: SafetyScope; status: CaseStatus; atMs: number;
  accountId: string; projectId: string; galleryId: string | null; photoId: string; variant: string; objectKey: string;
  sha256: string; bytes: number; country: string | null;
  detection: { checker: string; source?: string; matchId?: string; labels?: Record<string, string> };
  /** Hash matches only: where the bytes are kept and until when. Never signed for download. */
  evidenceKey: string | null; preserveUntilMs: number | null;
  ncmec: { reportId: string | null; atMs: number | null; error: string | null } | null;
  /** UK users: a direct report to the NCA as well. 'manual' until an NCA route is set up. */
  nca: 'not-applicable' | 'manual' | 'done';
  /** The statement of reasons the uploader sees (EU DSA Art. 17). */
  statement: string;
  appeal: { text: string; atMs: number } | null;
  decision: { by: string; atMs: number; outcome: 'released' | 'upheld'; reason: string } | null;
}

export const NOTICE_CATEGORIES = ['child-sexual-abuse', 'intimate-image-abuse', 'terrorism-or-violence', 'harassment-or-privacy', 'copyright', 'other-illegal', 'policy-breach'] as const;
export type NoticeCategory = typeof NOTICE_CATEGORIES[number];
export type NoticeOutcome = 'no-action' | 'photo-removed' | 'gallery-revoked';
export interface SafetyNotice {
  noticeId: string; receiptHash: string; atMs: number; galleryId: string; ownerAccountId: string; photoId: string | null;
  category: NoticeCategory; explanation: string; notifierName: string | null; notifierEmail: string | null; goodFaith: true;
  status: 'open' | 'decided'; urgent: boolean;
  decision: { by: string; atMs: number; outcome: NoticeOutcome; reason: string } | null;
}

export class SafetyRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false) { super(message); }
}

const clean = (value: object): FsData => JSON.parse(JSON.stringify(value)) as FsData;
const S = { cases: 'safety_cases', notices: 'safety_notices' };
/** 18 U.S.C. 2258A(h) as amended by the REPORT Act 2024: keep reported material for one year. */
export const EVIDENCE_KEEP_MS = 365 * 86_400_000;
export const HELD_MESSAGE = 'This picture was held back from sharing by an automatic check and is waiting for review. It stays on your device; nothing was deleted.';
export const BLOCKED_MESSAGE = 'This picture cannot be shared under the InFlight acceptable use policy.';
export const statementFor = (kind: CaseKind, labels?: Record<string, string>) => kind === 'hash-match'
  ? 'Blocked under the acceptable use policy: illegal content, found by an automated check. The account is suspended.'
  : `Held from sharing: an automated classifier (${Object.entries(labels ?? {}).filter(([, v]) => v === 'LIKELY' || v === 'VERY_LIKELY').map(([k, v]) => `${k} ${v.toLowerCase().replace('_', ' ')}`).join(', ') || 'unsafe content'}) flagged it as possibly breaking the acceptable use policy. A person reviews it from the details only, never by viewing the picture. Not reported to anyone. You can ask for another look.`;

export interface SafetyChecks { hashMatchers: HashMatcher[]; classifier: SafetyClassifier | null; reporter: CyberTipReporter | null }

export interface CheckInput {
  scope: SafetyScope; accountId: string; projectId: string; galleryId: string | null; photoId: string; variant: string;
  key: string; sha256: string; bytes: number; country: string | null;
}
export type CheckOutcome = { outcome: 'clear' } | { outcome: 'blocked' | 'held'; caseId: string };

export class SafetyService {
  constructor(private readonly db: FirestoreLike, readonly checks: SafetyChecks, private readonly now: () => number = Date.now) {}
  get configured() { return this.checks.hashMatchers.length > 0; }
  private cref(id: string) { return this.db.collection(S.cases).doc(id); }
  private nref(id: string) { return this.db.collection(S.notices).doc(id); }

  /** Scans one stored picture before it is published. Throws SafetyRefusal when it cannot be checked. */
  async check(storage: ScannableStorage, input: CheckInput, onHashMatch: (c: SafetyCase) => Promise<void>): Promise<CheckOutcome> {
    const limit = Math.min(...this.checks.hashMatchers.map((m) => m.maxBytes), 50_000_000);
    let image: Buffer | null;
    try { image = await storage.read(input.key, limit); } catch { throw new SafetyRefusal(413, 'TOO_LARGE_TO_CHECK', `Pictures for sharing must be ${Math.floor(limit / 1_000_000)} MB or less so they can be checked. Export a smaller preview.`); }
    if (!image) throw new SafetyRefusal(404, 'NOT_FOUND', 'Upload it first.');
    // The case records what was actually stored, not what the client declared.
    input = { ...input, sha256: createHash('sha256').update(image).digest('hex'), bytes: image.length };
    const earlier = (await this.db.collection(S.cases).where('objectKey', '==', input.key).get()).docs
      .map((d) => d.data()! as unknown as SafetyCase).filter((c) => c.kind === 'ai-flag' && c.sha256 === input.sha256);
    const pending = earlier.find((c) => c.status !== 'released');
    // An AI flag for this exact picture is still open or upheld: hold it again without opening a second case.
    if (pending) return { outcome: 'held', caseId: pending.caseId };
    const released = earlier.length > 0;
    for (const matcher of this.checks.hashMatchers) {
      let result: HashMatch;
      try { result = await matcher.match(image); } catch { throw new SafetyRefusal(503, 'SAFETY_CHECK_UNAVAILABLE', 'The sharing check could not run. Nothing was published; try again shortly.', true); }
      if (!result.matched) continue;
      const c = await this.openCase(input, 'hash-match', { checker: matcher.name, source: result.source, matchId: result.matchId });
      await storage.copy(input.key, c.evidenceKey!);
      await storage.delete(input.key);
      await onHashMatch(c);
      await this.report(c.caseId, storage).catch(() => undefined);
      return { outcome: 'blocked', caseId: c.caseId };
    }
    // A person released an AI flag on this exact picture: the classifier is not asked again (hash lists always are).
    if (this.checks.classifier && !released) {
      let verdict: ClassifierVerdict;
      try { verdict = await this.checks.classifier.classify(image); } catch { throw new SafetyRefusal(503, 'SAFETY_CHECK_UNAVAILABLE', 'The sharing check could not run. Nothing was published; try again shortly.', true); }
      if (verdict.flagged) {
        const c = await this.openCase(input, 'ai-flag', { checker: this.checks.classifier.name, labels: verdict.labels });
        return { outcome: 'held', caseId: c.caseId };
      }
    }
    return { outcome: 'clear' };
  }

  private async openCase(input: CheckInput, kind: CaseKind, detection: SafetyCase['detection']): Promise<SafetyCase> {
    const atMs = this.now();
    const caseId = `case_${randomId(12)}`;
    const c: SafetyCase = {
      caseId, kind, scope: input.scope, status: kind === 'hash-match' ? 'report-pending' : 'review', atMs,
      accountId: input.accountId, projectId: input.projectId, galleryId: input.galleryId, photoId: input.photoId, variant: input.variant, objectKey: input.key,
      sha256: input.sha256, bytes: input.bytes, country: input.country, detection,
      evidenceKey: kind === 'hash-match' ? `evidence/${caseId}` : null, preserveUntilMs: kind === 'hash-match' ? atMs + EVIDENCE_KEEP_MS : null,
      ncmec: kind === 'hash-match' ? { reportId: null, atMs: null, error: null } : null,
      nca: kind === 'hash-match' && input.country === 'GB' ? 'manual' : 'not-applicable',
      statement: statementFor(kind, detection.labels), appeal: null, decision: null,
    };
    await this.cref(caseId).create(clean(c));
    return c;
  }

  async getCase(caseId: string): Promise<SafetyCase> {
    const snap = await this.cref(caseId).get();
    if (!snap.exists) throw new SafetyRefusal(404, 'NOT_FOUND', 'No such case.');
    return snap.data()! as unknown as SafetyCase;
  }

  /** Files the CyberTipline report from the preserved evidence. Without a reporter, the case waits for a manual report. */
  async report(caseId: string, storage: ScannableStorage): Promise<SafetyCase> {
    const c = await this.getCase(caseId);
    if (c.kind !== 'hash-match') throw new SafetyRefusal(409, 'NOT_REPORTABLE', 'Only hash matches are reported. AI flags never are.');
    if (c.status === 'reported') return c;
    if (!this.checks.reporter) throw new SafetyRefusal(503, 'REPORTER_NOT_CONFIGURED', 'The CyberTipline connection is not set up yet. Report by hand and record the report number.');
    try {
      const evidence = await storage.read(c.evidenceKey!, 50_000_000);
      if (!evidence) throw new Error('evidence missing');
      const { reportId } = await this.checks.reporter.submit(c, evidence);
      const next = { ...c, status: 'reported' as const, ncmec: { reportId, atMs: this.now(), error: null } };
      await this.cref(caseId).set(clean(next));
      return next;
    } catch (error) {
      await this.cref(caseId).set(clean({ ...c, ncmec: { reportId: null, atMs: null, error: String((error as Error).message).slice(0, 200) } }));
      throw new SafetyRefusal(502, 'REPORT_FAILED', 'The CyberTipline report did not go through. It stays pending; try again.', true);
    }
  }

  /** A report made by hand (NCMEC web form or the NCA), recorded on the case. */
  async recordManualReport(caseId: string, by: string, refs: { ncmecReportId?: string; ncaDone?: boolean }): Promise<SafetyCase> {
    const c = await this.getCase(caseId);
    if (c.kind !== 'hash-match') throw new SafetyRefusal(409, 'NOT_REPORTABLE', 'Only hash matches are reported. AI flags never are.');
    const ncmec = refs.ncmecReportId ? { reportId: refs.ncmecReportId, atMs: this.now(), error: null } : c.ncmec;
    const next: SafetyCase = { ...c, ncmec, nca: refs.ncaDone && c.nca === 'manual' ? 'done' : c.nca, status: ncmec?.reportId ? 'reported' : c.status, decision: c.decision ?? { by, atMs: this.now(), outcome: 'upheld', reason: 'Hash match; reported.' } };
    await this.cref(caseId).set(clean(next));
    return next;
  }

  /** Review of an AI flag, from its details only. Hash matches cannot be released here. */
  async decide(caseId: string, by: string, outcome: 'released' | 'upheld', reason: string): Promise<SafetyCase> {
    const c = await this.getCase(caseId);
    if (c.kind !== 'ai-flag') throw new SafetyRefusal(409, 'NOT_REVIEWABLE', 'A hash match is not reviewed here: it is blocked and reported.');
    const next: SafetyCase = {
      ...c, status: outcome, decision: { by, atMs: this.now(), outcome, reason },
      statement: outcome === 'released' ? 'Reviewed and released: publish it again to share it.' : `${c.statement} Reviewed and kept from sharing: ${reason}`,
    };
    await this.cref(caseId).set(clean(next));
    return next;
  }

  async appeal(caseId: string, accountId: string, text: string): Promise<SafetyCase> {
    const c = await this.getCase(caseId);
    if (c.accountId !== accountId) throw new SafetyRefusal(404, 'NOT_FOUND', 'No such case.');
    if (c.kind !== 'ai-flag') throw new SafetyRefusal(409, 'NOT_APPEALABLE', 'Contact us to ask about this decision.');
    const next: SafetyCase = { ...c, status: 'review', appeal: { text, atMs: this.now() } };
    await this.cref(caseId).set(clean(next));
    return next;
  }

  async cases(filter: { accountId?: string } = {}): Promise<SafetyCase[]> {
    const col = this.db.collection(S.cases);
    const snap = await (filter.accountId ? col.where('accountId', '==', filter.accountId) : col).get();
    return snap.docs.map((d) => d.data()! as unknown as SafetyCase).sort((a, b) => b.atMs - a.atMs);
  }

  /** True when a picture has an open or upheld case, so it must not be published or downloaded. */
  async isHeld(scope: SafetyScope, key: string): Promise<boolean> {
    const snap = await this.db.collection(S.cases).where('objectKey', '==', key).get();
    return snap.docs.some((d) => { const c = d.data()! as unknown as SafetyCase; return c.scope === scope && c.status !== 'released'; });
  }

  // ---- EU DSA Art. 16 notice and action ----

  async addNotice(input: Omit<SafetyNotice, 'noticeId' | 'receiptHash' | 'atMs' | 'status' | 'urgent' | 'decision'>): Promise<{ notice: SafetyNotice; receipt: string }> {
    const receipt = randomId(24);
    const notice: SafetyNotice = {
      ...input, noticeId: `ntc_${randomId(12)}`, receiptHash: createHash('sha256').update(`notice:${receipt}`).digest('hex'), atMs: this.now(),
      status: 'open', urgent: input.category === 'child-sexual-abuse' || input.category === 'intimate-image-abuse' || input.category === 'terrorism-or-violence', decision: null,
    };
    await this.nref(notice.noticeId).create(clean(notice));
    return { notice, receipt };
  }

  async getNotice(noticeId: string): Promise<SafetyNotice> {
    const snap = await this.nref(noticeId).get();
    if (!snap.exists) throw new SafetyRefusal(404, 'NOT_FOUND', 'No such report.');
    return snap.data()! as unknown as SafetyNotice;
  }

  /** The notifier's view, with the receipt they were given (so report ids cannot be enumerated). */
  async noticeStatus(noticeId: string, receipt: string) {
    const n = await this.getNotice(noticeId).catch(() => null);
    if (!n || n.receiptHash !== createHash('sha256').update(`notice:${receipt}`).digest('hex')) throw new SafetyRefusal(404, 'NOT_FOUND', 'No such report.');
    return { noticeId: n.noticeId, receivedAtMs: n.atMs, status: n.status, outcome: n.decision?.outcome ?? null, reason: n.decision?.reason ?? null, decidedAtMs: n.decision?.atMs ?? null };
  }

  async notices(): Promise<SafetyNotice[]> {
    const snap = await this.db.collection(S.notices).get();
    return snap.docs.map((d) => d.data()! as unknown as SafetyNotice).sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || Number(b.urgent) - Number(a.urgent) || a.atMs - b.atMs);
  }

  async decideNotice(noticeId: string, by: string, outcome: NoticeOutcome, reason: string): Promise<SafetyNotice> {
    const n = await this.getNotice(noticeId);
    const next: SafetyNotice = { ...n, status: 'decided', decision: { by, atMs: this.now(), outcome, reason } };
    await this.nref(noticeId).set(clean(next));
    return next;
  }
}

/** Admin view of a case: metadata only. There is deliberately no image, URL or evidence key in it. */
export function caseSummary(c: SafetyCase) {
  return {
    caseId: c.caseId, kind: c.kind, scope: c.scope, status: c.status, atMs: c.atMs, accountId: c.accountId, projectId: c.projectId,
    galleryId: c.galleryId, photoId: c.photoId, variant: c.variant, bytes: c.bytes, country: c.country, detection: c.detection,
    evidenceKept: c.evidenceKey !== null, preserveUntilMs: c.preserveUntilMs, ncmec: c.ncmec, nca: c.nca, appeal: c.appeal, decision: c.decision,
  };
}

/** The uploader's view (DSA statement of reasons). */
export function caseForUploader(c: SafetyCase) {
  return { caseId: c.caseId, kind: c.kind, scope: c.scope, status: c.status, atMs: c.atMs, projectId: c.projectId, galleryId: c.galleryId, photoId: c.photoId, statement: c.statement, canAppeal: c.kind === 'ai-flag' && c.status === 'upheld', appeal: c.appeal };
}
