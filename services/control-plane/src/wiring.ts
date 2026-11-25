/**
 * Builds the optional backend services (cloud processing, safe copy, learning signal, spend guard) from the environment.
 * Everything is OFF unless its variable is set, and nothing is built without Firestore, so SQLite development and the
 * deployed service as it is today are unchanged. Nothing here touches Google Cloud until an owner-applied deployment sets
 * these variables. Pence figures are estimates (spendGuard.ts), not Google's prices.
 */
import type { AppOptions } from './app.ts';
import { GcsCloudRunner, GcsSafeCopyStorage, CloudRunJobTrigger, metadataAccessToken, openGcsBucket, type GcsBucketLike } from './gcsAdapters.ts';
import { FirestoreCloudLedger } from './cloudLedgerFirestore.ts';
import { FirestoreLearningSink } from './learningSignalFirestore.ts';
import { FirestoreSafeCopyCatalog } from './safeCopyFirestore.ts';
import { CollabStore } from './collaboration.ts';
import { IamPresenceSigner } from './presenceToken.ts';
import { GalleryStore } from './gallery.ts';
import { NoticeStore, NO_DELIVERY } from './notices.ts';
import { CloudPhotoStore } from './cloudPhotos.ts';
import { BalanceBackedMeter, FirestoreUsageMeter, FlatAllowance } from './usageMeter.ts';
import { FirestoreCloudBalance } from './cloudBalance.ts';
import { randomUUID } from 'node:crypto';
import { FirestoreSpendGuard } from './spendGuard.ts';
import type { FirestoreLike } from './firestoreStore.ts';
import { VertexLearningLedger, configFromEnv as vertexConfigFromEnv } from './vertexLearning.ts';
import { createHmac } from 'node:crypto';
import { SafetyService, ExactHashListMatcher, PhotoDnaMatcher, CloudVisionSafeSearch, NcmecCyberTipline, type HashMatcher } from './contentSafety.ts';
import { networkCountryFrom, dbipCountryLookup } from './networkCountry.ts';
import { readFileSync } from 'node:fs';
import { FirestoreMailLedger, Mailer, SmtpTransport, secretManagerValue, MAIL_HARD_DAILY_MAX } from './mailer.ts';

export interface WiringDeps {
  firestore?: FirestoreLike;
  env?: NodeJS.ProcessEnv;
  openBucket?: (name: string) => Promise<GcsBucketLike>;
  token?: () => Promise<string>;
  /** The server's session secret; app email derives its unsubscribe-link key from it. */
  sessionSecret?: Buffer;
  /** Tests replace the SMTP transport. */
  mailTransport?: import('./mailer.ts').MailTransport;
}
export type OptionalServices = Pick<AppOptions, 'cloud' | 'safeCopy' | 'collab' | 'presence' | 'gallery' | 'notices' | 'cloudPhotos' | 'learning' | 'learningWithdrawal' | 'spend' | 'mailer' | 'cloudBalance' | 'vertexLearning' | 'safety'> & { enabled: string[] };

