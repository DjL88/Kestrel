/**
 * Optional model packs: larger or newer models the photographer chooses to download. None is fetched by default and
 * none ships in git. Each file is pinned by address, length and SHA-256; a file that does not match is refused, and the
 * existing model it upgrades keeps working as the fallback. A pack whose address is not set in this build stays
 * out of sight ('unavailable'), exactly like the species download.
 *
 * Addresses come from the build (`VITE_<PACK>_MODEL_URL`, plus `_SHA256` and `_BYTES` to repin a re-export). The
 * pinned digests below are the files converted on 25 Nov 2026 from the authors' own release; how each was made and
 * checked is in docs/models.md.
 */
import type { DataManifest } from './dataUpdateManifest';

export type ModelTier = 'phone' | 'desktop';

export interface OptionalModelFile {
  /** Empty when this build does not offer the pack. */
  url: string;
  sha256: string;
  bytes: number;
  /**
   * The file's published name, e.g. `birefnet-lite-w16.onnx`. When set, the signing script publishes the file under
   * exactly this name (and refuses another), and Settings shows it before anything is downloaded.
   */
  file?: string;
}

export interface OptionalModel {
  id: string;
  /** What it is called where people see it: plain words, never the model's own name (that is in `source`). */
  name: string;
  /** What it does, in the photographer's words. */
  job: string;
  licence: string;
  /** Where the weights came from (the authors' own release). */
  source: string;
  /** Smallest device class it is offered on. Desktop-only packs never appear on a phone. */
  tier: ModelTier;
  /** The model already in the app that keeps doing the job when this pack is missing or fails. */
  fallback: string;
  files: Record<string, OptionalModelFile>;
  /** Cache Storage / IndexedDB bucket name; bump when a file changes so old copies are not reused. */
  cache: string;
}

const env = (import.meta as { env?: Record<string, string | undefined> }).env;

/**
 * Where this build fetches the packs from: one folder holding every file by its own name. Set it with
 * `VITE_OPTIONAL_MODEL_HOST` (ending in a slash), or per file with `VITE_<PACK>_URL`. Empty means no pack is offered.
 * Each file is still checked against the digest pinned below, so the host can never swap in a different model.
 */
export const OPTIONAL_MODEL_HOST = env?.VITE_OPTIONAL_MODEL_HOST ?? '';

/**
 * Or from the one signed model manifest (the models bucket's manifest/stable.json, key kestrel-2026-11), which lists
 * each pack file's address, SHA-256 and size. A build with the models bucket and its pinned key offers every pack, and
 * reads the address from the manifest only when the photographer downloads one.
 */
const manifestOffered = Boolean(env?.VITE_KESTREL_MODEL_BASE_URL?.trim() && env?.VITE_KESTREL_MODEL_KEYS?.trim());

/**
 * Or from a folder that keeps each file under its own SHA-256 (`<host>/<sha256>/<file>`), as the models bucket's
 * bundled/ folder does. The desktop build sets it (`VITE_MODEL_PACK_HOST`), so every pack it does not bundle can still
 * be downloaded. The pinned digest is checked either way.
 */
export const PACK_CHECKSUM_HOST = env?.VITE_MODEL_PACK_HOST?.trim() ?? '';

/**
 * Packs this installer carries in its own files (`/models/<file>`), by id. Set by the desktop build for each pack whose
 * files it fetched and checked; they are then ready with no download, and each file is checked again when read.
 */
export const BUNDLED_PACK_IDS: ReadonlySet<string> = new Set((env?.VITE_BUNDLED_PACKS ?? '').split(',').map((id) => id.trim()).filter(Boolean));

function pinned(prefix: string, file: string, sha256: string, bytes: number): OptionalModelFile {
  const digest = env?.[`VITE_${prefix}_SHA256`] ?? sha256;
  return {
    url: env?.[`VITE_${prefix}_URL`] ?? (OPTIONAL_MODEL_HOST ? `${OPTIONAL_MODEL_HOST.replace(/\/?$/, '/')}${file}`
      : PACK_CHECKSUM_HOST ? `${PACK_CHECKSUM_HOST.replace(/\/+$/, '')}/${digest}/${file}` : ''),
    sha256: digest,
    bytes: Number(env?.[`VITE_${prefix}_BYTES`] ?? bytes),
    file,
  };
}

export const RFDETR_NANO: OptionalModel = {
  id: 'rfdetr-nano-fp16',
  name: 'Second subject finder',
  job: 'A second, newer subject detector that runs beside the built-in one. Where the two disagree, the photo is marked for review.',
  licence: 'Apache-2.0',
  source: 'https://huggingface.co/Roboflow/rf-detr-nano (revision 9f201577d9415f0378084748d27e68586e6b3600)',
  tier: 'phone',
  fallback: 'YOLOX-tiny',
  files: { model: pinned('RFDETR_MODEL', 'rfdetr-nano-fp16.onnx', 'e83b810bff55423a019564fcc3cd0bc188fd15d88f2f39dea287abb61f707002', 54560489) },
  cache: 'kestrel-rfdetr-nano-v1',
};

