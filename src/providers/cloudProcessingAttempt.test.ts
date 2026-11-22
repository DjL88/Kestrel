import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudProcessingAttempt } from './cloudProcessingAttempt.ts';
import { decodeUpload, encodeResult } from './cloudJobCodec.ts';
import type { Pixels } from '../core/colourCheck';
import type { Mask } from '../core/maskTypes';

function flat(size: number, rgb: [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}

const radial = (id: string, edit: Mask['edit'] = {}): Mask =>
  ({ kind: 'radial', id, invert: false, feather: 0.3, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, edit });

/** A fixture control plane: a fetch implementation that runs one job through the exact lifecycle
 * `cloudJobTransport.ts`'s runCloudJob expects, and hands the uploaded bytes to `produceResult` to build
 * the response - standing in for the runner image that does not exist yet (see cloudProcessingAttempt.ts's
 * own doc comment on that). */
function fixtureControlPlane(produceResult: (uploadedBytes: Uint8Array) => Uint8Array) {
  const base = 'http://localhost:4010';
  let uploaded: Uint8Array | undefined;
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (method === 'POST' && url === `${base}/v1/cloud/jobs`) {
      return new Response(JSON.stringify({ jobId: 'job-1', uploadUrl: `https://storage.googleapis.com/kestrel-bucket/inputs/job-1?sig=abc`, expiresAtMs: Date.now() + 60_000 }), { status: 200 });
    }
    if (method === 'PUT' && url.startsWith('https://storage.googleapis.com/kestrel-bucket/inputs/job-1')) {
      uploaded = new Uint8Array(await (init!.body as Blob).arrayBuffer());
      return new Response(null, { status: 200 });
    }
    if (method === 'POST' && url === `${base}/v1/cloud/jobs/job-1/start`) {
      return new Response(JSON.stringify({ jobId: 'job-1', status: 'running' }), { status: 200 });
    }
    if (method === 'GET' && url === `${base}/v1/cloud/jobs/job-1`) {
      return new Response(JSON.stringify({
        jobId: 'job-1', status: 'ready', kind: decodeUpload(uploaded!).header.capability,
        resultUrl: `https://storage.googleapis.com/kestrel-bucket/results/job-1?sig=def`,
      }), { status: 200 });
    }
    if (method === 'GET' && url.startsWith('https://storage.googleapis.com/kestrel-bucket/results/job-1')) {
      return new Response(produceResult(uploaded!), { status: 200 });
    }
    if (method === 'POST' && url === `${base}/v1/cloud/jobs/job-1/finish`) {
      return new Response(JSON.stringify({ jobId: 'job-1', inputDeleted: true }), { status: 200 });
    }
    throw new Error(`Unexpected fixture request: ${method} ${url}`);
  };
  return { baseUrl: base, session: 'test-session', fetch: fetcher, calls };
}

describe('createCloudProcessingAttempt - denoise', () => {
  it('uploads the split strengths and original, verifies the downloaded result, and reports a subject mask', async () => {
    const original = flat(4, [100, 100, 100]);
    const connection = fixtureControlPlane((uploadedBytes) => {
      const { header } = decodeUpload(uploadedBytes);
      assert.equal(header.capability, 'denoise');
      assert.ok(header.backgroundDenoise! > 0);
      return encodeResult('denoise', flat(4, [101, 101, 101]));
    });
    const attempt = createCloudProcessingAttempt(connection, { online: true, signedIn: true, userConsent: true });
    const response = await attempt.run({
      capability: 'denoise',
      backgroundDenoise: 0.8,
      render: async () => original, // unused by the cloud path; present only because DenoiseActionInput requires it
      original,
    } as never);
    assert.equal(response.capability, 'denoise');
    const result = (response as { result: { verification: { ok: boolean }; attempts: number; edit: { denoise?: number } } }).result;
    assert.equal(result.verification.ok, true);
    assert.equal(result.attempts, 1);
    assert.ok(typeof result.edit.denoise === 'number');
  });
});

describe('createCloudProcessingAttempt - mask', () => {
  it('uploads the real mask list unchanged and reports it back verbatim on success', async () => {
    const original = flat(4, [50, 60, 70]);
    const masks = [radial('sky', { exposure: -0.3 })];
    const connection = fixtureControlPlane((uploadedBytes) => {
      const { header } = decodeUpload(uploadedBytes);
      assert.equal(header.capability, 'mask');
      assert.deepEqual(header.masks, masks);
      return encodeResult('mask', flat(4, [52, 58, 68]));
    });
    const attempt = createCloudProcessingAttempt(connection, { online: true, signedIn: true, userConsent: true });
    const response = await attempt.run({ capability: 'mask', masks, render: async () => original, original } as never);
    assert.equal(response.capability, 'mask');
    const result = (response as { result: { masks: Mask[]; verification: { ok: boolean } } }).result;
    assert.deepEqual(result.masks, masks);
    assert.equal(result.verification.ok, true);
  });

  it('reports verification.ok: false rather than throwing when the cloud result fails the local check', async () => {
    const original = flat(4, [50, 50, 50]);
    const masks = [radial('sky', { exposure: 1.9 })];
    const connection = fixtureControlPlane(() => encodeResult('mask', flat(4, [250, 250, 250])));
    const attempt = createCloudProcessingAttempt(connection, { online: true, signedIn: true, userConsent: true });
    const response = await attempt.run({ capability: 'mask', masks, render: async () => original, original } as never);
    const result = (response as { result: { verification: { ok: boolean } } }).result;
    assert.equal(result.verification.ok, false);
  });
});

describe('createCloudProcessingAttempt - upscale', () => {
  it('throws rather than fabricate a usedModel verdict for a capability it does not support', async () => {
    const connection = fixtureControlPlane(() => { throw new Error('should never be called'); });
    const attempt = createCloudProcessingAttempt(connection, { online: true, signedIn: true, userConsent: true });
    await assert.rejects(() => attempt.run({ capability: 'upscale', original: flat(2, [1, 1, 1]), scale: 2 } as never), /not implemented/);
  });
});
