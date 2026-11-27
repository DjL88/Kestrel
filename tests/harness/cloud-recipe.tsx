/**
 * Mounts the real Co-pilot "Cloud edit settings" card with the real offer, consent, transport and recipe checks, against
 * an in-page stand-in for the control plane's /v1/cloud/jobs routes and its private bucket. The stand-in runs the real
 * runner maths (services/cloud-runner/src/process.ts) on what was uploaded, deletes the input when the job ends and the
 * result at finish, as the control plane does. Served only by the Vite dev server for tests/v2-dev-cloud-recipe.spec.ts.
 *
 * Query: ?quota=0 refuses with CLOUD_QUOTA_EXHAUSTED (month used up, no balance); ?fail=1 makes the runner fail.
 * The picture is synthetic: a gradient drawn here, never a real photo.
 */
import '../../src/index.css';
import '../../src/v2/ui/v2.css';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CloudRecipeCard from '../../src/v2/ui/panels/CloudRecipeCard';
import { prepareCloudRecipe, sendCloudRecipe, cloudRecipeEdit } from '../../src/v2/engineClient/runCloudRecipe';
import { httpCloudRecipeService } from '../../src/providers/cloudRecipeService';
import { readCloudConsent, saveCloudConsent } from '../../src/providers/cloudConsent';
import { previewCopyForCloud } from '../../src/providers/recipePreviewCopy';
import { FULL_FILE_CONSENT_OFF } from '../../src/core/cloudRecipe';
import { processRecipeJob } from '../../services/cloud-runner/src/process';
import type { PhotoFrame } from '../../src/core/types';
import type { CloudRecipeOfferView, CloudRecipeResultView } from '../../src/v2/ui/contract';
import { cloudRecipeChanges } from '../../src/v2/engineClient/cloudRecipeChanges';
import { editToRecipe } from '../../src/v2/engineClient/recipeMap';
import { STRINGS } from '../../src/v2/ui/strings';

const params = new URLSearchParams(location.search);
const BASE = 'https://cp.inflight.test';
const BUCKET = 'kestrel-cloud-inputs-test';
type Job = { status: 'awaiting-upload' | 'running' | 'ready' | 'failed' | 'finished'; inputKind: string };
const jobs = new Map<string, Job>();
const objects = new Map<string, Uint8Array>();
const log: string[] = [];
let next = 0;
(window as unknown as { cloud: unknown }).cloud = { log, objects, jobs };

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refuse = (status: number, code: string) => reply(status, { error: { code, message: 'server words' } });

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  log.push(`${method} ${url.origin === BASE ? url.pathname : url.pathname.replace(`/${BUCKET}/`, 'bucket:')}`);
  if (url.origin === 'https://storage.googleapis.com') {
    const key = url.pathname.slice(`/${BUCKET}/`.length);
    if (method === 'PUT') { objects.set(key, new Uint8Array(await new Response(init!.body as BodyInit).arrayBuffer())); return new Response(null, { status: 200 }); }
    const bytes = objects.get(key);
    return bytes ? new Response(new Blob([bytes as BlobPart]), { status: 200 }) : new Response(null, { status: 404 });
  }
  if ((init?.headers as Record<string, string>)?.authorization !== 'Bearer test-session') return refuse(401, 'AUTH_TOKEN_INVALID');
  const path = url.pathname;
  if (path === '/v1/cloud/jobs' && method === 'POST') {
    const body = JSON.parse(String(init!.body)) as { userConsent?: boolean; inputKind?: string };
    if (body.userConsent !== true) return refuse(400, 'CONSENT_REQUIRED');
    if (params.get('quota') === '0') return refuse(429, 'CLOUD_QUOTA_EXHAUSTED');
    const jobId = `job-${++next}`;
    jobs.set(jobId, { status: 'awaiting-upload', inputKind: body.inputKind ?? '' });
    return reply(200, { jobId, uploadUrl: `https://storage.googleapis.com/${BUCKET}/inputs/${jobId}?X-Goog-Signature=test`, expiresAtMs: Date.now() + 900_000 });
  }
  const match = /^\/v1\/cloud\/jobs\/([a-z0-9-]+)(\/start|\/finish)?$/.exec(path);
  const job = match ? jobs.get(match[1]!) : undefined;
  if (!match || !job) return refuse(404, 'NOT_FOUND');
  const jobId = match[1]!;
  if (match[2] === '/start') {
    if (!objects.has(`inputs/${jobId}`)) return refuse(409, 'CLOUD_INPUT_MISSING');
    job.status = 'running';
    // The runner, as a Cloud Run job would: the real maths on the uploaded JPEG, a result file or an empty failed marker.
    setTimeout(() => {
      try {
        if (params.get('fail') === '1') throw new Error('runner failed');
        objects.set(`results/${jobId}`, processRecipeJob(objects.get(`inputs/${jobId}`)!, jobId, job.inputKind as 'smart-preview'));
      } catch { objects.set(`failed/${jobId}`, new Uint8Array(0)); }
    }, 50);
    return reply(200, { jobId, status: 'running' });
  }
  if (match[2] === '/finish') {
    job.status = 'finished';
    for (const prefix of ['inputs', 'results', 'failed']) objects.delete(`${prefix}/${jobId}`);
    return reply(200, { jobId, inputDeleted: true });
  }
  // Status: the control plane deletes the input as soon as the job has ended.
  if (job.status === 'running' && (objects.has(`results/${jobId}`) || objects.has(`failed/${jobId}`))) {
    objects.delete(`inputs/${jobId}`);
    job.status = objects.has(`results/${jobId}`) ? 'ready' : 'failed';
  }
  return reply(200, { jobId, kind: 'recipe', status: job.status,
    ...(job.status === 'ready' ? { resultUrl: `https://storage.googleapis.com/${BUCKET}/results/${jobId}?X-Goog-Signature=test` } : {}),
    ...(job.status === 'failed' ? { failure: 'CLOUD_JOB_FAILED' } : {}) });
};

