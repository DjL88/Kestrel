import { proposeGroupSubjectAuto, groupSubjectSafe } from '../../core/groupSubjectAuto';
import type { InstanceFinding } from '../../providers/multiSubjectDetector';
import { detectSubjectInstances } from '../../providers/multiSubjectDetector';
import { unionSubjectGrid } from '../../core/subjectUnion';
import { speciesReference } from '../../core/speciesKnowledge';
import { observationsFromFrame, preservationPolicy } from '../../core/photographyPolicy';
import { sceneHintsFromPhotoTags } from '../../core/photoTagHints';
import { mergeAutoSuggestion } from '../../core/autoEnhance';
import { acceptedAutoChanges } from '../../core/autoSuggestionSummary';
import { proposeSubjectAwareAuto, type InsightSubjectKind } from '../../core/insightSubjectAuto';
import { framingKey } from '../../core/maskTypes';
import { naturalAuto, sameRecipe, stageNaturalRecipe } from '../../core/naturalAuto';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto } from '../../core/photoFraming';
import { isRawPreviewFile } from '../../core/rawFormats';
import { GUIDED_RENDER_EDGE } from '../../core/subjectGuide';
import type { SubjectDetail, SubjectGrid } from '../../core/maskTypes';
import type { PhotoFrame } from '../../core/types';
import { describePlan, planAuto, type AutoPlan } from '../../core/unifiedAuto';
import { checkColour, type ColourReport } from '../../core/colourCheck';
import type { SpeciesGuess } from '../../core/speciesPalette';
import { expectationForSpecies } from '../../core/colourMatch';
import { newId } from '../../core/ids';
import { identifySubject } from '../../providers/autoSpecies';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadImage } from '../../providers/loadImage';
import { loadAnalysisPicture } from '../../providers/analysisPicture';
import { editorText as t } from '../../i18n/areas/editor';
import { renderAutoCandidates, type AutoCandidate } from './renderAutoCandidates';
import { engineText } from '../../i18n/areas/engine';
import type { AutoUnavailable, AutoUnavailableCause } from './autoUnavailable';

export interface AutoRun {
  plan: AutoPlan;
  headline: string;
  /** Measured facts and each adjustment that survived the safety gate, in plain sentences. */
  detail: string[];
  /** True when Auto found a change that passed the quality gate. */
  improved: boolean;
  before: string;
  candidates: AutoCandidate[];
  source: Pick<PhotoFrame, 'stableKey' | 'originalSha256' | 'framing'>;
  /** The colour check of the same framed, unedited preview that Auto measured (the same pixels as its colour warnings). */
  colour?: ColourReport;
}

export function subjectKindOf(frame: Pick<PhotoFrame, 'subjectKind' | 'tags' | 'subjectNames'>): InsightSubjectKind {
  if (frame.subjectKind === 'landscape') return 'landscape';
  if (frame.subjectKind === 'wildlife' || frame.subjectKind === 'people') return frame.subjectKind;
  const labels = [...(frame.tags ?? []), ...(frame.subjectNames ?? [])].join(' ').toLowerCase();
  if (/\b(bird|mammal|wildlife|animal|insect)\b/.test(labels)) return 'wildlife';
  if (/\b(portrait|person|people|face)\b/.test(labels)) return 'people';
  if (/\b(aircraft|airplane|aeroplane|plane|helicopter|jet)\b/.test(labels)) return 'aircraft';
  return 'other';
}

const withTimeout = <T>(work: Promise<T>, ms: number, onTimeout: () => T | Promise<T>): Promise<T> => {
  let timer: number | undefined;
  return Promise.race([work, new Promise<T>((resolve, reject) => { timer = window.setTimeout(() => Promise.resolve(onTimeout()).then(resolve, reject), ms); })])
    .finally(() => { if (timer !== undefined) window.clearTimeout(timer); });
};

/**
 * The one Auto for a photo, the same flow as the current editor (src/core/unifiedAuto.ts): measure the framed, unedited
 * preview on this device, find the subject, build one reversible recipe, check it against the quality gate. Nothing is
 * applied here: the caller decides (Co-pilot suggests, Auto-pilot applies). Returns the reason (AutoUnavailable) when the picture
 * cannot be read, is too small, or is a RAW without a sensor development; null only when cancelled. RAW advice uses the
 * sensor-developed preview only, never the embedded camera JPEG. Original files are read only.
 */
/** Auto's headline in the person's language. The verdict decides it; its internal reason is never shown as the headline. */
function headlineFor(plan: AutoPlan): string {
  switch (plan.verdict.kind) {
    case 'improved': return plan.verdict.outcome === 'gentler' ? engineText.auto.appliedGentler : engineText.auto.applied;
    case 'looks-good': return engineText.auto.looksGood;
    default: return engineText.auto.cannotImprove;
  }
}

