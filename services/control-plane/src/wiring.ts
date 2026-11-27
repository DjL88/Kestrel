/**
 * Builds the optional backend services (cloud processing, safe copy, learning signal, spend guard) from the environment.
 * Everything is OFF unless its variable is set, and nothing is built without Firestore, so SQLite development and the
 * deployed service as it is today are unchanged. Nothing here touches Google Cloud until an owner-applied deployment sets
 * these variables. Pence figures are estimates (spendGuard.ts), not Google's prices.
 */
import type { AppOptions } from './app.ts';
import { GcsCloudRunner, GcsComplianceStorage, GcsSafeCopyStorage, CloudRunJobTrigger, metadataAccessToken, openGcsBucket, type GcsBucketLike, type GcsListingBucketLike } from './gcsAdapters.ts';
import { ComplianceDocuments } from './complianceDocs.ts';
import { FirestoreCloudLedger } from './cloudLedgerFirestore.ts';
import { FirestoreLearningSink } from './learningSignalFirestore.ts';
import { FirestoreSafeCopyCatalog } from './safeCopyFirestore.ts';
import { CollabStore } from './collaboration.ts';
import { IamPresenceSigner } from './presenceToken.ts';
import { GalleryStore } from './gallery.ts';
import { NoticeStore } from './notices.ts';
import { FcmSender, PushService, noticeDelivery, type PushSender } from './push.ts';
import { CloudPhotoStore } from './cloudPhotos.ts';
import { BalanceBackedMeter, FirestoreUsageMeter, FlatAllowance, RolloverAllowance } from './usageMeter.ts';
import { FirestoreCloudBalance } from './cloudBalance.ts';
import { randomUUID } from 'node:crypto';
import { FirestoreSpendGuard } from './spendGuard.ts';
import type { FirestoreLike } from './firestoreStore.ts';
import { VertexLearningLedger, configFromEnv as vertexConfigFromEnv } from './vertexLearning.ts';
import { createHmac } from 'node:crypto';
import { SafetyService } from './contentSafety.ts';
import { FirestoreMailLedger, Mailer, SmtpTransport, secretManagerValue, DEFAULT_MAIL_LIMITS, fromAddressFor, hardDailyMax, mailAccountKind, mailNoticeDelivery } from './mailer.ts';
import { NoticeContacts, identityToolkitLookup, type FirebaseUserLookup } from './noticeContacts.ts';
import { NewsBroadcaster } from './news.ts';

