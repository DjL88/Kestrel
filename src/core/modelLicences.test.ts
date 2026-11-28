/**
 * The model licence gate (owner policy, 28 Nov 2026). Scans everything the app ships or can download and fails unless
 * each model has an entry and verdict in models/licences.json. See src/core/modelLicences.ts for the rules.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checkNoticeFiles, checkScan, entryFor, renderNotices, validateEntries, type LicenceEntry, type LicenceRegistry, type ScannedModel } from './modelLicences.ts';

const root = join(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const registry = JSON.parse(read('models/licences.json')) as LicenceRegistry;

const MODEL_EXT = /\.(onnx|ort|gguf|safetensors|pt|pth|bin|tflite|pb|mlmodel|mlpackage|engine)$/i;
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'gen', 'dist', 'test', 'tests', 'fixtures']);

function walk(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  const full = join(root, dir);
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full)) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(path, keep, out); } else if (keep(path)) out.push(path);
  }
  return out;
}

/** Everything the repository ships or can download, by every route the app has. */
export function scanModels(): ScannedModel[] {
  const found: ScannedModel[] = [];
  const add = (name: string, kind: 'id' | 'file', where: string, defaultShipped: boolean) => found.push({ name, kind, found: where, defaultShipped });

  // 1. Files in the installer folders (always packed into every installer). Model files, and model-derived vector data.
  for (const path of walk('src/assets', (p) => MODEL_EXT.test(p) || /(^|\/)vectors\.json$/.test(p) || p.startsWith('src/assets/species/'))) add(path, 'file', path, true);
  for (const path of walk('public/models', () => true)) add(path, 'file', path, true);
  // 2. Native shell resources and the cloud runner must hold no model file the registry does not know.
  for (const path of [...walk('src-tauri', (p) => MODEL_EXT.test(p)), ...walk('services/cloud-runner', (p) => MODEL_EXT.test(p))]) add(path, 'file', path, true);
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json')) as { bundle?: { resources?: unknown } };
  const resources = tauri.bundle?.resources;
  for (const entry of Array.isArray(resources) ? resources : Object.keys((resources as object | undefined) ?? {})) if (typeof entry === 'string' && /model/i.test(entry)) add(entry, 'file', 'src-tauri/tauri.conf.json bundle.resources', true);

  // 3. The lists the desktop build fetches into the installer.
  for (const list of ['models/desktop-packs.json', 'models/bundled-models.json']) {
    for (const file of (JSON.parse(read(list)) as { files: { file: string; pack?: string }[] }).files) {
      add(file.file, 'file', list, true);
      if (file.pack) add(file.pack, 'id', list, true);
    }
  }

  // 4. Downloads: optional packs, the catalogue, update slots and the code that names a model id.
  const optional = read('src/core/optionalModels.ts');
  for (const m of optional.matchAll(/^\s{2}id: '([^']+)'/gm)) add(m[1], 'id', 'src/core/optionalModels.ts', false);
  for (const m of optional.matchAll(/pinned\('[A-Z0-9_]+',\s*'([^']+)'/g)) add(m[1], 'file', 'src/core/optionalModels.ts', false);
  for (const m of read('src/providers/modelCatalogue.ts').matchAll(/\bid: '([^']+)'/g)) add(m[1], 'id', 'src/providers/modelCatalogue.ts', false);
  const slots = /MODEL_SLOTS = \{([\s\S]*?)\} as const/.exec(read('src/core/modelUpdatePolicy.ts'))?.[1] ?? '';
  for (const m of slots.matchAll(/^\s*'([^']+)':/gm)) add(m[1], 'id', 'src/core/modelUpdatePolicy.ts MODEL_SLOTS (modelUpdater)', false);
  for (const [path, re] of [['src/core/photoCheckPack.ts', /name: '([^']+)'/], ['src/core/localVisionMetrics.ts', /LOCAL_VISION_ID = '([^']+)'/], ['src/core/visualSimilarity.ts', /EMBED_MODEL = \{\s*id: '([^']+)'/],
    ['src/providers/markingReader.ts', /\bid: '([^']+)'/]] as const) {
    const id = re.exec(read(path))?.[1];
    assert.ok(id, `The licence gate could not find the model id in ${path}. Update scanModels() in src/core/modelLicences.test.ts.`);
    add(id, 'id', path, false);
  }

  // 5. The model scripts manifest (tooling and vision lab).
  for (const id of Object.keys((JSON.parse(read('scripts/models/manifest.json')) as { models: Record<string, unknown> }).models)) add(id, 'id', 'scripts/models/manifest.json', false);
  return found;
}

const today = new Date().toISOString().slice(0, 10);
const fail = (heading: string, problems: string[]) => assert.equal(problems.length, 0, `${heading}\n  - ${problems.join('\n  - ')}`);

test('licence registry: every entry has a verdict, reason, source, review date and notice', () => {
  assert.ok(registry.models.length > 0, 'models/licences.json has no models');
  fail('models/licences.json is incomplete:', validateEntries(registry, today));
});

test('licence gate: every model the app ships or can download has a registry entry', () => {
  const scanned = scanModels();
  assert.ok(scanned.length > 20, `The scanner found only ${scanned.length} models; it is probably broken.`);
  const missing = checkScan(registry, scanned).filter((p) => p.startsWith('No licence entry'));
  fail('Models without a licence entry:', missing);
});

test('licence gate: no RED model is carried by a default installer or default-on build', () => {
  const redInInstaller = checkScan(registry, scanModels()).filter((p) => !p.startsWith('No licence entry'));
  fail('RED models still ship by default (the owner policy forbids it; see docs/notices/THIRD-PARTY-MODELS.md):', redInInstaller);
});

test('licence gate: notice files exist and the generated notices page is current', () => {
  fail('Missing notice files:', checkNoticeFiles(registry, (path) => existsSync(join(root, path))));
  assert.equal(read('docs/notices/THIRD-PARTY-MODELS.md'), renderNotices(registry), 'docs/notices/THIRD-PARTY-MODELS.md is out of date. Run `npm run models:notices` and commit it.');
});

test('licence gate: the AMBER models are all listed in the generated notices', () => {
  const page = read('docs/notices/THIRD-PARTY-MODELS.md');
  for (const entry of registry.models.filter((m: LicenceEntry) => m.verdict === 'amber' || m.verdict === 'red')) assert.ok(page.includes(entry.name), `${entry.name} is missing from docs/notices/THIRD-PARTY-MODELS.md. Run \`npm run models:notices\`.`);
});

test('licence gate: the failure messages name what to fix (unit)', () => {
  const entry = (patch: Partial<LicenceEntry>): LicenceEntry => ({ id: 'x', name: 'X', ids: ['x'], files: ['x.onnx'], feature: 'f', where: 'installer', shipDefault: false, codeLicence: 'MIT', weightsLicence: 'MIT', trainingData: 't',
    verdict: 'green', reason: 'r', sources: ['https://example.test'], reviewed: '2026-11-28', notice: 'MIT', ...patch });
  const reg = (...models: LicenceEntry[]): LicenceRegistry => ({ schema: 1, policy: 'p', models });
  const unknown = checkScan(reg(entry({})), [{ name: 'mystery.onnx', kind: 'file', found: 'models/desktop-packs.json', defaultShipped: true }]);
  assert.match(unknown[0], /No licence entry for file "mystery\.onnx".*models\/licences\.json/);
  const red = checkScan(reg(entry({ verdict: 'red' })), [{ name: 'x.onnx', kind: 'file', found: 'models/desktop-packs.json', defaultShipped: true }]);
  assert.match(red[0], /RED model "x" is in a default installer/);
  assert.match(checkScan(reg(entry({ verdict: 'red', shipDefault: true })), []).join('\n'), /RED model "x".*shipDefault true/);
  assert.match(validateEntries(reg(entry({ reviewed: '' })), today).join('\n'), /"reviewed" must be a date/);
  assert.match(validateEntries(reg(entry({ sources: [] })), today).join('\n'), /"sources" needs at least one/);
  assert.match(checkScan(reg(entry({ shipDefault: false })), [{ name: 'x.onnx', kind: 'file', found: 'src/assets/models/x.onnx', defaultShipped: true }])[0], /says shipDefault:false but/);
  assert.equal(entryFor(reg(entry({ files: ['bioclip2-*.json'] })), { name: 'bioclip2-mammals.json', kind: 'file' })?.id, 'x');
});