export const EFFICIENTSAM_TI: OptionalModel = {
  id: 'efficientsam-ti-fp16',
  name: 'Tap to select',
  job: 'Select a subject by tapping it; more taps add or remove parts, and several subjects can be selected.',
  licence: 'Apache-2.0',
  source: 'https://github.com/yformer/EfficientSAM (commit d525f622e6f640acf5a0fc37c7ca1f243da5bde0, weights/efficient_sam_vitt_{encoder,decoder}.onnx)',
  tier: 'phone',
  fallback: 'manual brush and the U²-Netp subject mask',
  files: {
    encoder: pinned('EFFICIENTSAM_ENCODER', 'efficientsam-ti-encoder-fp16.onnx', '5f0260b102fe82ad88c8ef0dc2422b3c44755005e1c2bbcc44b5d88b1bafbff4', 12641129),
    decoder: pinned('EFFICIENTSAM_DECODER', 'efficientsam-ti-decoder-fp16.onnx', 'e1409f2e1449600f29ee3674e690020de14d5b52d573b169650c8062608b73f3', 8589267),
  },
  cache: 'kestrel-efficientsam-ti-v1',
};

export const NAFNET_W32: OptionalModel = {
  id: 'nafnet-sidd-w32-w16',
  name: 'AI noise reduction',
  job: 'Adds a learned noise reduction as one more candidate for TrueDetail, beside the built-in noise reduction.',
  licence: 'MIT',
  source: 'https://github.com/megvii-research/NAFNet (commit 2b4af71ebe098a92a75910c233a3965a3e93ede4), NAFNet-SIDD-width32.pth from the authors\' Google Drive link in docs/SIDD.md',
  tier: 'phone',
  fallback: 'conventional luminance and colour noise reduction',
  files: { model: pinned('NAFNET_MODEL', 'nafnet-sidd-w32-w16.onnx', 'c28f9ebfc824217becc71f1406300380e2a74123db02e007a17eb3015f74fe21', 58841423) },
  cache: 'kestrel-nafnet-w32-v1',
};

export const BIOCLIP2: OptionalModel = {
  id: 'bioclip2-image-fp16',
  name: 'Species second opinion',
  job: 'A much larger species model checks the species suggestion. If it disagrees, the photo is marked for review.',
  licence: 'MIT (weights); names from the IOC World Bird List, CC BY 4.0',
  source: 'https://huggingface.co/imageomics/bioclip-2 (revision 2957b322090f9cb17ae72c71981c7218a28d81e0, open_clip_model.safetensors)',
  tier: 'desktop',
  fallback: 'BioCLIP species suggestions without a second opinion',
  files: {
    model: pinned('BIOCLIP2_MODEL', 'bioclip2-image-fp16.onnx', '6f4fede093651f33a83ea0a0061833e0e8245fe0e218e558230ee56ac77360de', 608152397),
    labels: pinned('BIOCLIP2_LABELS', 'bioclip2-species.json', 'd06aa6d9c60e7242251d5771af902792d235dcdc6ec9419fa5230bd8617f6d59', 13250338),
    // 6,791 extant mammals, Mammal Diversity Database v2.5 (CC BY 4.0), BioCLIP 2 vectors by the species-names session.
    mammals: pinned('BIOCLIP2_MAMMALS', 'bioclip2-mammals.json', 'ad90459b5c891637c568fab7f1f51083817f9b20d33b5fddb44dcdd2a4478455', 8139587),
    // 12,650 reptiles, The Reptile Database 2026-06 (CC BY 4.0), BioCLIP 2 vectors by the species-names session.
    reptiles: pinned('BIOCLIP2_REPTILES', 'bioclip2-reptiles.json', '655d97013a12d744ed9528792ad7682a07db6fdc9096e64bbafdc12b42339abf', 14988825),
    // 9,807 amphibians, GBIF Backbone class Amphibia (CC BY 4.0), BioCLIP 2 vectors by the species-names session.
    amphibians: pinned('BIOCLIP2_AMPHIBIANS', 'bioclip2-amphibians.json', 'f98eed06801bf87a76083c1cf347fa3c6128924c586b4ae840e366bf15527601', 11648131),
    // 6,506 dragonflies and damselflies, World Odonata List Nov 2026 (CC BY 4.0).
    odonata: pinned('BIOCLIP2_ODONATA', 'bioclip2-odonata.json', '29fe86dbc6a9580d9f0c00b04ba81c5a803b4683e42600c16db54e1c03894676', 7698570),
    // 9,862 butterflies and moths of Europe, Fauna Europaea Lepidoptera (CC BY 4.0). Europe only.
    lepidoptera: pinned('BIOCLIP2_LEPIDOPTERA', 'bioclip2-lepidoptera.json', 'c16e729c2fbb0ff33f6cfb729c6f5cbf227d3bc856e7d36c20f48574658e7632', 11651891),
  },
  cache: 'kestrel-bioclip2-v1',
};

