import { createTokenizer, type TokenizerJson } from '../core/smolvlm';

/**
 * Real pre-activation smoke checks for the photo-check model pack (#703 / #418 W5 finding, 22 Nov 2026):
 * the previous `smokeTest` passed to `activateApprovedAsset` was a no-op comment, so a byte-correct but
 * structurally broken file (truncated download that still happened to match a stale pinned digest, wrong
 * ONNX opset, malformed tokenizer) would only fail later, deep inside a real photo check, not at install
 * time. These checks are cheap and real: they exercise the same loading code the app uses at inference
 * time, not a second, separate "looks fine" heuristic.
 */

/** Parses the tokenizer file and exercises the exact lookups `smolvlmRuntime.ts` depends on
 * (`<image>`, `<end_of_utterance>`), so a tokenizer missing either special token fails at install,
 * not mid-inference. Throws with a clear message on any structural problem. */
export function parseTokenizerOrThrow(bytes: Uint8Array): TokenizerJson {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The tokenizer file is not valid JSON.');
  }
  if (!json || typeof json !== 'object' || !('model' in json) || !('added_tokens' in json)) {
    throw new Error('The tokenizer file is missing the expected model/added_tokens structure.');
  }
  const candidate = json as TokenizerJson;
  if (!candidate.model || typeof candidate.model.vocab !== 'object' || !Array.isArray(candidate.model.merges)) {
    throw new Error('The tokenizer file is missing its vocabulary or merge table.');
  }
  if (!Array.isArray(candidate.added_tokens) || candidate.added_tokens.length === 0) {
    throw new Error('The tokenizer file has no added (special) tokens.');
  }
  const tokenizer = createTokenizer(candidate);
  tokenizer.special('<image>');
  tokenizer.special('<end_of_utterance>');
  return candidate;
}

/**
 * Observed combined peak while all three ONNX sessions (vision + embed + decoder) are resident and a
 * check is running, per the #418 W5 finding on 22 Nov 2026 ("real inference was previously observed near
 * ~2GB"). This is a measured observation on one development machine, NOT a guaranteed worst case across
 * devices/browsers - it should be re-measured on real low-memory hardware before this pack is offered as
 * release-approved (see docs/V2-WORKSPACE.md section 6 and #418). Used as a shared ceiling on every file
 * in the pack, since the risk is the combined resident set, not any one file's own size.
 */
export const OBSERVED_PEAK_RAM_BYTES = 2_200_000_000;

/**
 * `navigator.deviceMemory` (Chromium only; Firefox/Safari/most WebViews do not expose it) in bytes, or null
 * when the browser does not report it. Previously the caller passed a hardcoded 8 GiB regardless of the
 * real device, which made the `assertReady` RAM ceiling check in verifiedAssetActivation.ts vacuous on
 * genuinely low-memory hardware. This reads the one real signal the platform offers.
 */
export function reportedDeviceMemoryBytes(nav: { deviceMemory?: number } | undefined): number | null {
  const gib = nav?.deviceMemory;
  if (typeof gib !== 'number' || !Number.isFinite(gib) || gib <= 0) return null;
  return gib * 1_073_741_824;
}

/**
 * Conservative assumption when the platform does not report device memory at all. Deliberately smaller
 * than the old blanket 8 GiB: a device that doesn't report at all should not be assumed generous. Still
 * not a substitute for a real measured per-platform floor (NOT VERIFIED - see docs/V2-WORKSPACE.md section 6).
 */
export const ASSUMED_RAM_BYTES_WHEN_UNKNOWN = 3_000_000_000;

/** What to pass as `maxDeviceRamBytes` to `activateApprovedAsset`: the real reported figure when the
 * browser exposes one, otherwise the conservative assumed floor above - never the old flat 8 GiB. */
export function deviceRamBytesForInstall(nav: { deviceMemory?: number } | undefined): number {
  return reportedDeviceMemoryBytes(nav) ?? ASSUMED_RAM_BYTES_WHEN_UNKNOWN;
}

/** Whether a device this small should be refused the install outright, rather than let it try and likely
 * thrash/OOM mid-check. Compares the real-or-assumed device figure against the observed peak above. */
export function deviceLikelyTooSmall(nav: { deviceMemory?: number } | undefined): boolean {
  return deviceRamBytesForInstall(nav) < OBSERVED_PEAK_RAM_BYTES;
}