export interface WiringDeps {
  firestore?: FirestoreLike;
  env?: NodeJS.ProcessEnv;
  openBucket?: (name: string) => Promise<GcsBucketLike>;
  token?: () => Promise<string>;
  /** The server's session secret; app email derives its unsubscribe-link key from it. */
  sessionSecret?: Buffer;
  /** Tests replace the SMTP transport. */
  mailTransport?: import('./mailer.ts').MailTransport;
  /** Tests: a fake FCM sender. */
  pushSender?: PushSender;
  /** Tests: a fake Firebase Auth user lookup (production: Identity Toolkit). */
  firebaseUsers?: FirebaseUserLookup;
}
export type OptionalServices = Pick<AppOptions, 'cloud' | 'safeCopy' | 'collab' | 'presence' | 'gallery' | 'notices' | 'push' | 'contacts' | 'news' | 'cloudPhotos' | 'learning' | 'learningWithdrawal' | 'spend' | 'mailer' | 'cloudBalance' | 'vertexLearning' | 'safety' | 'compliance'> & { enabled: string[] };

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

  // App email. Only when Terraform sets KCP_MAIL_ENABLED (smtp_mail_enabled); the `email` admin switch must also be on
  // before anything is sent. The app password is read from Secret Manager on first send, never from the environment.
  // A gmail.com SMTP login is a personal Gmail account: hard cap 450 a day, From = that address unless KCP_MAIL_FROM
  // names a verified "Send mail as" alias. Otherwise Workspace: hard cap 1,500, From hello@inflight.studio by default.
  if (env.KCP_MAIL_ENABLED === '1') {
    if (!deps.sessionSecret) throw new Error('app email needs the session secret for unsubscribe links');
    const required = (name: string) => { const v = env[name]; if (!v) throw new Error(`${name} is required when KCP_MAIL_ENABLED=1`); return v; };
    const token = deps.token ?? (() => metadataAccessToken());
    const username = required('KCP_SMTP_USER');
    const account = mailAccountKind(username);
    const transport = deps.mailTransport ?? new SmtpTransport({
      host: env.KCP_SMTP_HOST || 'smtp.gmail.com', port: whole(env, 'KCP_SMTP_PORT', 587, 65535), username,
      password: secretManagerValue(required('KCP_SMTP_PASSWORD_SECRET'), token),
    });
    const cap = hardDailyMax(account);
    out.mailer = new Mailer({
      transport, ledger: new FirestoreMailLedger(db), fromAddress: fromAddressFor(username, env.KCP_MAIL_FROM), fromName: 'InFlight', account,
      siteOrigin: required('KCP_SITE_ORIGIN'), unsubscribeKey: createHmac('sha256', deps.sessionSecret).update('mail-unsubscribe-v1').digest(),
      limits: { daily: whole(env, 'KCP_MAIL_DAILY_LIMIT', Math.min(DEFAULT_MAIL_LIMITS.daily, cap), cap), perSender: whole(env, 'KCP_MAIL_PER_SENDER', 30, 500), perRecipient: whole(env, 'KCP_MAIL_PER_RECIPIENT', 3, 50) },
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
      // Cloud edit settings (x-std-cloud-recipe): off unless the owner switches them on.
      recipe: { enabled: env.KCP_CLOUD_RECIPE_ENABLED === '1', maxPreviewBytes: whole(env, 'KCP_CLOUD_RECIPE_MAX_PREVIEW_BYTES', 10_000_000, 50_000_000) },
    };
    out.enabled.push('cloud-processing');
  }
  // Signed compliance documents (risk assessments): their own private, versioned UK bucket (infra/gcp/compliance.tf).
  if (env.KCP_COMPLIANCE_BUCKET) {
    out.compliance = new ComplianceDocuments(new GcsComplianceStorage(await open(env.KCP_COMPLIANCE_BUCKET) as GcsListingBucketLike));
    out.enabled.push('compliance-documents');
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
    // Team notifications: the in-app inbox always; push (FCM) only when KCP_PUSH_ENABLED=1 and the `push` admin switch is
    // on; email only when push reached no device, through the mailer (its own switch), to the account's verified
    // Firebase sign-in address, looked up when needed (needs KCP_FIREBASE_PROJECT_ID and roles/firebaseauth.viewer).
    if (env.KCP_PUSH_ENABLED === '1') {
      const project = env.KCP_FCM_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT;
      if (!project) throw new Error('KCP_FCM_PROJECT_ID is required when KCP_PUSH_ENABLED=1');
      const sender = deps.pushSender ?? new FcmSender(project, deps.token ?? (() => metadataAccessToken()));
      out.push = new PushService(db, sender, (message) => console.warn(message)); out.enabled.push('push');
    }
    const firebaseProject = env.KCP_FIREBASE_PROJECT_ID;
    const lookup = deps.firebaseUsers ?? (out.mailer && firebaseProject ? identityToolkitLookup(firebaseProject, deps.token ?? (() => metadataAccessToken()), fetch, (m) => console.warn(m)) : undefined);
    out.contacts = new NoticeContacts(db, lookup, (message) => console.warn(message));
    out.notices = new NoticeStore(db, noticeDelivery(out.push, mailNoticeDelivery(out.mailer, out.contacts.addressBook, out.contacts.wantsNoticeEmail).email), undefined, (message) => console.warn(message)); out.enabled.push('notices');
    if (out.push) {
      out.news = new NewsBroadcaster(db, { push: out.push, mailer: out.mailer, contacts: out.contacts, addressBook: out.contacts.addressBook, log: (m) => console.warn(m) });
      out.enabled.push('product-news');
    }
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
      out.safety = buildSafety(db);
      out.enabled.push('safety-reports');
      // The cloud photo store shares the UK bucket under projects/ (the 90-day rule covers galleries/ only).
      if (env.KCP_CLOUD_PHOTOS_ENABLED === '1') {
        const credits = Number(env.KCP_DOWNLOAD_CREDITS_PER_MONTH ?? 33);
        const downloads = new FirestoreUsageMeter(db);
        const maxGb = Number(env.KCP_CLOUD_PROJECT_MAX_GB ?? 50);
        out.cloudPhotos = {
          store: new CloudPhotoStore(db, bucket), meter: new BalanceBackedMeter(downloads, balance, () => randomUUID()),
          allowance: new RolloverAllowance(new FlatAllowance(Math.max(0, Math.round((Number.isFinite(credits) ? credits : 33) * 1000))), downloads),
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

/** The report queue for shared content (contentSafety.ts). InFlight does not scan photos. */
export function buildSafety(db: FirestoreLike) {
  return { service: new SafetyService(db) };
}
