/**
 * Build and sign InFlight's one model manifest for the models bucket.
 *
 *   npx tsx scripts/release/sign-data-manifest.ts --dir <folder of .onnx files> --version 2026.11.25 --revision 3 --out out/models \
 *     [--species <folder of species lists (.json)> --species-licence CC-BY-4.0 --species-source https://...] [--allow-large]
 *
 * Needs KESTREL_SIGNING_KEY_PEM (Ed25519, PKCS#8) and KESTREL_SIGNING_KEY_ID (kestrel-2026-11) in the environment, from
 *   gcloud secrets versions access latest --secret=kestrel-manifest-signing-key
 * This is the only model manifest and the only key that signs it: the app pins its public half
 * (VITE_KESTREL_MODEL_KEYS) and the control plane checks it before serving it at /v1/models/manifest (KCP_MODEL_KEYS).
 * The control plane's own key (kcp-2026-11) signs grants and flags, never models.
 *
 * `--dir` may hold the app's slot models (by file name) and the files of optional packs (matched by the SHA-256 pinned
 * in src/core/optionalModels.ts). What goes in, and the licence each needs, is decided by src/core/modelManifestPlan.ts;
 * anything it would refuse stops the script before signing. Writes <out>/data/... (copies of the files),
 * <out>/manifest/stable.json and <out>/manifest/licences.json, laid out exactly as they go in the bucket. Nothing is
 * uploaded here; publish-gcp.ps1 does that.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { loadSigningKey, signEnvelope } from '../../services/control-plane/src/crypto.ts';
import { licenceList, manifestFor, planManifestAssets, type CandidateFile } from '../../src/core/modelManifestPlan.ts';
import { readGit, resolveProvenance } from '../build-provenance.mjs';

function arg(name: string, optional = false): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value && !optional) throw new Error(`Missing --${name}`);
  return value;
}

const dir = arg('dir')!;
const version = arg('version')!;
const revision = Number(arg('revision'));
const out = arg('out')!;
const speciesDir = arg('species', true);
const speciesSpdx = arg('species-licence', true);
const speciesSource = arg('species-source', true);
const allowLarge = process.argv.includes('--allow-large');
const pem = process.env.KESTREL_SIGNING_KEY_PEM;
const keyId = process.env.KESTREL_SIGNING_KEY_ID;
if (!pem || !keyId) throw new Error('Set KESTREL_SIGNING_KEY_PEM and KESTREL_SIGNING_KEY_ID (never commit the key).');
// Model packs are released from the same clean commit as the app (G10): refuse an unknown commit or a changed tree before
// anything is signed, and write manifest/build-info.json for scripts/check-release-parity.mjs. The signed manifest's own
// schema is unchanged, so installed apps keep accepting it.
const provenance = resolveProvenance({ env: { ...process.env, KESTREL_RELEASE: '1' }, git: readGit(process.cwd()), target: 'models' });
if (!Number.isInteger(revision) || revision < 1) throw new Error('--revision must be a whole number of 1 or more, higher than the last one published.');

const read = (folder: string, ext: string): (CandidateFile & { full: string })[] => readdirSync(folder).filter((name) => extname(name) === ext).map((name) => {
  const full = join(folder, name);
  return { name, full, bytes: statSync(full).size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') };
});
const models = read(dir, '.onnx');
const species = speciesDir ? read(speciesDir, '.json') : [];
const plan = planManifestAssets({
  version, models, species, allowLarge,
  ...(speciesSpdx && speciesSource ? { speciesLicence: { spdx: speciesSpdx, source: speciesSource } } : {}),
});
if (!plan.ok) throw new Error(`Not signed:\n- ${plan.problems.join('\n- ')}`);

const manifest = manifestFor(plan.assets, revision);
if (!manifest) throw new Error('The app would refuse this manifest (check ids, version, paths and sizes).');
const sources = new Map([...models, ...species].map((f) => [f.sha256, f.full]));
for (const asset of plan.assets) {
  const target = join(out, asset.path);
  mkdirSync(join(target, '..'), { recursive: true });
  copyFileSync(sources.get(asset.sha256)!, target);
}
const envelope = signEnvelope(manifest, loadSigningKey(keyId, pem));
mkdirSync(join(out, 'manifest'), { recursive: true });
writeFileSync(join(out, 'manifest', 'stable.json'), `${JSON.stringify(envelope, null, 2)}\n`);
writeFileSync(join(out, 'manifest', 'licences.json'), `${JSON.stringify({ revision, keyId, licences: licenceList(plan.assets) }, null, 2)}\n`);
writeFileSync(join(out, 'manifest', 'build-info.json'), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Signed ${plan.assets.length} asset(s) (${plan.assets.map((a) => a.id).join(', ')}), revision ${revision}, key ${keyId}. Folder ready to upload: ${out}`);