function whole(env: NodeJS.ProcessEnv, name: string, dflt: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${name} must be a whole number from 0 to ${max}`);
  return n;
}

export async function buildOptionalServices(deps: WiringDeps): Promise<OptionalServices> {
  const env = deps.env ?? process.env;
  const db = deps.firestore;
  if (!db) return { enabled: [] };
  const open = deps.openBucket ?? openGcsBucket;
  const out: OptionalServices = { enabled: [] };

  out.spend = {
    guard: new FirestoreSpendGuard(db),
    ceilingPence: whole(env, 'KCP_MONTHLY_SPEND_CEILING_PENCE', 1500, 1_000_000),
    cloudJobPence: whole(env, 'KCP_CLOUD_JOB_PENCE', 2, 100_000),
    aiCallPence: whole(env, 'KCP_AI_CALL_PENCE', 1, 100_000),
  };
  out.enabled.push('spend-guard');
  // Prepaid cloud balance: pays for cloud photos and downloads beyond the free monthly allowances (src/core/cloudPlan.ts).
  const balance = new FirestoreCloudBalance(db);
  out.cloudBalance = balance;

  // App email (hello@inflight.studio). Only when Terraform sets KCP_MAIL_ENABLED (smtp_mail_enabled), which waits for the
  // owner's "Send mail as" verification; the `email` admin switch must also be on before anything is sent.
  // The app password is read from Secret Manager on first send, never from the environment.
  if (env.KCP_MAIL_ENABLED === '1') {
    if (!deps.sessionSecret) throw new Error('app email needs the session secret for unsubscribe links');
    const required = (name: string) => { const v = env[name]; if (!v) throw new Error(`${name} is required when KCP_MAIL_ENABLED=1`); return v; };
    const token = deps.token ?? (() => metadataAccessToken());
    const transport = deps.mailTransport ?? new SmtpTransport({
      host: env.KCP_SMTP_HOST || 'smtp.gmail.com', port: whole(env, 'KCP_SMTP_PORT', 587, 65535), username: required('KCP_SMTP_USER'),
      password: secretManagerValue(required('KCP_SMTP_PASSWORD_SECRET'), token),
    });
    out.mailer = new Mailer({
      transport, ledger: new FirestoreMailLedger(db), fromAddress: env.KCP_MAIL_FROM || 'hello@inflight.studio', fromName: 'InFlight',
      siteOrigin: required('KCP_SITE_ORIGIN'), unsubscribeKey: createHmac('sha256', deps.sessionSecret).update('mail-unsubscribe-v1').digest(),
      limits: { daily: whole(env, 'KCP_MAIL_DAILY_LIMIT', 500, MAIL_HARD_DAILY_MAX), perSender: whole(env, 'KCP_MAIL_PER_SENDER', 30, 500), perRecipient: whole(env, 'KCP_MAIL_PER_RECIPIENT', 3, 50) },
    });
    out.enabled.push('email');
  }

  // Vertex learning batches: only when Terraform has created the job (vertex_learning_enabled). "Learn now" starts it.
  if (env.KCP_VERTEX_LEARNING_JOB) {
    const job = env.KCP_VERTEX_LEARNING_JOB;
    if (!/^projects\/[a-z][a-z0-9-]+\/locations\/[a-z0-9-]+\/jobs\/[a-z][a-z0-9-]*$/.test(job)) throw new Error('KCP_VERTEX_LEARNING_JOB must be projects/<p>/locations/<l>/jobs/<name>');
    const token = deps.token ?? (() => metadataAccessToken());
    out.vertexLearning = {
      ledger: new VertexLearningLedger(db), config: vertexConfigFromEnv(env),
      startJob: async () => {
        const r = await fetch(`https://run.googleapis.com/v2/${job}:run`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` }, body: '{}' });
        if (!r.ok) throw new Error(`run job ${r.status}`);
      },
    };
    out.enabled.push('vertex-learning');
  }

  if (env.KCP_CLOUD_PROCESSING_BUCKET && env.KCP_CLOUD_RUNNER_JOB) {
    const bucket = await open(env.KCP_CLOUD_PROCESSING_BUCKET);
    const trigger = new CloudRunJobTrigger(env.KCP_CLOUD_RUNNER_JOB, deps.token ?? (() => metadataAccessToken()));
    const ledger = new FirestoreCloudLedger(db);
    out.cloud = {
      runner: new GcsCloudRunner(bucket, trigger), ledger,
      settleFailed: (jobId, legacySpendPence) => ledger.settleFailed(jobId, legacySpendPence),
      // Owner, 25 Nov 2026: 5,000 cloud photos a month for Pro, 500 for Basic, then 0.3p each from the balance.
      jobsPerPeriod: whole(env, 'KCP_CLOUD_JOBS_PER_PERIOD', 5000, 100_000),
      basicJobsPerPeriod: whole(env, 'KCP_CLOUD_BASIC_JOBS_PER_PERIOD', 500, 100_000),
      balance, extraPhotoMillicredits: 300,
      maxInputBytes: whole(env, 'KCP_CLOUD_MAX_INPUT_BYTES', 120_000_000, 2_000_000_000),
    };
    out.enabled.push('cloud-processing');
  }
  if (env.KCP_SAFE_COPY_BUCKET) {
    out.safeCopy = {
      storage: new GcsSafeCopyStorage(await open(env.KCP_SAFE_COPY_BUCKET)), catalog: new FirestoreSafeCopyCatalog(db),
      bytesQuota: whole(env, 'KCP_SAFE_COPY_BYTES_QUOTA', 10_000_000_000, 10_000_000_000_000),
    };
    out.enabled.push('safe-copy');
  }
  // Shared projects need only Firestore. Off unless KCP_COLLABORATION_ENABLED=1, and then still off until an admin switches them on.
  if (env.KCP_COLLABORATION_ENABLED === '1') {
    out.collab = new CollabStore(db); out.enabled.push('collaboration');
    // Team notifications: the in-app inbox works now. Push (FCM) and hello@ email plug in when the backend lane wires
    // its sender and mailer into NoticeDelivery; until then nothing leaves the server.
    out.notices = new NoticeStore(db, NO_DELIVERY, undefined, (message) => console.warn(message)); out.enabled.push('notices');
    // Live cursors also need the Realtime Database URL and the service account that signs per-project tokens.
    if (env.KCP_PRESENCE_DATABASE_URL && env.KCP_PRESENCE_SERVICE_ACCOUNT) {
      if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebasedatabase\.app|firebaseio\.com)$/.test(env.KCP_PRESENCE_DATABASE_URL)) throw new Error('KCP_PRESENCE_DATABASE_URL must be a Firebase Realtime Database URL');
      out.presence = new IamPresenceSigner(env.KCP_PRESENCE_DATABASE_URL, env.KCP_PRESENCE_SERVICE_ACCOUNT, deps.token ?? (() => metadataAccessToken()));
      out.enabled.push('presence');
    }
    // Client galleries need their own private UK bucket (infra/gcp/gallery.tf).
    if (env.KCP_GALLERY_BUCKET) {
      const bucket = new GcsSafeCopyStorage(await open(env.KCP_GALLERY_BUCKET));
      out.gallery = new GalleryStore(db, bucket); out.enabled.push('gallery');
      out.safety = await buildSafety(db, env, deps);
      out.enabled.push(out.safety.service.configured ? 'safety-checks' : 'safety-reports-only');
      // The cloud photo store shares the UK bucket under projects/ (the 90-day rule covers galleries/ only).
      if (env.KCP_CLOUD_PHOTOS_ENABLED === '1') {
        const credits = Number(env.KCP_DOWNLOAD_CREDITS_PER_MONTH ?? 33);
        const maxGb = Number(env.KCP_CLOUD_PROJECT_MAX_GB ?? 50);
        out.cloudPhotos = {
          store: new CloudPhotoStore(db, bucket), meter: new BalanceBackedMeter(new FirestoreUsageMeter(db), balance, () => randomUUID()),
          allowance: new FlatAllowance(Math.max(0, Math.round((Number.isFinite(credits) ? credits : 33) * 1000))),
          maxProjectBytes: Math.max(0, (Number.isFinite(maxGb) ? maxGb : 50) * 1_000_000_000),
        };
        out.enabled.push('cloud-photos');
      }
    }
  }
  // Withdrawal/deletion must remain available with collection disabled.
  // This service cannot enable research writes: only the optional 'learning'
  // dependency is attached to the collection routes.
  out.learningWithdrawal = new FirestoreLearningSink(db);
  if (env.KCP_LEARNING_ENABLED === '1') { out.learning = out.learningWithdrawal as FirestoreLearningSink; out.enabled.push('learning-signal'); }
  return out;
}

