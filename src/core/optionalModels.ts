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

export type ModelTier = 'phone' | 'desktop';

export interface OptionalModelFile {
  /** Empty when this build does not offer the pack. */
  url: string;
  sha256: string;
  bytes: number;
}

export interface OptionalModel {
  id: string;
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

function pinned(prefix: string, sha256: string, bytes: number): OptionalModelFile {
  return {
    url: env?.[`VITE_${prefix}_URL`] ?? '',
    sha256: env?.[`VITE_${prefix}_SHA256`] ?? sha256,
    bytes: Number(env?.[`VITE_${prefix}_BYTES`] ?? bytes),
  };
}

export const RFDETR_NANO: OptionalModel = {
  id: 'rfdetr-nano-fp16',
  name: 'RF-DETR Nano',
  job: 'A second, newer subject detector that runs beside the built-in one. Where the two disagree, the photo is marked for review.',
  licence: 'Apache-2.0',
  source: 'https://huggingface.co/Roboflow/rf-detr-nano (revision 9f201577d9415f0378084748d27e68586e6b3600)',
  tier: 'phone',
  fallback: 'YOLOX-tiny',
  files: { model: pinned('RFDETR_MODEL', 'e83b810bff55423a019564fcc3cd0bc188fd15d88f2f39dea287abb61f707002', 54560489) },
  cache: 'kestrel-rfdetr-nano-v1',
};

export const EFFICIENTSAM_TI: OptionalModel = {
  id: 'efficientsam-ti-fp16',
  name: 'Tap to select (EfficientSAM-Ti)',
  job: 'Select a subject by tapping it; more taps add or remove parts, and several subjects can be selected.',
  licence: 'Apache-2.0',
  source: 'https://github.com/yformer/EfficientSAM (commit d525f622e6f640acf5a0fc37c7ca1f243da5bde0, weights/efficient_sam_vitt_{encoder,decoder}.onnx)',
  tier: 'phone',
  fallback: 'manual brush and the U²-Netp subject mask',
  files: {
    encoder: pinned('EFFICIENTSAM_ENCODER', '5f0260b102fe82ad88c8ef0dc2422b3c44755005e1c2bbcc44b5d88b1bafbff4', 12641129),
    decoder: pinned('EFFICIENTSAM_DECODER', 'e1409f2e1449600f29ee3674e690020de14d5b52d573b169650c8062608b73f3', 8589267),
  },
  cache: 'kestrel-efficientsam-ti-v1',
};

export const NAFNET_W32: OptionalModel = {
  id: 'nafnet-sidd-w32-w16',
  name: 'TrueDetail: NAFNet denoiser',
  job: 'Adds NAFNet as one more noise-reduction candidate for TrueDetail, beside the built-in noise reduction.',
  licence: 'MIT',
  source: 'https://github.com/megvii-research/NAFNet (commit 2b4af71ebe098a92a75910c233a3965a3e93ede4), NAFNet-SIDD-width32.pth from the authors\' Google Drive link in docs/SIDD.md',
  tier: 'phone',
  fallback: 'conventional luminance and colour noise reduction',
  files: { model: pinned('NAFNET_MODEL', 'c28f9ebfc824217becc71f1406300380e2a74123db02e007a17eb3015f74fe21', 58841423) },
  cache: 'kestrel-nafnet-w32-v1',
};

export const OPTIONAL_MODELS: readonly OptionalModel[] = [RFDETR_NANO, EFFICIENTSAM_TI, NAFNET_W32];

/** Total download for a pack, for an honest size in the offer. */
export function optionalModelBytes(model: OptionalModel): number {
  return Object.values(model.files).reduce((sum, file) => sum + file.bytes, 0);
}

/** Is the pack offered in this build at all? Every file needs an address, a 64-hex digest and a positive length. */
export function optionalModelConfigured(model: OptionalModel): boolean {
  return Object.values(model.files).every((file) =>
    file.url.length > 0 && /^[0-9a-f]{64}$/.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes > 0);
}

/** Is the pack offered on this kind of device? Desktop packs are never offered on a phone or tablet. */
export function optionalModelFitsDevice(model: OptionalModel, device: ModelTier): boolean {
  return model.tier === 'phone' || device === 'desktop';
}
