/**
 * The on-device photo-check model pack, pinned. Nothing here is fetched until the photographer explicitly installs it.
 * Weights are never committed to Git: each file is downloaded once from the pinned revision, its SHA-256 and size are
 * checked, and it is stored through the existing verified asset store (immutable slot, read-back, atomic activation).
 *
 * Model: SmolVLM2-256M-Video-Instruct (HuggingFaceTB), Apache-2.0, 8-bit ONNX export. Licence notice: docs/models.md.
 */
export const PHOTO_CHECK_REVISION = '9cda5c165b28c68a52e9bb542d2b89f0f6963709';
export const PHOTO_CHECK_BASE_URL = `https://huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct/resolve/${PHOTO_CHECK_REVISION}`;

/** Browsers refuse a single IndexedDB value over about 127 MB, so a larger file is stored as pinned parts and re-joined (and re-verified whole). */
export interface PackPart { bytes: number; sha256: string }
export interface PackFile { key: 'vision' | 'embed' | 'decoder' | 'tokenizer'; path: string; bytes: number; sha256: string; parts?: readonly PackPart[] }
export const PHOTO_CHECK_PACK = {
  name: 'smolvlm2-256m',
  version: '1.0.0',
  licence: 'Apache-2.0 (HuggingFaceTB/SmolVLM2-256M-Video-Instruct)',
  provenance: `huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct@${PHOTO_CHECK_REVISION}`,
  files: [
    { key: 'vision', path: 'onnx/vision_encoder_int8.onnx', bytes: 94_247_884, sha256: '39f0efae9614b1679404961efb970bf307adb76b4d9fb4e25f1e3c564611963d' },
    { key: 'embed', path: 'onnx/embed_tokens_int8.onnx', bytes: 28_385_824, sha256: 'e2cdc3690af5719c7463254f96c3b665a9e24add2a1fa6f594347d67a422710a' },
    { key: 'decoder', path: 'onnx/decoder_model_merged_int8.onnx', bytes: 137_553_254, sha256: '03304ea9501d2d72c3858d668a56f54fc42fc54132759c389e54ff706f3d37c1', parts: [
      { bytes: 67_108_864, sha256: '76157c5861f0a66b368350e831c85830e2f74b86235df71ff964470c742802e7' },
      { bytes: 67_108_864, sha256: '3e7464309f23f868f3053115abd86bca772a26fe6cd1c2414e2fe5403287d567' },
      { bytes: 3_335_526, sha256: '013650414ad87078dabff0b249fbbe04f5b8c0e1e5d1b72680fefe80b982fb5a' },
    ] },
    { key: 'tokenizer', path: 'tokenizer.json', bytes: 3_548_256, sha256: '5ece781dc8d2b2f3e2f289ca0ae50b17cfc27dd27bfe7971bb8241e0b964331a' },
  ] as readonly PackFile[],
} as const;
export const PHOTO_CHECK_TOTAL_BYTES = PHOTO_CHECK_PACK.files.reduce((sum, file) => sum + file.bytes, 0);
/** One verified-store asset id per file. */
export const packAssetId = (file: PackFile, part?: number) => `${PHOTO_CHECK_PACK.name}.${file.key}${part === undefined ? '' : `-part${part}`}`;
