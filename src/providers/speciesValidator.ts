import { BIOCLIP2, optionalModelFitsDevice } from '../core/optionalModels';
import { SPECIES_MODEL, preprocessSpecies } from '../core/speciesModel';
import { decodeVector, normalise, rankSpecies, type SpeciesLabel } from '../core/speciesMatch';
import { readSpeciesRegions, worldLabelsForRegions } from '../core/speciesRegions';
import { checkGroupLabels, checkValidatorLabels, compareSpecies, groupFileNames, type SpeciesVerdict, type ValidatorLabels } from '../core/speciesValidator';
import type { SquareCrop } from '../core/subjectCrop';
import { friendlyToolError } from '../core/toolErrors';
import { isDesktopApp, isMobileShell } from './desktopShell';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type OptionalModelStatus } from './optionalModels';

/**
 * BioCLIP 2 species validator on the desktop (about 0.62 GB with its names; never offered on a phone or in a browser tab). It looks at
 * the same square crop BioCLIP used and ranks the same names, then `compareSpecies` says whether it agrees. Without
 * the pack, species suggestions work exactly as before, with no second opinion.
 */
type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession; labels: ValidatorLabels; groups: SpeciesLabel[][] }
let loading: Promise<Loaded> | null = null;

const offeredHere = () => optionalModelFitsDevice(BIOCLIP2, isDesktopApp() && !isMobileShell() ? 'desktop' : 'phone');

export async function validatorStatus(): Promise<OptionalModelStatus> {
  return offeredHere() ? optionalModelStatus(BIOCLIP2) : 'unavailable';
}
export async function downloadValidator(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  if (!offeredHere()) throw new Error(`${BIOCLIP2.name} is offered in the desktop app only.`);
  await downloadOptionalModel(BIOCLIP2, onProgress, signal);
}
export async function removeValidator(): Promise<void> { loading = null; await removeOptionalModel(BIOCLIP2); }

function load(): Promise<Loaded> {
  loading ??= (async () => {
    // Every extra group of names in the pack (mammals, reptiles, ...) is read and checked the same way.
    const [model, labelBytes, ...groupBytes] = await Promise.all([
      readOptionalModelFile(BIOCLIP2, 'model'), readOptionalModelFile(BIOCLIP2, 'labels'),
      ...groupFileNames(BIOCLIP2.files).map((name) => readOptionalModelFile(BIOCLIP2, name)),
    ]);
    const text = new TextDecoder();
    const labels = checkValidatorLabels(JSON.parse(text.decode(labelBytes)));
    const groups = groupBytes.map((bytes) => checkGroupLabels(JSON.parse(text.decode(bytes))));
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    return { ort, session, labels, groups };
  })().catch((error) => {
    loading = null;
    console.warn('Species validator failed to load', error);
    throw new Error(friendlyToolError(error, 'species validator'));
  });
  return loading;
}

let vectorsKey = '';
let ranked: { labels: SpeciesLabel[]; vectors: Float32Array[] } | null = null;

function namesFor(labels: ValidatorLabels, groups: readonly (readonly SpeciesLabel[])[]) {
  const regions = readSpeciesRegions();
  const key = regions.join(',');
  if (!ranked || vectorsKey !== key) {
    // The UK list first, then world birds, then each extra group (mammals, reptiles, ...) for the person's regions; a
    // name already listed is not repeated.
    const have = new Set(labels.uk.map((l) => l.scientific.toLowerCase()));
    const list = [...labels.uk];
    for (const group of [labels.world, ...groups]) {
      const added = worldLabelsForRegions(group, regions, have);
      for (const name of added) have.add(name.scientific.toLowerCase());
      list.push(...added);
    }
    ranked = { labels: list, vectors: list.map(decodeVector) };
    vectorsKey = key;
  }
  return ranked;
}

/**
 * BioCLIP 2's opinion on `suggested` (BioCLIP's top name, or null), from the same crop BioCLIP used. Returns null
 * when the validator is not installed here, so callers show BioCLIP's suggestion exactly as before.
 */
export async function validateSpecies(picture: CanvasImageSource & { width: number; height: number }, crop: SquareCrop,
  suggested: Pick<SpeciesLabel, 'scientific' | 'common'> | null): Promise<SpeciesVerdict | null> {
  if (await validatorStatus() !== 'ready') return null;
  const { ort, session, labels, groups } = await load();
  const size = SPECIES_MODEL.size;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);
  const input = preprocessSpecies(context.getImageData(0, 0, size, size).data, size);
  const out = await session.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, size, size]) });
  const embedding = normalise(Float32Array.from(out.embedding.data as Float32Array));
  const names = namesFor(labels, groups);
  return compareSpecies(suggested, rankSpecies(embedding, names.labels, names.vectors));
}