export async function runAuto(frame: PhotoFrame, provider: BrowserPreviewProvider, signal?: AbortSignal): Promise<AutoRun | AutoUnavailable | null> {
  const unavailable = (cause: AutoUnavailableCause): AutoUnavailable => ({ unavailable: cause, source: { stableKey: frame.stableKey, originalSha256: frame.originalSha256, framing: frame.framing } });
  const raw = !frame.isDemo && isRawPreviewFile(frame.filename);
  const url = raw ? null : await provider.getFullPreviewUrl(frame, 'selected');
  if (signal?.aborted) return null;
  if (!raw && !url) return unavailable('no-preview');
  // A RAW is analysed from its screen-size sensor develop (stored after import, or made now): the analysis works at 640 px
  // and the subject guide at most 2,400, so a full 45 MP develop (about 25 s for a Nikon Z 8) is never needed here.
  const developed = raw ? await loadAnalysisPicture(frame, provider, signal).catch(() => null) : null;
  if (signal?.aborted) return null;
  // Never analyse the camera's embedded JPEG as if it were the RAW; say why instead of finishing silently.
  if (raw && !developed) return unavailable('raw-not-developed');
  const source = developed ?? await loadImage(url!);
  if (signal?.aborted) return null;
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const edge = Math.max(source.naturalWidth, source.naturalHeight);
  const analysisCanvas = document.createElement('canvas');
  drawFramedPhoto(source, analysisCanvas, framing, { scale: Math.min(1, 640 / edge) });
  const context = analysisCanvas.getContext('2d', { willReadFrequently: true });
  if (!context || analysisCanvas.width < 16 || analysisCanvas.height < 16) return unavailable('too-small');
  const analysis = context.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  const category = subjectKindOf(frame);
  const base: PhotoEdit = frame.edit ?? DEFAULT_EDIT;

  let segmentation: { grid: SubjectGrid; confidence: 'high' | 'medium' | 'low'; detail?: SubjectDetail | null } | null = null;
  let species: SpeciesGuess | null = null;
  let instanceCount = 0;
  let subjectInstances: InstanceFinding[] = [];
  let instanceCoverageUnavailable = false;
  if (category !== 'landscape') {
    try {
      const guide = document.createElement('canvas');
      drawFramedPhoto(source, guide, framing, { scale: Math.min(1, GUIDED_RENDER_EDGE / edge) });
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        if (signal?.aborted) controller.abort();
        const instances = await withTimeout(detectSubjectInstances(guide, framingKey(framing), controller.signal), 12000, () => {
          controller.abort();
          return [];
        });
        instanceCount = instances.length;
        subjectInstances = instances;
        if (instances.length > 1) {
          segmentation = { grid: unionSubjectGrid(instances.map(i => i.mask), guide.height / guide.width),
            confidence: instances.every(i => i.mask.confidence === 'high') ? 'high' : 'medium' };
        } else if (instances.length === 1) {
          const mask = instances[0].mask;
          segmentation = { grid: mask.grid, confidence: mask.confidence, detail: mask.detail };
        } else {
          // The detector cannot distinguish no subjects from incomplete instance coverage.
          // Never substitute a dominant-subject mask after that uncertainty.
          instanceCoverageUnavailable = true;
        }
      } finally {
        controller.abort();
        signal?.removeEventListener('abort', cancel);
      }
    } catch { segmentation = null; instanceCoverageUnavailable = true; }
    if (signal?.aborted) return null;
    if (instanceCount === 1 && segmentation && category === 'wildlife' && !frame.subjectDisputed) species = await withTimeout(identifySubject(analysisCanvas), 15000, () => null);
  }
  if (signal?.aborted) return null;

  const photographyObservations = observationsFromFrame(frame);
  // Scene tags (golden hour, snow, fog, night, black and white...) are hints that only hold edits back.
  const sceneHints = sceneHintsFromPhotoTags(frame);
  const basePolicy = preservationPolicy(photographyObservations);
  const policy = { ...basePolicy, preserveDark: basePolicy.preserveDark || sceneHints.preserveDark === true };
  const natural = naturalAuto({ pixels: analysis.data, width: analysis.width, height: analysis.height, segmentation, iso: frame.exif?.iso, photographyObservations, sceneHints });
  if (natural.notes.includes('This preview is too small or too large to analyse.')) return unavailable('too-small');
  const global = mergeAutoSuggestion(base, natural.edit).edit;
  const input = { pixels: analysis.data, width: analysis.width, height: analysis.height, base, natural, segmentation, species, photographyObservations };
  const naturalPlan = planAuto({ ...input, proposal: global });
  let plan = naturalPlan;
  const recipes: Omit<AutoCandidate, 'after'>[] = [];
  const describeEdit = (edit: PhotoEdit, local = false) => acceptedAutoChanges(base, edit, local).map((change) => change.key === 'subjectMask'
    ? t.auto.subjectMaskAdded
    : change.direction === 'up' ? t.auto.adjustUp(t.controls[change.key]) : t.auto.adjustDown(t.controls[change.key])).join(' ');
  if (naturalPlan.verdict.kind === 'improved') {
    recipes.push({ id: 'natural', edit: naturalPlan.proposal, summary: describeEdit(naturalPlan.proposal) });
    // A different tone treatment: protect brighter detail and use a softer
    // contrast curve where the source actually has bright detail to protect.
    const { scene } = natural;
    // Not for snow or high-key frames: this alternative pulls the highlights down.
    if (scene.referenceP98 > 0.82 && scene.brightTextured > 0.015 && !sceneHints.preserveBright) {
      const balanced = stageNaturalRecipe(analysis.data, analysis.width, analysis.height, base, {
        ...naturalPlan.proposal,
        highlights: Math.max(-0.8, Math.min(naturalPlan.proposal.highlights ?? 0, base.highlights ?? 0) - 0.25),
        contrast: Math.max(-0.6, (naturalPlan.proposal.contrast ?? 0) - 0.2),
      }, segmentation);
      if (!sameRecipe(base, balanced.edit) && !sameRecipe(naturalPlan.proposal, balanced.edit)) {
        recipes.push({ id: 'balanced', edit: balanced.edit, summary: describeEdit(balanced.edit) });
      }
    }
  }
  if (instanceCount === 1 && segmentation && !policy.preserveDark) {
    const local = proposeSubjectAwareAuto({
      pixels: analysis.data, width: analysis.width, height: analysis.height, edit: global, subjectKind: category,
      segmentation, maskId: newId(), framingKey: framingKey(framing), extra: natural.subjectEdit,
    });
    if (local.usedMask) {
      const subjectPlan = planAuto({ ...input, proposal: local.edit });
      if (subjectPlan.verdict.kind === 'improved' && (subjectPlan.proposal.masks?.length ?? 0) > (base.masks?.length ?? 0)) {
        plan = subjectPlan;
        recipes.push({ id: 'subject', edit: subjectPlan.proposal, summary: describeEdit(subjectPlan.proposal, true) });
      }
    }
  }
  if (instanceCount > 1 && segmentation && !policy.preserveDark) {
    const subjects = subjectInstances.map(i => i.mask);
    const local = proposeGroupSubjectAuto(analysis.data, analysis.width, analysis.height, global, subjects,
      subjects.map(() => newId()), (frame.exif?.iso ?? 0) >= 1600);
    if (local !== global) {
      const subjectPlan = planAuto({ ...input, proposal: local });
      if (subjectPlan.verdict.kind === 'improved' && (subjectPlan.proposal.masks?.length ?? 0) > (base.masks?.length ?? 0)) {
        recipes.push({ id: 'subject', edit: subjectPlan.proposal, summary: describeEdit(subjectPlan.proposal, true) });
        plan = subjectPlan;
      }
    }
  }
  if (instanceCount > 1 && segmentation) {
    const subjects = subjectInstances.map(i => i.mask);
    for (let i = recipes.length - 1; i >= 0; i--) {
      if (!groupSubjectSafe(analysis.data, analysis.width, analysis.height, base, recipes[i].edit, subjects)) recipes.splice(i, 1);
    }
    if (!recipes.some(r => r.edit === plan.proposal)) {
      if (recipes.some(r => r.edit === naturalPlan.proposal)) plan = naturalPlan;
      else plan = { ...naturalPlan, proposal: base, verdict: { kind: 'cannot-improve-safely', reason: 'No preferred recipe passed every detected subject check' } };
    }
  }
  // Colour match: the species signature on file, only for a confidently named species on a reliable mask. The vision
  // model's expectation (the guardian lane) takes the same SubjectExpectation shape when it is available.
  const expectation = segmentation?.confidence === 'high' ? expectationForSpecies(species) : null;
  const rendered = recipes.length ? renderAutoCandidates(analysisCanvas, base, recipes, subjectInstances.map(instance => instance.mask), expectation) : { before: '', candidates: [], rejected: [] };
  if (!rendered.candidates.some((candidate) => candidate.edit === plan.proposal)
    && rendered.candidates.some((candidate) => candidate.edit === naturalPlan.proposal)) {
    plan = naturalPlan;
  }
  if (!rendered.candidates.some(candidate => candidate.edit === plan.proposal)) {
    // Never leave a preferred plan pointing at a rejected render. A surviving
    // alternative remains preview-only unless it was the checked preferred plan.
    plan = { ...plan, proposal: base, verdict: { kind: 'cannot-improve-safely', reason: rendered.rejected[0] ?? 'No preferred rendered edit passed all checks' } };
  }
  const described = describePlan(plan);
  const reference = segmentation?.confidence === 'high' ? speciesReference(species) : null;
  const improved = rendered.candidates.some((candidate) => candidate.edit === plan.proposal);
  const coverageNote = instanceCount > 1 && segmentation ? engineText.auto.multipleSubjects : instanceCoverageUnavailable ? engineText.auto.coverageUnavailable : null;
  return {
    ...rendered, plan, improved, detail: [...described.detail, ...(rendered.rejected.length ? [engineText.auto.withheld] : []), ...(coverageNote ? [coverageNote] : []), ...(reference ? [engineText.auto.speciesReference(reference.features)] : [])],
    headline: rendered.candidates.length ? engineText.auto.ready
      : recipes.length ? engineText.auto.noneDifferent : headlineFor(plan),
    source: { stableKey: frame.stableKey, originalSha256: frame.originalSha256, framing: frame.framing },
    colour: checkColour({ after: { data: analysis.data, width: analysis.width, height: analysis.height } }),
  };
}