/** A synthetic 4,000 × 3,000 picture: a dim, cool gradient the recipe maths has something to say about. */
async function syntheticPhoto(): Promise<Blob> {
  const canvas = new OffscreenCanvas(4000, 3000);
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 4000, 3000);
  g.addColorStop(0, '#0a1430'); g.addColorStop(1, '#3a4a6a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4000, 3000);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

const frame = { id: 'p1', stableKey: 'k1', filename: 'synthetic.jpg', exif: { width: 4000, height: 3000 } } as unknown as PhotoFrame;

function Harness() {
  const [applied, setApplied] = useState('');
  const [previewing, setPreviewing] = useState('');
  const held = useMemo(() => ({ current: null as Awaited<ReturnType<typeof prepareCloudRecipe>> | null }), []);
  const prepare = async (): Promise<CloudRecipeOfferView> => {
    held.current = await prepareCloudRecipe(frame, {
      smartPreview: async () => null,
      ensureOriginal: async () => undefined,
      previewCopy: async () => previewCopyForCloud(await syntheticPhoto()),
    }, FULL_FILE_CONSENT_OFF);
    const { offer } = held.current;
    return offer.plan.status === 'ready' ? { status: 'ready', sendLabel: offer.sendLabel } : { status: 'unavailable', message: 'Nothing to send.' };
  };
  const send = async (_: string, choice: 'send' | 'alternative'): Promise<CloudRecipeResultView> => {
    if (!held.current) throw new Error('Check the photo again before sending.');
    if (readCloudConsent().answer !== 'yes') throw new Error('Say yes first.');
    const outcome = await sendCloudRecipe(held.current, choice, FULL_FILE_CONSENT_OFF,
      httpCloudRecipeService({ baseUrl: BASE, session: 'test-session', fetch: fakeFetch, pollIntervalMs: 20 }));
    if (outcome.status !== 'ready') return { message: outcome.status === 'empty' ? 'The cloud suggested no changes for this photo.' : 'Refused.' };
    // As the workspace does (useEngineWorkspace.ts): what changed against the photo's settings, in plain words.
    const changes = cloudRecipeChanges(editToRecipe(undefined), outcome.recipe.settings, STRINGS.history.sliders);
    if (!changes.lines.length) return { message: 'The cloud suggested no changes for this photo.' };
    setApplied(JSON.stringify({ edit: cloudRecipeEdit(undefined, outcome.recipe), inputDeleted: outcome.inputDeleted === true }));
    return { message: 'Applied the cloud\'s edit settings. Undo takes them back.', changes: changes.lines, before: changes.before };
  };
  return (
    <div className="inflight-v2" style={{ maxWidth: 360, padding: 16 }}>
      <CloudRecipeCard photoId="p1" onPrepare={prepare} onSend={send} onSetFullFile={() => false} fullFileOn={() => false}
        consent={() => readCloudConsent().answer} onSetConsent={(a) => saveCloudConsent(a).answer}
        onTopUp={() => setApplied('top-up opened')}
        onPreview={(delta) => setPreviewing(delta ? JSON.stringify(delta) : '')} />
      <pre data-testid="applied">{applied}</pre>
      <pre data-testid="previewing">{previewing}</pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
