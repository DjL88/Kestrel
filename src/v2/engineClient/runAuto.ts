import { proposeGroupSubjectAuto, groupSubjectSafe } from '../../core/groupSubjectAuto';
import type { InstanceFinding } from '../../providers/multiSubjectDetector';
import { detectSubjectInstances } from '../../providers/multiSubjectDetector';
import { unionSubjectGrid } from '../../core/subjectUnion';
import { speciesReference } from '../../core/speciesKnowledge';
import { observationsFromFrame, preservationPolicy } from '../../core/photographyPolicy';
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
import type { SpeciesGuess } from '../../core/speciesPalette';
import { newId } from '../../core/ids';
import { identifySubject } from '../../providers/autoSpecies';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadImage } from '../../providers/loadImage';
import { loadExportSource } from '../../providers/browserExport';
import { editorText as t } from '../../i18n/areas/editor';
import { renderAutoCandidates, type AutoCandidate } from './renderAutoCandidates';

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
 * applied here: the caller decides (Co-pilot suggests, Auto-pilot applies). Returns null when the picture cannot be
 * read or is too small to analyse. RAW advice uses the sensor-developed preview when available. Original files are read only.
 */
export async function runAuto(frame: PhotoFrame, provider: BrowserPreviewProvider, signal?: AbortSignal): Promise<AutoRun | null> {
  const raw = !frame.isDemo && isRawPreviewFile(frame.filename);
  const url = raw ? null : await provider.getFullPreviewUrl(frame, 'selected');
  if ((!raw && !url) || signal?.aborted) return null;
  const source = raw ? await loadExportSource(frame, provider) : await loadImage(url!);
  if (signal?.aborted || (raw && !provider.isDeveloped(frame.stableKey))) return null;
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const edge = Math.max(source.naturalWidth, source.naturalHeight);
  const analysisCanvas = document.createElement('canvas');
  drawFramedPhoto(source, analysisCanvas, framing, { scale: Math.min(1, 640 / edge) });
  const context = analysisCanvas.getContext('2d', { willReadFrequently: true });
  if (!context || analysisCanvas.width < 16 || analysisCanvas.height < 16) return null;
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
  const policy = preservationPolicy(photographyObservations);
  const natural = naturalAuto({ pixels: analysis.data, width: analysis.width, height: analysis.height, segmentation, iso: frame.exif?.iso, photographyObservations });
  if (natural.notes.includes('This preview is too small or too large to analyse.')) return null;
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
    if (scene.referenceP98 > 0.82 && scene.brightTextured > 0.015) {
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
  const rendered = recipes.length ? renderAutoCandidates(analysisCanvas, base, recipes, subjectInstances.map(instance => instance.mask)) : { before: '', candidates: [], rejected: [] };
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
  const coverageNote = instanceCount > 1 && segmentation ? 'Multiple detected subjects were checked individually for clipping and shadow loss. Local tone edits require reliable non-overlapping masks; species colour correction was withheld.' : instanceCoverageUnavailable ? 'Complete subject coverage was unavailable; only whole-frame suggestions were considered.' : null;
  return {
    ...rendered, plan, improved, detail: [...described.detail, ...rendered.rejected.map(reason => 'A rendered suggestion was withheld: ' + reason), ...(coverageNote ? [coverageNote] : []), ...(reference ? ['Species reference (not a measured colour target): ' + reference.features] : [])],
    headline: rendered.candidates.length ? 'Checked edit suggestions are ready to preview.'
      : recipes.length ? 'No visibly different edit passed the checks.' : described.headline,
    source: { stableKey: frame.stableKey, originalSha256: frame.originalSha256, framing: frame.framing },
  };
}
