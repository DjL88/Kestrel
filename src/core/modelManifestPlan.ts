/**
 * What goes into InFlight's one model manifest (`manifest/stable.json` in the models bucket, signed with the manifest
 * key `kestrel-2026-11` by scripts/release/sign-data-manifest.ts). Pure, so the signing script and its tests agree.
 *
 * - A file is published only if the app knows it: a model slot it can update (modelUpdatePolicy.ts), a file of an
 *   optional pack whose SHA-256 and size are pinned in optionalModels.ts, or a species list. Anything else is refused.
 * - Every asset carries a licence record, published beside the manifest (`manifest/licences.json`). There is no
 *   licence-free path: a file without one is refused, as the control plane's old model registry used to do.
 * - Optional packs are listed as `onnx` assets with their pack id. Installed apps parse them and skip them (they are not
 *   model slots), so the manifest format does not change.
 */
import { parseDataManifest, type DataAsset, type DataManifest } from './dataUpdateManifest';
import { MODEL_SLOTS, isModelSlot } from './modelUpdatePolicy';
import { OPTIONAL_MODELS, type OptionalModel } from './optionalModels';

export interface LicenceRecord { spdx: string; source: string }
export interface CandidateFile { name: string; bytes: number; sha256: string }
export interface PlannedAsset extends DataAsset { file: string; licence: LicenceRecord }

/** The models the app updates in place. Licences as recorded in docs/models.md. */
export const SLOT_LICENCES: Record<keyof typeof MODEL_SLOTS, LicenceRecord> = {
  'yolox-tiny': { spdx: 'Apache-2.0', source: 'https://github.com/Megvii-BaseDetection/YOLOX' },
  'u2netp': { spdx: 'Apache-2.0', source: 'https://github.com/xuebinqin/U-2-Net' },
  'bioclip-image-int8': { spdx: 'MIT', source: 'https://huggingface.co/imageomics/bioclip' },
  'clip-vit-b32-vision-uint8': { spdx: 'MIT', source: 'https://github.com/openai/CLIP' },
};

/** The manifest id of one file of an optional pack: the pack id, plus the file's role when the pack has several. */
export function packAssetId(model: OptionalModel, role: string): string {
  return Object.keys(model.files).length === 1 ? model.id : `${model.id}-${role}`;
}

const slug = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

export type PlanResult = { ok: true; assets: PlannedAsset[] } | { ok: false; problems: string[] };

/**
 * Decide the assets for one release. `models` are .onnx files (slot models by file name, optional pack files by their
 * pinned SHA-256); `species` are species lists (.json), published under the licence given for them.
 */
export function planManifestAssets(input: {
  version: string;
  models: readonly CandidateFile[];
  species?: readonly CandidateFile[];
  speciesLicence?: LicenceRecord;
  packs?: readonly OptionalModel[];
}): PlanResult {
  const packs = input.packs ?? OPTIONAL_MODELS;
  const problems: string[] = [];
  const assets: PlannedAsset[] = [];
  const pinned = new Map<string, { model: OptionalModel; role: string; bytes: number }>();
  for (const model of packs) for (const [role, file] of Object.entries(model.files)) pinned.set(file.sha256, { model, role, bytes: file.bytes });

  for (const file of [...input.models].sort((a, b) => a.name.localeCompare(b.name))) {
    const id = slug(file.name);
    const pack = pinned.get(file.sha256);
    if (isModelSlot(id)) {
      assets.push({ id, kind: 'onnx', version: input.version, path: `/data/onnx/${id}/${input.version}/${file.name}`, bytes: file.bytes, sha256: file.sha256, contract: MODEL_SLOTS[id].contract, file: file.name, licence: SLOT_LICENCES[id] });
    } else if (pack) {
      if (pack.bytes !== file.bytes) { problems.push(`${file.name}: matches the ${pack.model.name} digest but not its size (${file.bytes} bytes, pinned ${pack.bytes}).`); continue; }
      const packId = packAssetId(pack.model, pack.role);
      assets.push({ id: packId, kind: 'onnx', version: input.version, path: `/data/onnx/${packId}/${input.version}/${file.name}`, bytes: file.bytes, sha256: file.sha256, file: file.name, licence: { spdx: pack.model.licence, source: pack.model.source } });
    } else {
      problems.push(`${file.name}: not a model slot (${Object.keys(MODEL_SLOTS).join(', ')}) and not a file pinned in optionalModels.ts. A new model needs a new app release first.`);
    }
  }
  for (const file of [...(input.species ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!input.speciesLicence) { problems.push(`${file.name}: a species list needs its licence (--species-licence and --species-source).`); continue; }
    const id = `species-${slug(file.name)}`.slice(0, 64);
    assets.push({ id, kind: 'species-library', version: input.version, path: `/data/species/${id}/${input.version}/${file.name}`, bytes: file.bytes, sha256: file.sha256, file: file.name, licence: input.speciesLicence });
  }
  for (const pack of packs) {
    const missing = Object.keys(pack.files).filter((role) => !assets.some((a) => a.id === packAssetId(pack, role)));
    if (missing.length && missing.length < Object.keys(pack.files).length) problems.push(`${pack.name}: only part of the pack is here (missing ${missing.join(', ')}). Publish all of its files or none.`);
  }
  if (!assets.length && !problems.length) problems.push('Nothing to publish.');
  if (problems.length) return { ok: false, problems };
  return { ok: true, assets };
}

/** The manifest the app will parse, or null if the app would refuse it (checked before anything is signed). */
export function manifestFor(assets: readonly PlannedAsset[], revision: number): DataManifest | null {
  return parseDataManifest({ schema: 1, revision, assets: assets.map(({ file: _f, licence: _l, ...asset }) => asset) });
}

/** The human-readable licence list published beside the manifest. */
export function licenceList(assets: readonly PlannedAsset[]): Record<string, LicenceRecord & { version: string; sha256: string }> {
  return Object.fromEntries(assets.map((a) => [a.id, { ...a.licence, version: a.version, sha256: a.sha256 }]));
}
