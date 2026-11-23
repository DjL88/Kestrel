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
import { detectSubjectGuided } from '../../providers/subjectDetector';
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
  if (category !== 'landscape') {
    try {
      const guide = document.createElement('canvas');
      drawFramedPhoto(source, guide, framing, { scale: Math.min(1, GUIDED_RENDER_EDGE / edge) });
      const detection = await withTimeout(detectSubjectGuided(guide), 12000, () => { throw new Error('Subject analysis timed out'); });
      if (detection.assessment.usable) segmentation = { grid: detection.grid, confidence: detection.assessment.confidence, detail: detection.detail };
    } catch { /* No usable subject outline: Auto then works on the whole frame and says so. */ }
    if (signal?.aborted) return null;
    if (segmentation && category === 'wildlife') species = await withTimeout(identifySubject(analysisCanvas), 15000, () => null);
  }
  if (signal?.aborted) return null;

  const natural = naturalAuto({ pixels: analysis.data, width: analysis.width, height: analysis.height, segmentation, iso: frame.exif?.iso });
  if (natural.notes.includes('This preview is too small or too large to analyse.')) return null;
  const global = mergeAutoSuggestion(base, natural.edit).edit;
  const input = { pixels: analysis.data, width: analysis.width, height: analysis.height, base, natural, segmentation, species };
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
  if (segmentation) {
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
  const rendered = recipes.length ? renderAutoCandidates(analysisCanvas, base, recipes) : { before: '', candidates: [] };
  if (!rendered.candidates.some((candidate) => candidate.edit === plan.proposal)
    && rendered.candidates.some((candidate) => candidate.edit === naturalPlan.proposal)) {
    plan = naturalPlan;
  }
  const described = describePlan(plan);
  const improved = rendered.candidates.some((candidate) => candidate.edit === plan.proposal);
  return {
    ...rendered, plan, improved, detail: described.detail,
    headline: rendered.candidates.length ? 'Checked edit suggestions are ready to preview.'
      : recipes.length ? 'No visibly different edit passed the checks.' : described.headline,
    source: { stableKey: frame.stableKey, originalSha256: frame.originalSha256, framing: frame.framing },
  };
}
