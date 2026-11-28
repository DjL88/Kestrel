/**
 * Which models the enhance loop may use (owner policy, 28 Nov 2026): ONLY openly licensed models whose code, weights AND
 * training data allow commercial redistribution. A model whose weights licence is open but whose training data is
 * research-only, non-commercial or unverified is `verify` and the loop does not use it until the owner has confirmed it.
 * The table is in docs/enhance-loop-models.md. No weights are in Git.
 */
export type LoopLicenceStatus = 'open' | 'verify';
export interface LoopModelLicence { id: string; licence: string; status: LoopLicenceStatus; note: string }

export const LOOP_MODELS: readonly LoopModelLicence[] = [
  { id: 'smolvlm2-256m', licence: 'Apache-2.0', status: 'open', note: 'Hugging Face; weights Apache-2.0. Vision critic and observations.' },
  { id: 'yolox-tiny', licence: 'Apache-2.0', status: 'open', note: 'Subject detector; COCO-trained.' },
  { id: 'rfdetr-nano-fp16', licence: 'Apache-2.0', status: 'open', note: 'Nano size only; larger RF-DETR sizes are not Apache.' },
  { id: 'dinov2-small-fp16', licence: 'Apache-2.0', status: 'open', note: 'Burst grouping.' },
  { id: 'clip-vit-b32', licence: 'MIT', status: 'open', note: 'OpenAI CLIP code and weights MIT; training data not published.' },
  { id: 'pp-ocrv5-mobile', licence: 'Apache-2.0', status: 'open', note: 'Markings; not used for photographic judgement.' },
  { id: 'u2netp', licence: 'Apache-2.0 (code)', status: 'verify', note: 'Trained on DUTS, whose terms are academic; not confirmed for commercial use.' },
  { id: 'birefnet-lite-w16', licence: 'MIT (code, weights)', status: 'verify', note: 'Trained on DIS5K and other academic sets; data terms not confirmed.' },
  { id: 'efficientsam-ti-fp16', licence: 'Apache-2.0 (code)', status: 'verify', note: 'Trained on SA-1B, which is research-licensed.' },
  { id: 'nafnet-sidd-w32-w16', licence: 'MIT (code)', status: 'verify', note: 'Weights trained on SIDD; dataset terms not confirmed for commercial use.' },
  { id: 'bioclip', licence: 'MIT (weights)', status: 'verify', note: 'Trained on TreeOfLife-10M, a mix of licences including non-commercial.' },
  { id: 'bioclip2-image-fp16', licence: 'MIT (weights)', status: 'verify', note: 'Trained on TreeOfLife-200M, a mix of licences including non-commercial.' },
];

/** True only for a model listed as clearly open. Unknown ids are never allowed. */
export const loopMayUse = (id: string): boolean => LOOP_MODELS.some((m) => m.id === id && m.status === 'open');
