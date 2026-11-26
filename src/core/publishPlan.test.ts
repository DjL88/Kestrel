import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BIOCLIP2, CLIP_TEXT, OPTIONAL_MODELS, RFDETR_NANO, type OptionalModel } from './optionalModels';
import { packFileUrlFromManifest } from './optionalModels';
import { checkBuildSettings, checkHosting, installerPlatform, planDownloads, planModelPacks, planPublish, type PublishInput } from './publishPlan';

const firebase = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8'));
const publicSite = JSON.parse(readFileSync(new URL('../../config/public-site.json', import.meta.url), 'utf8'));
const sha = (c: string) => c.repeat(64);
const goodEnv = {
  VITE_KESTREL_MODEL_BASE_URL: 'https://storage.googleapis.com/kestrel-hosting-kestrel-models',
  VITE_KESTREL_MODEL_KEYS: 'kestrel-2026-11=fRgITdAJPfCXpyEJ7DZml8316QBUgNlPsc3TPw07ZUw=',
  VITE_KESTREL_SITE_URL: 'https://inflight.studio',
};
const base = (over: Partial<PublishInput> = {}): PublishInput => ({
  project: 'kestrel-hosting', publicSite, firebase, modelVersion: '2026.11.26', buildEnv: goodEnv,
  commit: { sha: 'a0b25c7b'.padEnd(40, '0'), onMain: true, dirty: false }, ...over,
});

test('the committed firebase.json and public-site.json pass every hosting check', () => {
  const failed = checkHosting(base()).filter((c) => !c.ok);
  assert.deepEqual(failed, []);
});

test('hosting checks catch a wrong site, a stray service and an indexable preview', () => {
  const broken = structuredClone(firebase);
  broken.hosting.site = 'someone-else';
  broken.hosting.rewrites.push({ source: '/x', run: { serviceId: 'unknown', region: 'us-central1' } });
  broken.hosting.rewrites.push({ source: '**', destination: '/index.html' });
  broken.hosting.headers = broken.hosting.headers.filter((h: { source: string }) => h.source !== '/V2Proto/**');
  const failed = checkHosting(base({ firebase: broken })).filter((c) => !c.ok).map((c) => c.what).join('\n');
  assert.match(failed, /someone-else/);
  assert.match(failed, /rewrite\(s\) go somewhere other/);
  assert.match(failed, /catch-all/);
  assert.match(failed, /\/V2Proto\/\*\* \(staging preview\)/);
  assert.equal(checkHosting(base({ firebase: {} }))[0].ok, false);
});

test('installers are sorted onto the same platform cards as publish-gcp.ps1', () => {
  assert.equal(installerPlatform('InFlight_26.11.4_aarch64.dmg'), 'mac');
  assert.equal(installerPlatform('InFlight_26.11.4_x64-setup.exe'), 'windows');
  assert.equal(installerPlatform('InFlight_26.11.4_x64_en-GB.msi'), 'windows');
  assert.equal(installerPlatform('inflight.apk'), 'android');
  assert.equal(installerPlatform('notes.txt'), null);
});

test('downloads layout: release folder, SHA256SUMS and a latest.json preview', () => {
  const plan = planDownloads('kestrel-hosting', '26.11.4', [
    { name: 'InFlight_26.11.4_x64-setup.exe', bytes: 10, sha256: sha('b') },
    { name: 'InFlight_26.11.4_aarch64.dmg', bytes: 20, sha256: sha('a') },
  ]);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.objects.map((o) => o.path), [
    'releases/26.11.4/InFlight_26.11.4_aarch64.dmg', 'releases/26.11.4/InFlight_26.11.4_x64-setup.exe', 'releases/26.11.4/SHA256SUMS.txt', 'latest.json',
  ]);
  assert.equal(plan.objects[0].url, 'https://storage.googleapis.com/kestrel-hosting-kestrel-downloads/releases/26.11.4/InFlight_26.11.4_aarch64.dmg');
  assert.equal(plan.sha256sums, `${sha('a')}  InFlight_26.11.4_aarch64.dmg\n${sha('b')}  InFlight_26.11.4_x64-setup.exe\n`);
  assert.equal(plan.objects.at(-1)!.cacheControl, 'public, max-age=300');
  assert.equal((plan.latestPreview as { files: unknown[] }).files.length, 2);
});

test('downloads refuse store-only bundles, unknown files, unsafe names and a bad version', () => {
  const plan = planDownloads('kestrel-hosting', '26.11.4', [
    { name: 'app.aab', bytes: 1, sha256: sha('a') },
    { name: 'app.ipa', bytes: 1, sha256: sha('a') },
    { name: 'readme.txt', bytes: 1, sha256: sha('a') },
    { name: 'InFlight setup.exe', bytes: 1, sha256: sha('a') },
    { name: 'empty.dmg', bytes: 0, sha256: sha('a') },
  ]);
  assert.equal(plan.problems.length, 5);
  assert.deepEqual(plan.objects, []);
  assert.equal(plan.latestPreview, null);
  assert.match(planDownloads('kestrel-hosting', 'v26.11.4', [{ name: 'a.dmg', bytes: 1, sha256: sha('a') }]).problems[0], /not like 26\.11\.4/);
  assert.match(planDownloads('kestrel-hosting', undefined, []).notes[0], /No installers/);
});

