/**
 * Owner switches for model-backed and AI features (docs/RELEASE-FLOW.md, "Feature switches").
 *
 * One registry of the features the owner can switch off quickly (for example when a licence check says a model must not
 * ship), each with two scopes:
 *   - `device`: the app on a person's own computer or phone. Advisory for installed apps: they read the signed list when
 *     online, keep the last good copy, and follow it at their next refresh. Offline they use that copy or the built-in
 *     default (everything as shipped), so editing and start-up never wait on it.
 *   - `cloud`: enforced by the control plane / cloud runner on every request, so it is immediate.
 *
 * A switch can only turn off, or turn back on, something the app already ships. It never turns on anything the person
 * has not chosen: their consent, their plan and their own opt-ins still apply on top. The default is "on" (current
 * behaviour); only an explicit off from the owner changes anything. Flags (featureFlags.ts) still decide who gets a
 * feature; this module is the separate, simpler "stop it everywhere" lever.
 */
import type { PreviewId } from './previewFeatures';
import type { Feature } from './features';

export type SwitchScope = 'device' | 'cloud';
export const SWITCH_SCOPES: readonly SwitchScope[] = ['device', 'cloud'];

export type LicenceVerdict = 'green' | 'amber' | 'red';
/** The licence audit's verdict for the models behind a feature (owner policy 28 Nov 2026). Shown in /admin so the owner sees why. */
export interface LicenceNote { verdict: LicenceVerdict; reason: string; reportDate: string }
const AUDIT = '2026-11-28';
const amber = (reason: string): LicenceNote => ({ verdict: 'amber', reason, reportDate: AUDIT });
const red = (reason: string): LicenceNote => ({ verdict: 'red', reason, reportDate: AUDIT });
const green = (reason: string): LicenceNote => ({ verdict: 'green', reason, reportDate: AUDIT });

export interface SwitchableFeature {
  /** Stable. Never rename: it is stored by the control plane and sent in the signed list. */
  id: string;
  /** Plain words, as people see them. */
  name: string;
  description: string;
  /** Who answers for it (a role, not a person). */
  owner: string;
  /** The scopes that mean something for this feature. The others are shown as "not used" and cannot be changed. */
  scopes: readonly SwitchScope[];
  /** Licence verdict for the models behind it. Red features are OFF by default (both scopes) in beta builds. */
  licence: LicenceNote;
  /** Default for each scope when the owner has made no choice and none is known (offline, first run). Default true: as shipped. */
  defaultOn?: boolean;
  /** What switching it off does, in plain words (shown before the owner confirms). */
  offEffect: string;
  /** Catalogue / session ids of models this switch stops from loading or downloading (src/providers/modelCatalogue.ts). */
  modelIds?: readonly string[];
  /** Preview switches (src/core/previewFeatures.ts) that read as off while this is off. */
  previews?: readonly PreviewId[];
  /** Admin-flag features (src/core/features.ts) that read as off while this is off. */
  features?: readonly Feature[];
}

const OWNER = 'Owner';

