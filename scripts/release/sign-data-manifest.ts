/**
 * Build and sign the model manifest for the models bucket.
 *
 *   npx tsx scripts/release/sign-data-manifest.ts --dir <folder of .onnx files> --version 2026.11.20 --revision 3 --out out/models
 *
 * Needs KESTREL_SIGNING_KEY_PEM (Ed25519, PKCS#8) and KESTREL_SIGNING_KEY_ID in the environment, for example from
 *   gcloud secrets versions access latest --secret=kestrel-manifest-signing-key
 * Writes <out>/data/onnx/<id>/<version>/<file> (copies of the files) and <out>/manifest/stable.json, laid out exactly as
 * they go in the bucket. The manifest is checked with the app's own parser before signing, so the script can never
 * publish something the app would refuse. Nothing is uploaded here; publish-gcp.ps1 does that.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseDataManifest, type DataAsset } from '../../src/core/dataUpdateManifest.ts';
import { loadSigningKey, signEnvelope } from '../../services/control-plane/src/crypto.ts';

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const dir = arg('dir');
const version = arg('version');
const revision = Number(arg('revision'));
const out = arg('out');
const pem = process.env.KESTREL_SIGNING_KEY_PEM;
const keyId = process.env.KESTREL_SIGNING_KEY_ID;
if (!pem || !keyId) throw new Error('Set KESTREL_SIGNING_KEY_PEM and KESTREL_SIGNING_KEY_ID (never commit the key).');
if (!Number.isInteger(revision) || revision < 1) throw new Error('--revision must be a whole number of 1 or more, higher than the last one published.');

const assets: DataAsset[] = readdirSync(dir).filter((name) => extname(name) === '.onnx').sort().map((name) => {
  const file = join(dir, name);
  const bytes = readFileSync(file);
  const id = basename(name, '.onnx').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const path = `/data/onnx/${id}/${version}/${name}`;
  const target = join(out, path);
  mkdirSync(join(target, '..'), { recursive: true });
  copyFileSync(file, target);
  return { id, kind: 'onnx', version, path, bytes: statSync(file).size, sha256: createHash('sha256').update(bytes).digest('hex') };
});
if (!assets.length) throw new Error(`No .onnx files in ${dir}`);

const manifest = parseDataManifest({ schema: 1, revision, assets });
if (!manifest) throw new Error('The app would refuse this manifest (check ids, version, paths and sizes).');
const envelope = signEnvelope(manifest, loadSigningKey(keyId, pem));
mkdirSync(join(out, 'manifest'), { recursive: true });
writeFileSync(join(out, 'manifest', 'stable.json'), `${JSON.stringify(envelope, null, 2)}\n`);
console.log(`Signed ${assets.length} model(s), revision ${revision}, key ${keyId}. Folder ready to upload: ${out}`);
