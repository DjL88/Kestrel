import type { DataAsset, DataManifest } from './dataUpdateManifest';
import type { InstalledAsset } from './modelDelivery';

/**
 * The models Kestrel can update without a new app, and what each must still do. An update is accepted only for a model
 * the app already has a slot for, and only when the signed manifest says it keeps that slot's contract: the same input
 * size and preparation, the same outputs and the same labels or vectors. A new contract needs a new app, because the
 * code around the model (labels, vectors, thresholds) is part of the contract. Raise a slot's version only together
 * with the code that reads the new outputs.
 */
export const MODEL_SLOTS = {
  'yolox-tiny': { contract: 'yolox-tiny-coco80-416/v1', label: 'subject detector' },
  'u2netp': { contract: 'u2netp-salient-320/v1', label: 'subject mask model' },
  'bioclip-image-int8': { contract: 'bioclip-image-224/v1', label: 'species model' },
  'clip-vit-b32-vision-uint8': { contract: 'clip-vision-224-gate/v1', label: 'subject checker' },
} as const;

export type ModelSlotId = keyof typeof MODEL_SLOTS;
export const isModelSlot = (id: string): id is ModelSlotId => Object.hasOwn(MODEL_SLOTS, id);

export interface SkippedModel { id: string; reason: 'not_a_model_slot' | 'contract_changed' | 'contract_missing' }
export interface ModelUpdatePlan { install: DataAsset[]; skipped: SkippedModel[] }

/** Which assets in a verified manifest this app may install now. Everything else is reported, never installed. */
export function planModelUpdates(manifest: DataManifest, installed: Readonly<Record<string, InstalledAsset>>): ModelUpdatePlan {
  const install: DataAsset[] = [];
  const skipped: SkippedModel[] = [];
  for (const asset of manifest.assets) {
    if (asset.kind !== 'onnx' || !isModelSlot(asset.id)) { skipped.push({ id: asset.id, reason: 'not_a_model_slot' }); continue; }
    if (asset.contract === undefined) { skipped.push({ id: asset.id, reason: 'contract_missing' }); continue; }
    if (asset.contract !== MODEL_SLOTS[asset.id].contract) { skipped.push({ id: asset.id, reason: 'contract_changed' }); continue; }
    const have = installed[asset.id];
    if (!have || have.sha256 !== asset.sha256 || have.version !== asset.version) install.push(asset);
  }
  return { install, skipped };
}