/**
 * The text half of the CLIP ViT-B/32 model whose picture half is already in the app (the category gate). With it, a
 * description typed in the search box ("dipper on a rock") is compared with each photo's picture vector, which the scene
 * tag pass keeps. It is the exact file the committed scene, subject and vehicle vectors were made with (their
 * `textModelSha256`). Its size is not pinned yet: the file was not reachable from the session that added the pack, so
 * the pack stays out of sight until the size is set here (or with `VITE_CLIPTEXT_MODEL_BYTES`). Signing the file with
 * scripts/release/sign-data-manifest.ts reports its true size.
 */
export const CLIP_TEXT: OptionalModel = {
  id: 'clip-vit-b32-text-int8',
  name: 'Search by description',
  job: 'Find photos by describing them in words, such as "dipper on a rock", by what is in the picture rather than only names and tags.',
  licence: 'MIT (OpenAI CLIP; ONNX conversion by Xenova)',
  source: 'https://huggingface.co/Xenova/clip-vit-base-patch32 (onnx/text_model_int8.onnx)',
  tier: 'phone',
  fallback: 'search by names, species, vehicles and tags',
  files: { model: pinned('CLIPTEXT_MODEL', 'clip-vit-b32-text-int8.onnx', '18845f2ccc35223bb7fec403383a131154b11ac0918df25cf51986df5efd3a21', 0) },
  cache: 'kestrel-clip-text-v1',
};

export const BIREFNET_LITE: OptionalModel = {
  id: 'birefnet-lite-w16',
  name: 'Fine subject edges',
  job: 'Finer subject masks for feathers, fur and whiskers. Used only when it finds the same subject as the built-in mask.',
  licence: 'MIT',
  source: 'https://huggingface.co/ZhengPeng7/BiRefNet_lite (revision aa62cd87eafb9cc43056d08ef3615a14628b831d), exported to ONNX by tools/model-conversion/birefnet_lite.py',
  tier: 'desktop',
  fallback: 'the built-in U²-Netp subject mask',
  files: { model: pinned('BIREFNET_MODEL', 'birefnet-lite-w16.onnx', '2c7c7240884841649e5f67b645cf7aed004a401c2fc666dd00c97a29948ef319', 92215270) },
  cache: 'kestrel-birefnet-lite-v1',
};

/** The manifest id of one file of a pack: the pack id, plus the file's role when the pack has several. */
export function packAssetId(model: OptionalModel, role: string): string {
  return Object.keys(model.files).length === 1 ? model.id : `${model.id}-${role}`;
}

/**
 * A pack file's address from a verified manifest: only for the asset with this pack's id whose SHA-256 and size are
 * exactly the pinned ones, so a manifest can never point a pack at a different file. Null otherwise.
 */
export function packFileUrlFromManifest(model: OptionalModel, role: string, manifest: DataManifest, baseUrl: string): string | null {
  const file = model.files[role];
  const asset = file && manifest.assets.find((a) => a.id === packAssetId(model, role));
  if (!asset || asset.sha256 !== file.sha256 || asset.bytes !== file.bytes) return null;
  return baseUrl.replace(/\/+$/, '') + asset.path;
}

export const OPTIONAL_MODELS: readonly OptionalModel[] = [RFDETR_NANO, EFFICIENTSAM_TI, NAFNET_W32, BIOCLIP2, BIREFNET_LITE, CLIP_TEXT];

/** Total download for a pack, for an honest size in the offer. */
export function optionalModelBytes(model: OptionalModel): number {
  return Object.values(model.files).reduce((sum, file) => sum + file.bytes, 0);
}

/**
 * Is the pack offered in this build at all? Every file needs a 64-hex digest and a positive length, and an address:
 * its own (a development override) or the models bucket's signed manifest, read when the pack is downloaded.
 */
export function optionalModelConfigured(model: OptionalModel, fromManifest = manifestOffered): boolean {
  return Object.values(model.files).every((file) =>
    (file.url.length > 0 || fromManifest) && /^[0-9a-f]{64}$/.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes > 0);
}

/** Is the pack offered on this kind of device? Desktop packs are never offered on a phone or tablet. */
export function optionalModelFitsDevice(model: OptionalModel, device: ModelTier): boolean {
  return model.tier === 'phone' || device === 'desktop';
}