test('every pinned pack gets the exact models-bucket address the signing script and the app use', () => {
  const { rows, problems } = planModelPacks('kestrel-hosting', '2026.11.26');
  assert.deepEqual(problems, []);
  const files = OPTIONAL_MODELS.reduce((n, m) => n + Object.keys(m.files).length, 0);
  assert.equal(rows.length, files);
  const rf = rows.find((r) => r.pack === RFDETR_NANO.id)!;
  assert.equal(rf.url, 'https://storage.googleapis.com/kestrel-hosting-kestrel-models/data/onnx/rfdetr-nano-fp16/2026.11.26/rfdetr-nano-fp16.onnx');
  assert.equal(rf.sha256, RFDETR_NANO.files.model.sha256);
  assert.equal(rf.status, 'ready');
  // The app resolves a manifest entry with this path to the same address.
  const manifest = { schema: 1 as const, revision: 1, assets: [{ id: rf.assetId, kind: 'onnx' as const, version: '2026.11.26', path: rf.url.replace('https://storage.googleapis.com/kestrel-hosting-kestrel-models', ''), bytes: rf.bytes, sha256: rf.sha256 }] };
  assert.equal(packFileUrlFromManifest(RFDETR_NANO, 'model', manifest, 'https://storage.googleapis.com/kestrel-hosting-kestrel-models'), rf.url);
});

test('packs with no pinned size are held, and files over the legacy limit need --allow-large', () => {
  const { rows } = planModelPacks('kestrel-hosting', '2026.11.26');
  for (const r of rows.filter((r) => r.pack === CLIP_TEXT.id)) assert.equal(r.status, CLIP_TEXT.files.model.bytes > 0 ? 'ready' : 'held');
  assert.equal(rows.find((r) => r.pack === BIOCLIP2.id && r.role === 'model')!.status, 'needs-allow-large');
  assert.equal(rows.find((r) => r.pack === BIOCLIP2.id && r.role === 'labels')!.status, 'ready');
});

test('a model version the app would refuse is reported', () => {
  assert.match(planModelPacks('kestrel-hosting', 'latest!')!.problems[0], /would refuse/);
});

test('release build settings must point at the models bucket with the pinned key', () => {
  assert.deepEqual(checkBuildSettings('kestrel-hosting', 'https://inflight.studio', goodEnv).filter((c) => !c.ok), []);
  const missing = checkBuildSettings('kestrel-hosting', 'https://inflight.studio', {});
  assert.equal(missing.filter((c) => !c.ok).length, 3);
  assert.equal(checkBuildSettings('kestrel-hosting', 'https://inflight.studio', { ...goodEnv, VITE_KESTREL_MODEL_KEYS: 'other=abc' })[1].ok, false);
});

test('a full plan lists problems, owner approvals and the commands without running anything', () => {
  const plan = planPublish(base({ version: '26.11.4', installers: [{ name: 'InFlight_26.11.4_aarch64.dmg', bytes: 20, sha256: sha('a') }] }));
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.buckets.downloads, 'kestrel-hosting-kestrel-downloads');
  assert.ok(plan.commands.some((c) => c.includes('-Installers InFlight_26.11.4_aarch64.dmg')));
  assert.ok(plan.commands.some((c) => c.includes('--allow-large')));
  assert.ok(plan.approvals.some((a) => /Say go/.test(a)));
  assert.ok(plan.approvals.some((a) => /BioCLIP 2/.test(a)));

  const bad = planPublish(base({ buildEnv: {}, commit: { sha: 'f'.repeat(40), onMain: false, dirty: true } }));
  assert.ok(bad.problems.some((p) => /not on origin\/main/.test(p)));
  assert.ok(bad.problems.some((p) => /uncommitted/.test(p)));
  assert.ok(bad.problems.some((p) => /VITE_KESTREL_MODEL_BASE_URL/.test(p)));
  assert.ok(planPublish(base({ commit: null })).problems.some((p) => /No git checkout/.test(p)));
});

test('local vision models are summarised from scripts/models/manifest.json, not mirrored', () => {
  const vision = JSON.parse(readFileSync(new URL('../../scripts/models/manifest.json', import.meta.url), 'utf8')).models;
  const plan = planPublish(base({ visionModels: vision }));
  const smol = plan.visionModels.find((v) => v.id === 'smolvlm2-500m')!;
  assert.equal(smol.revision, vision['smolvlm2-500m'].revision);
  assert.ok(smol.int8Bytes > 400e6 && smol.q4Bytes > 0);
  assert.ok(plan.notes.some((n) => /not in the models bucket/.test(n)));
});

test('a tiny custom pack list keeps working (the planner takes the packs it is given)', () => {
  const pack: OptionalModel = { ...RFDETR_NANO, id: 'tiny-test', files: { a: { url: '', sha256: sha('c'), bytes: 5, file: 'a.onnx' }, b: { url: '', sha256: sha('d'), bytes: 6, file: 'b.onnx' } } };
  const { rows } = planModelPacks('p-project', '1', [pack]);
  assert.deepEqual(rows.map((r) => r.assetId), ['tiny-test-a', 'tiny-test-b']);
});