export const SWITCHABLE_FEATURES: readonly SwitchableFeature[] = [
  { id: 'subject-mask-model', name: 'Subject mask model', description: 'The small built-in model that outlines the subject for masks and culling.', owner: OWNER, licence: red('Weights trained on DUTS (all rights reserved, no commercial grant); weights licence not stated.'), defaultOn: false, scopes: ['device'],
    offEffect: 'The app stops loading the subject model. Subject-focused looks use the detector box plus measured in-focus detail. Brush and gradient masks still work.', modelIds: ['u2netp'] },
  { id: 'fine-edge-mask', name: 'Fine-edge mask (hair and feathers)', description: 'The optional download that refines mask edges.', owner: OWNER, licence: red('Trained on DIS5K, whose terms prohibit commercial use; other training sets unconfirmed.'), defaultOn: false, scopes: ['device'],
    offEffect: 'Shows “not available right now”. The download is hidden and an installed copy is not loaded. The ordinary mask edge is used.', modelIds: ['birefnet-lite-w16'] },
  { id: 'tap-to-select', name: 'Tap to select a subject', description: 'The optional download that lets a tap outline a subject.', owner: OWNER, licence: red('Trained from SA-1B (research purposes only) and ImageNet; no weights licence stated.'), defaultOn: false, scopes: ['device'],
    offEffect: 'Shows “not available right now”. The download is hidden and an installed copy is not loaded.', modelIds: ['efficientsam-ti-fp16'] },
  { id: 'learned-denoise', name: 'Learned noise removal', description: 'The optional download that removes noise with a trained model.', owner: OWNER, licence: amber('MIT code, but no weights licence; SIDD dataset says MIT but is silent on rights in the scenes.'), scopes: ['device', 'cloud'],
    offEffect: 'The download is hidden and an installed copy is not loaded. The ordinary noise sliders keep working. In the cloud, new noise-removal jobs are refused with a calm message.', modelIds: ['nafnet-sidd-w32-w16'] },
  { id: 'species-id', name: 'Species identification', description: 'On-device models that suggest a bird or animal name, and the check that confirms it.', owner: OWNER, licence: red('BioCLIP data includes iNat21 (non-commercial) and BIOSCAN (CC BY-NC-SA); BioCLIP 2 cannot be shown clean. Species vectors share the verdict.'), defaultOn: false, scopes: ['device'],
    offEffect: 'There is no automatic species suggestion: the person chooses from the short nearby-species list. The species downloads are hidden.',
    modelIds: ['bioclip-image-int8', 'bioclip2-image-fp16'], features: ['speciesId'] },
  { id: 'category-gate', name: 'Category check and text search (CLIP)', description: 'The model that checks a photo shows an animal before species are suggested, and powers search by description.', owner: OWNER, scopes: ['device'], licence: amber('OpenAI\'s model card calls deployed use out of scope and the training data is undisclosed; MIT tag. Leaning red.'),
    offEffect: 'The category check and search by description stop. Species suggestions, if on, no longer wait for the check.', modelIds: ['clip-gate', 'clip-vit-b32-text-int8', 'clip-vit-b32-vision-uint8'] },
  { id: 'subject-detector', name: 'Subject finder', description: 'The models that find the bird, animal or aircraft in a photo (used for culling and crops).', owner: OWNER, licence: amber('Apache-2.0 code; YOLOX weights licence not stated, RF-DETR Nano is Apache-2.0 but inherits DINOv2 and COCO caveats. Low risk.'), scopes: ['device'],
    offEffect: 'The app stops loading the finder models. Culling and crops work without automatic subject boxes.', modelIds: ['yolox-tiny', 'rfdetr-nano-fp16'], features: ['subjectDetection'] },
  { id: 'photo-similarity', name: 'Similar-photo grouping', description: 'The model that groups near-identical frames.', owner: OWNER, licence: amber('DINOv2 is Apache-2.0 for code and weights; training data terms not confirmed. Low risk.'), scopes: ['device'],
    offEffect: 'Near-identical frames are not grouped. Everything else in culling works.', modelIds: ['dinov2-small-fp16'] },
  { id: 'markings-reader', name: 'Reading registrations and rings', description: 'The model that reads text such as aircraft registrations.', owner: OWNER, licence: amber('PP-OCRv5 is Apache-2.0; training data not described. Low risk.'), scopes: ['device'],
    offEffect: 'The reader is not loaded; type the text by hand.', modelIds: ['markings-reader'] },
  { id: 'enhance-loop', name: 'Enhance loop (preview)', description: 'Auto measures, edits, checks and offers three options.', owner: OWNER, licence: green('No model of its own: uses the other features.'), scopes: ['device'],
    offEffect: 'The enhance loop is hidden. Auto and every slider are unchanged.', previews: ['enhanceLoop'] },
  { id: 'finish-best', name: 'Finish best (preview)', description: 'One batch that edits the best photos first.', owner: OWNER, licence: green('No model of its own.'), scopes: ['device'],
    offEffect: 'Finish best is hidden. Photos can still be edited one at a time.', previews: ['finishBest'], features: ['finishBest'] },
  { id: 'flight-batch', name: 'Flight batch (preview)', description: 'Edits the photos of a new import in the background.', owner: OWNER, licence: green('No model of its own.'), scopes: ['device'],
    offEffect: 'Background editing of new imports stops. Nothing already edited changes.', previews: ['flightBatch'], features: ['flightBatch'] },
  { id: 'on-image-advice', name: 'On-image advice (preview)', description: 'Clipping, focus point and colour badge drawn on the photo.', owner: OWNER, licence: green('No model of its own.'), scopes: ['device'],
    offEffect: 'The drawn advice is hidden. The photo and its edits are unchanged.', previews: ['onImageAdvice'], features: ['onImageAdvice'] },
  { id: 'verification-chain', name: 'Verification chain (preview)', description: 'A specialist proposes, this device confirms, the cloud is a quiet third opinion.', owner: OWNER, licence: amber('Uses species and CLIP models, so it carries their verdicts.'), scopes: ['device', 'cloud'],
    offEffect: 'Confirmation steps are skipped and the cloud opinion is not asked for.', previews: ['verificationChain'], features: ['verificationChain'] },
  { id: 'own-ai-second-opinion', name: 'Second opinion from your own AI provider', description: 'Sends a small preview to the AI provider the person chose, only when they ask.', owner: OWNER, licence: green('The person\'s own provider and terms; nothing is shipped.'), scopes: ['device'],
    offEffect: 'The second-opinion button is hidden and no request is made. Nothing already saved changes.', features: ['onlineAi'] },
  { id: 'cloud-processing', name: 'Cloud processing', description: 'Heavy jobs (noise removal, enlarging, masks) run in the cloud for Pro.', owner: OWNER, licence: green('The cloud runner uses no neural model (deterministic resampler).'), scopes: ['device', 'cloud'],
    offEffect: 'New cloud jobs are refused with “not available right now”. Jobs already finished stay downloadable. Local work is unchanged.', features: ['cloudAssist'] },
  { id: 'cloud-recipe', name: 'Cloud edit settings (preview)', description: 'A small preview goes up and undoable edit settings come back.', owner: OWNER, licence: green('No shipped model.'), scopes: ['device', 'cloud'],
    offEffect: 'New cloud edit-settings jobs are refused. Nothing is uploaded.', previews: ['cloudRecipe'], features: ['cloudRecipe'] },
  { id: 'cloud-storage', name: 'Cloud storage chooser and copies', description: 'Choosing cloud storage and keeping a safe copy or full originals in the cloud.', owner: OWNER, licence: green('No model.'), scopes: ['device', 'cloud'],
    offEffect: 'New uploads stop and the chooser is hidden. Existing copies stay readable and can always be deleted.', previews: ['cloudOriginals'] },
];

