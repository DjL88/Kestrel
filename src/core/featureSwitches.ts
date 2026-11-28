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
  { id: 'subject-mask-model', name: 'Subject mask model', description: 'The small built-in model that outlines the subject for masks and culling.', owner: OWNER, scopes: ['device'],
    offEffect: 'The app stops loading the subject model. Brush and gradient masks still work; automatic subject outlines are hidden.', modelIds: ['u2netp'] },
  { id: 'fine-edge-mask', name: 'Fine-edge mask (hair and feathers)', description: 'The optional download that refines mask edges.', owner: OWNER, scopes: ['device'],
    offEffect: 'The download is hidden and an installed copy is not loaded. The ordinary mask edge is used.', modelIds: ['birefnet-lite-w16'] },
  { id: 'tap-to-select', name: 'Tap to select a subject', description: 'The optional download that lets a tap outline a subject.', owner: OWNER, scopes: ['device'],
    offEffect: 'The download is hidden and an installed copy is not loaded. Tap to select is not offered.', modelIds: ['efficientsam-ti-fp16'] },
  { id: 'learned-denoise', name: 'Learned noise removal', description: 'The optional download that removes noise with a trained model.', owner: OWNER, scopes: ['device', 'cloud'],
    offEffect: 'The download is hidden and an installed copy is not loaded. The ordinary noise sliders keep working. In the cloud, new noise-removal jobs are refused with a calm message.', modelIds: ['nafnet-sidd-w32-w16'] },
  { id: 'species-id', name: 'Species identification', description: 'On-device models that suggest a bird or animal name, and the check that confirms it.', owner: OWNER, scopes: ['device'],
    offEffect: 'Species suggestions stop and the species downloads are hidden. Photos keep their own names and keywords.',
    modelIds: ['bioclip-image-int8', 'bioclip2-image-fp16', 'clip-gate', 'clip-vit-b32-text-int8'], features: ['speciesId'] },
  { id: 'subject-detector', name: 'Subject finder', description: 'The models that find the bird, animal or aircraft in a photo (used for culling and crops).', owner: OWNER, scopes: ['device'],
    offEffect: 'The app stops loading the finder models. Culling and crops work without automatic subject boxes.', modelIds: ['yolox-tiny', 'rfdetr-nano-fp16'], features: ['subjectDetection'] },
  { id: 'photo-similarity', name: 'Similar-photo grouping', description: 'The model that groups near-identical frames.', owner: OWNER, scopes: ['device'],
    offEffect: 'Near-identical frames are not grouped. Everything else in culling works.', modelIds: ['dinov2-small-fp16'] },
  { id: 'markings-reader', name: 'Reading registrations and rings', description: 'The model that reads text such as aircraft registrations.', owner: OWNER, scopes: ['device'],
    offEffect: 'The reader is not loaded; type the text by hand.', modelIds: ['markings-reader'] },
  { id: 'enhance-loop', name: 'Enhance loop (preview)', description: 'Auto measures, edits, checks and offers three options.', owner: OWNER, scopes: ['device'],
    offEffect: 'The enhance loop is hidden. Auto and every slider are unchanged.', previews: ['enhanceLoop'] },
  { id: 'finish-best', name: 'Finish best (preview)', description: 'One batch that edits the best photos first.', owner: OWNER, scopes: ['device'],
    offEffect: 'Finish best is hidden. Photos can still be edited one at a time.', previews: ['finishBest'], features: ['finishBest'] },
  { id: 'flight-batch', name: 'Flight batch (preview)', description: 'Edits the photos of a new import in the background.', owner: OWNER, scopes: ['device'],
    offEffect: 'Background editing of new imports stops. Nothing already edited changes.', previews: ['flightBatch'], features: ['flightBatch'] },
  { id: 'on-image-advice', name: 'On-image advice (preview)', description: 'Clipping, focus point and colour badge drawn on the photo.', owner: OWNER, scopes: ['device'],
    offEffect: 'The drawn advice is hidden. The photo and its edits are unchanged.', previews: ['onImageAdvice'], features: ['onImageAdvice'] },
  { id: 'verification-chain', name: 'Verification chain (preview)', description: 'A specialist proposes, this device confirms, the cloud is a quiet third opinion.', owner: OWNER, scopes: ['device', 'cloud'],
    offEffect: 'Confirmation steps are skipped and the cloud opinion is not asked for.', previews: ['verificationChain'], features: ['verificationChain'] },
  { id: 'own-ai-second-opinion', name: 'Second opinion from your own AI provider', description: 'Sends a small preview to the AI provider the person chose, only when they ask.', owner: OWNER, scopes: ['device'],
    offEffect: 'The second-opinion button is hidden and no request is made. Nothing already saved changes.', features: ['onlineAi'] },
  { id: 'cloud-processing', name: 'Cloud processing', description: 'Heavy jobs (noise removal, enlarging, masks) run in the cloud for Pro.', owner: OWNER, scopes: ['device', 'cloud'],
    offEffect: 'New cloud jobs are refused with “not available right now”. Jobs already finished stay downloadable. Local work is unchanged.', features: ['cloudAssist'] },
  { id: 'cloud-recipe', name: 'Cloud edit settings (preview)', description: 'A small preview goes up and undoable edit settings come back.', owner: OWNER, scopes: ['device', 'cloud'],
    offEffect: 'New cloud edit-settings jobs are refused. Nothing is uploaded.', previews: ['cloudRecipe'], features: ['cloudRecipe'] },
  { id: 'cloud-storage', name: 'Cloud storage chooser and copies', description: 'Choosing cloud storage and keeping a safe copy or full originals in the cloud.', owner: OWNER, scopes: ['device', 'cloud'],
    offEffect: 'New uploads stop and the chooser is hidden. Existing copies stay readable and can always be deleted.', previews: ['cloudOriginals'] },
];

const BY_ID = new Map(SWITCHABLE_FEATURES.map((feature) => [feature.id, feature]));
export const switchableFeature = (id: string): SwitchableFeature | undefined => BY_ID.get(id);
export const SWITCH_IDS = SWITCHABLE_FEATURES.map((feature) => feature.id) as [string, ...string[]];

/** What travels in the signed public list: only what is OFF. Absent means "as shipped" (on). */
export type SwitchDoc = Readonly<Record<string, Partial<Record<SwitchScope, false>>>>;
export const NO_SWITCHES: SwitchDoc = {};

/** Read a list from a verified payload. Anything unknown or malformed is dropped (so a newer server never breaks an older app). */
export function parseSwitchDoc(raw: unknown): SwitchDoc {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return NO_SWITCHES;
  const out: Record<string, Partial<Record<SwitchScope, false>>> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const feature = BY_ID.get(id);
    if (!feature || typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const entry: Partial<Record<SwitchScope, false>> = {};
    for (const scope of feature.scopes) if ((value as Record<string, unknown>)[scope] === false) entry[scope] = false;
    if (Object.keys(entry).length) out[id] = entry;
  }
  return out;
}

export const switchedOff = (doc: SwitchDoc, id: string, scope: SwitchScope): boolean => doc[id]?.[scope] === false;

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
  const base = modelId.replace(/\.(encoder|decoder)$/, '');
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