/**
 * Acceptable-use checks for shared and cloud photos (contentSafety.ts). The report queue always exists with galleries;
 * each checker is added only when the owner has its access (see docs/SAFETY-SETUP.md). Without a hash checker,
 * production refuses to publish gallery and cloud pictures.
 */
export async function buildSafety(db: FirestoreLike, env: NodeJS.ProcessEnv, deps: Pick<WiringDeps, 'token'>) {
  const token = deps.token ?? (() => metadataAccessToken());
  const secret = (name: string) => { const ref = env[name]; return ref ? secretManagerValue(ref, token) : null; };
  const hashMatchers: HashMatcher[] = [];
  const photoDnaKey = secret('KCP_PHOTODNA_KEY_SECRET');
  if (photoDnaKey) {
    let key: string | undefined;
    const lazy: HashMatcher = { name: 'photodna', maxBytes: 4_000_000, match: async (image) => new PhotoDnaMatcher(key ??= await photoDnaKey()).match(image) };
    hashMatchers.push(lazy);
  }
  if (env.KCP_SAFETY_HASH_LIST_FILE) {
    const list = new ExactHashListMatcher(readFileSync(env.KCP_SAFETY_HASH_LIST_FILE, 'utf8').split(/\r?\n/), env.KCP_SAFETY_HASH_LIST_SOURCE || 'hash-list');
    if (list.size === 0) throw new Error('KCP_SAFETY_HASH_LIST_FILE holds no MD5, SHA-1 or SHA-256 hashes');
    hashMatchers.push(list);
  }
  const classifier = env.KCP_SAFESEARCH_ENABLED === '1' ? new CloudVisionSafeSearch(token) : null;
  let reporter = null;
  const ncmecPassword = secret('KCP_NCMEC_PASSWORD_SECRET');
  if (ncmecPassword && env.KCP_NCMEC_USERNAME) {
    if (!env.KCP_NCMEC_REPORTER_EMAIL || !env.KCP_NCMEC_COMPANY) throw new Error('KCP_NCMEC_REPORTER_EMAIL and KCP_NCMEC_COMPANY are required with the CyberTipline connection');
    const base = env.KCP_NCMEC_ENVIRONMENT === 'production' ? 'https://report.cybertip.org/ispws' : 'https://exttest.cybertip.org/ispws';
    const username = env.KCP_NCMEC_USERNAME, reporterEmail = env.KCP_NCMEC_REPORTER_EMAIL, companyName = env.KCP_NCMEC_COMPANY;
    reporter = { submit: async (c: Parameters<NcmecCyberTipline['submit']>[0], evidence: Buffer) => new NcmecCyberTipline({ username, password: await ncmecPassword(), base, reporterEmail, companyName }).submit(c, evidence) };
  }
  const countryOf = await dbipCountryLookup().then(networkCountryFrom).catch(() => undefined);
  return { service: new SafetyService(db, { hashMatchers, classifier, reporter }), countryOf };
}
