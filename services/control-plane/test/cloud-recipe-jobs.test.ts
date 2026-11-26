import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCloudLedger, MemoryCloudRunner, type CloudKind, type RecipeInputKind } from '../src/cloudJobs.ts';
import { startHarness } from './helpers.ts';

class RecordingRunner extends MemoryCloudRunner {
  started: { kind: CloudKind; inputKind?: RecipeInputKind }[] = [];
  async start(jobId: string, kind?: CloudKind, inputKind?: RecipeInputKind) {
    await super.start(jobId);
    this.started.push({ kind: kind!, ...(inputKind ? { inputKind } : {}) });
  }
}

async function setup(t: TestContext, recipeEnabled: boolean) {
  const runner = new RecordingRunner();
  const ledger = new MemoryCloudLedger();
  const server = await startHarness(null, undefined, { cloud: { runner, ledger, jobsPerPeriod: 5, maxInputBytes: 50_000_000, recipe: { enabled: recipeEnabled, maxPreviewBytes: 10_000_000 } } });
  t.after(() => server.close());
  const post = (path: string, body?: unknown) => fetch(server.url + path, {
    method: 'POST', headers: { authorization: `Bearer ${server.user.token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { runner, ledger, post };
}

test('recipe jobs are refused while their switch is off, and nothing is reserved or uploaded', async (t) => {
  const { runner, post } = await setup(t, false);
  const response = await post('/v1/cloud/jobs', { kind: 'recipe', inputBytes: 1_400_000, userConsent: true, inputKind: 'smart-preview' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'CLOUD_RECIPE_DISABLED');
  assert.equal(runner.uploadsCreated, 0);
});

test('a recipe job records which picture it carries and passes it to the runner', async (t) => {
  const { runner, ledger, post } = await setup(t, true);
  const created = await post('/v1/cloud/jobs', { kind: 'recipe', inputBytes: 1_400_000, userConsent: true, inputKind: 'smart-preview' });
  assert.equal(created.status, 200);
  const { jobId } = await created.json();
  assert.equal((await ledger.get(jobId))?.inputKind, 'smart-preview');
  runner.simulateUpload(jobId);
  assert.equal((await post(`/v1/cloud/jobs/${jobId}/start`)).status, 200);
  assert.deepEqual(runner.started, [{ kind: 'recipe', inputKind: 'smart-preview' }]);
  assert.equal((await post(`/v1/cloud/jobs/${jobId}/finish`)).status, 200);
  assert.equal(runner.hasInput(jobId), false, 'the upload is deleted when the job ends');
});

test('recipe jobs must say what they carry, a smart preview has a size cap, and other kinds cannot claim one', async (t) => {
  const { post } = await setup(t, true);
  const code = async (response: Response) => [response.status, (await response.json()).error?.code];
  assert.deepEqual(await code(await post('/v1/cloud/jobs', { kind: 'recipe', inputBytes: 10, userConsent: true })), [400, 'CLOUD_RECIPE_INPUT_KIND']);
  assert.deepEqual(await code(await post('/v1/cloud/jobs', { kind: 'recipe', inputBytes: 20_000_000, userConsent: true, inputKind: 'smart-preview' })), [413, 'CLOUD_INPUT_TOO_LARGE']);
  assert.deepEqual(await code(await post('/v1/cloud/jobs', { kind: 'denoise', inputBytes: 10, userConsent: true, inputKind: 'original' })), [400, 'CLOUD_RECIPE_INPUT_KIND']);
  const original = await post('/v1/cloud/jobs', { kind: 'recipe', inputBytes: 20_000_000, userConsent: true, inputKind: 'original' });
  assert.equal(original.status, 200, 'a full original (with the person\'s opt-in) is held to the general input cap only');
});

test('end to end against fakes: app client → control plane → runner → a recipe the app applies', async (t) => {
  const { httpCloudRecipeService } = await import('../../../src/providers/cloudRecipeService.ts');
  const { parseCloudRecipe } = await import('../../../src/core/cloudRecipe.ts');
  const { runJob } = await import('../../cloud-runner/src/run.ts');
  const jpeg = (await import('jpeg-js')).default;
  const STORAGE = 'https://storage.googleapis.com', BUCKET = 'inflight-fixture';
  const objects = new Map<string, Uint8Array>();
  class BucketRunner extends RecordingRunner {
    async createUpload(id: string) { await super.createUpload(id); return { uploadUrl: `${STORAGE}/${BUCKET}/inputs/${id}?sig=1`, expiresAtMs: Date.now() + 60_000 }; }
    async start(jobId: string, kind?: CloudKind, inputKind?: RecipeInputKind) {
      await super.start(jobId, kind, inputKind);
      const ok = await runJob({ read: async (name) => objects.get(name)!, write: async (name, bytes) => { objects.set(name, bytes); } }, jobId, kind!, undefined, inputKind);
      if (ok) this.completeJob(jobId); else this.failJob(jobId, 'runner');
    }
    async poll(id: string) {
      const status = await super.poll(id);
      return status.state === 'ready' ? { state: 'ready' as const, resultUrl: `${STORAGE}/${BUCKET}/results/${id}?sig=2` } : status;
    }
    async deleteInput(id: string) { await super.deleteInput(id); objects.delete(`inputs/${id}`); }
  }
  const runner = new BucketRunner();
  const server = await startHarness(null, undefined, { cloud: { runner, ledger: new MemoryCloudLedger(), jobsPerPeriod: 5, maxInputBytes: 50_000_000, recipe: { enabled: true, maxPreviewBytes: 10_000_000 } } });
  t.after(() => server.close());
  const fetcher: typeof fetch = async (url, init) => {
    const address = new URL(String(url));
    if (address.origin === server.url) return fetch(url, init);
    const name = address.pathname.replace(`/${BUCKET}/`, '');
    if (init?.method === 'PUT') {
      objects.set(name, new Uint8Array(await (init.body as Blob).arrayBuffer()));
      runner.simulateUpload(name.replace('inputs/', ''));
      return new Response(null, { status: 200 });
    }
    return new Response(objects.get(name) as BodyInit);
  };
  const width = 320, height = 200, data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { const v = 30 + ((i / 4) % width) / 10; data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255; }
  const preview = new Blob([jpeg.encode({ data, width, height }, 90).data]);
  const service = httpCloudRecipeService({ baseUrl: server.url, session: server.user.token, fetch: fetcher, pollIntervalMs: 1 });
  const answer = await service.run({ input: preview, inputKind: 'smart-preview', userConsent: true });
  const recipe = parseCloudRecipe(answer.bytes, { jobId: answer.jobId, input: 'smart-preview' });
  assert.ok(recipe, 'the app accepts what the runner made');
  assert.deepEqual(runner.started, [{ kind: 'recipe', inputKind: 'smart-preview' }]);
  assert.equal([...objects.keys()].some((key) => key.startsWith('inputs/')), false, 'the uploaded preview is deleted after the job');
});
