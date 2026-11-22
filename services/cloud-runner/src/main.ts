import { runJob, type RunnerStore } from './run.ts';

interface BucketLike { file(name: string): { download(): Promise<[Uint8Array]>; save(data: Uint8Array): Promise<unknown> } }

async function main() {
  const bucketName = process.env.KCR_INPUT_BUCKET, jobId = process.env.KCR_JOB_ID, kind = process.env.KCR_KIND;
  if (!bucketName || !jobId || !kind) { console.error('Runner not configured.'); process.exit(2); }
  const moduleName = '@google-cloud/storage';
  const { Storage } = (await import(moduleName)) as { Storage: new () => { bucket(n: string): BucketLike } };
  const bucket = new Storage().bucket(bucketName);
  const store: RunnerStore = {
    read: async (name) => (await bucket.file(name).download())[0],
    write: async (name, bytes) => { await bucket.file(name).save(bytes); },
  };
  const ok = await runJob(store, jobId, kind);
  console.log(ok ? 'job finished' : 'job failed'); // never the id, kind, sizes or error text
  process.exit(ok ? 0 : 1);
}
main().catch(() => { console.error('runner error'); process.exit(1); });