const BY_ID = new Map(SWITCHABLE_FEATURES.map((feature) => [feature.id, feature]));
export const switchableFeature = (id: string): SwitchableFeature | undefined => BY_ID.get(id);
export const SWITCH_IDS = SWITCHABLE_FEATURES.map((feature) => feature.id) as [string, ...string[]];

/**
 * What travels in the signed public list: the owner's explicit choices only, true or false. Absent means the feature's
 * own default (`defaultOn`: on, except the licence-red models, which are off by default in beta builds).
 */
export type SwitchDoc = Readonly<Record<string, Partial<Record<SwitchScope, boolean>>>>;
export const NO_SWITCHES: SwitchDoc = {};

/** Read a list from a verified payload. Anything unknown or malformed is dropped (so a newer server never breaks an older app). */
export function parseSwitchDoc(raw: unknown): SwitchDoc {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return NO_SWITCHES;
  const out: Record<string, Partial<Record<SwitchScope, boolean>>> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const feature = BY_ID.get(id);
    if (!feature || typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const entry: Partial<Record<SwitchScope, boolean>> = {};
    for (const scope of feature.scopes) { const v = (value as Record<string, unknown>)[scope]; if (typeof v === 'boolean') entry[scope] = v; }
    if (Object.keys(entry).length) out[id] = entry;
  }
  return out;
}

/** The default with no owner choice and no list: on, except the licence-red features. */
// Browser-test builds only (playwright configs): the licence-red models stay on so the existing model specs still run.
// Never set in a build people install: the default there is the licence audit's.
const TEST_BUILD_RED_ON = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_KESTREL_TEST_RED_MODELS_ON === '1';
export const defaultOn = (id: string): boolean => TEST_BUILD_RED_ON || BY_ID.get(id)?.defaultOn !== false;

/** Effective state of a switch given a list. An explicit choice wins; otherwise the feature's default. */
export const switchedOff = (doc: SwitchDoc, id: string, scope: SwitchScope): boolean => (doc[id]?.[scope] ?? defaultOn(id)) === false;

// ---- This device's copy ----------------------------------------------------------------------------------------

let current: SwitchDoc = NO_SWITCHES;
let version = 0;
const listeners = new Set<() => void>();

/** Called by the settings store with the last verified list (cached or fresh). Null means "none known": everything as shipped. */
export function setOwnerSwitches(doc: SwitchDoc | null): void {
  const next = doc ?? NO_SWITCHES;
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  version += 1;
  for (const listener of [...listeners]) { try { listener(); } catch { /* one listener must not stop the rest */ } }
}
export const ownerSwitchesVersion = (): number => version;
export function subscribeOwnerSwitches(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Is this feature switched off by the owner for this device? */
export const ownerSwitchOff = (id: string, doc: SwitchDoc = current): boolean => switchedOff(doc, id, 'device');

/** Is the model with this catalogue or session id switched off here? `u2netp.encoder` counts as `u2netp`. */
export function ownerSwitchOffForModel(modelId: string, doc: SwitchDoc = current): boolean {
  const base = modelId.replace(/\.[a-z]+$/, '');
  return SWITCHABLE_FEATURES.some((feature) => feature.modelIds?.includes(base) && switchedOff(doc, feature.id, 'device'));
}

export function ownerSwitchOffForPreview(preview: string, doc: SwitchDoc = current): boolean {
  return SWITCHABLE_FEATURES.some((feature) => feature.previews?.includes(preview as PreviewId) && switchedOff(doc, feature.id, 'device'));
}

export function ownerSwitchOffForFeature(name: string, doc: SwitchDoc = current): boolean {
  return SWITCHABLE_FEATURES.some((feature) => feature.features?.includes(name as Feature) && switchedOff(doc, feature.id, 'device'));
}

/** What people see where a switched-off feature would have been. Calm, no blame, no jargon. */
export const NOT_AVAILABLE_MESSAGE = 'This is not available right now.';

export class SwitchedOffError extends Error {
  constructor(readonly featureId: string) { super(NOT_AVAILABLE_MESSAGE); this.name = 'SwitchedOffError'; }
}

export function assertModelAllowed(modelId: string): void {
  if (ownerSwitchOffForModel(modelId)) throw new SwitchedOffError(modelId);
}
