import { runEngineTask } from './taskManager';
import type { RawSensorMode } from '../providers/rawDevelop';

/**
 * The 'raw-develop' engine action - closing the gap `engineApi.ts` used to document ("raw-develop has no
 * engine-layer action at all yet"). This does NOT reimplement RAW decoding: the actual sensor decode is
 * `providers/rawDevelop.ts`'s `developRaw`/`developRawRgb16` (native via Tauri, or the same Rust decoder
 * compiled to WebAssembly in the browser/phone/tablet - both are real sensor decodes of this file, not an
 * embedded-preview substitute), and orientation correction is `matchPreviewOrientation`. Both are platform
 * code (Tauri `invoke`, `document.createElement`, `createImageBitmap`) that cannot run in a plain Node
 * test and do not belong duplicated in the engine layer, so they are injected here exactly like
 * `denoiseAction.ts`'s `render` - this module supplies the Task Manager wrapper and an honest result
 * shape, nothing else.
 *
 * Deliberately has NO decide->verify->retry loop like `denoiseAction.ts`/`maskAction.ts`. Those compare a
 * "before" and "after" Pixels buffer of the SAME photo to judge whether an edit overshot. A fresh RAW
 * develop has no such "before": the input is the undeveloped sensor data, not a comparable pixel buffer,
 * so there is nothing honest to verify against at this stage - inventing a pass/fail check here would be
 * exactly the kind of overstatement CLAUDE.md rules out ("Never overstate anything: RAW decode versus
 * embedded preview... Unknown stays unknown"). What this action DOES add, instead of a fake verification
 * step: an honest, structured record of what actually happened - which decoder path ran, whether the
 * file's sensor mode is already known, and whether orientation was actually matched against a preview or
 * is being reported unmatched - so a caller never has to guess or assume.
 */

export interface RawDevelopActionInput {
  /** Decodes the RAW file's sensor data to a full-size developed picture. The real decoder (native Tauri
   * invoke, or the WASM path) is injected rather than called from here directly. */
  develop: () => Promise<Blob>;
  /** Corrects the developed picture's orientation against the camera's own embedded preview - same idea
   * as `rawDevelop.ts`'s `matchPreviewOrientation`. Omit when no preview is available; the result then
   * honestly reports `orientationMatched: false` rather than silently assuming the decoder's own
   * orientation is already correct. */
  matchOrientation?: (developed: Blob) => Promise<Blob>;
  /** Which decoder path actually produced this picture. Both are real sensor decodes of this file -
   * report which one ran rather than letting a caller assume. */
  decoder: 'native' | 'wasm';
  /** This file's already-known sensor compression mode (from `rawSensorMode`), carried through rather
   * than re-derived here - this action does not re-inspect the file's headers. */
  sensorMode?: RawSensorMode;
}

export interface RawDevelopActionResult {
  /** The developed picture. Still just a JPEG/working raster - NOT a verified archival RAW master; see
   * `rawMaster16.ts`/`nativeRawMaster.ts` for that separate, stricter gate. */
  picture: Blob;
  decoder: 'native' | 'wasm';
  sensorMode?: RawSensorMode;
  /** True only when a preview was given and orientation correction actually ran against it. */
  orientationMatched: boolean;
}

export async function runRawDevelopAction(input: RawDevelopActionInput): Promise<RawDevelopActionResult> {
  return runEngineTask('raw-develop', 'device', 'Developing RAW', async () => {
    let picture = await input.develop();
    let orientationMatched = false;
    if (input.matchOrientation) {
      picture = await input.matchOrientation(picture);
      orientationMatched = true;
    }
    return { picture, decoder: input.decoder, sensorMode: input.sensorMode, orientationMatched };
  });
}
