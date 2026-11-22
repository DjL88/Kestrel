import { mergeAutoSuggestion } from '../../core/autoEnhance';
import { acceptedAutoChanges } from '../../core/autoSuggestionSummary';
import { proposeSubjectAwareAuto, type InsightSubjectKind } from '../../core/insightSubjectAuto';
import { framingKey } from '../../core/maskTypes';
import { naturalAuto } from '../../core/naturalAuto';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto } from '../../core/photoFraming';
import { GUIDED_RENDER_EDGE } from '../../core/subjectGuide';
import type { SubjectDetail, SubjectGrid } from '../../core/maskTypes';
import type { PhotoFrame } from '../../core/types';
import { describePlan, planAuto, type AutoPlan } from '../../core/unifiedAuto';
import type { SpeciesGuess } from '../../core/speciesPalette';
import { newId } from '../../core/ids';
import { identifySubject } from '../../providers/autoSpecies';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadImage } from '../../providers/loadImage';
import { detectSubjectGuided } from '../../providers/subjectDetector';
import { editorText as t } from '../../i18n/areas/editor';

export interface AutoRun {
  plan: AutoPlan;
  headline: string;
  /** Measured facts and each adjustment that survived the safety gate, in plain sentences. */
  detail: string[];
  /** True when Auto found a change that passed the quality gate. */
  improved: boolean;
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
 * read or is too small to analyse. Uses only the preview, so it never reads or writes the original.
 */
export async function runAuto(frame: PhotoFrame, provider: BrowserPreviewProvider, signal?: AbortSignal): Promise<AutoRun | null> {
  const url = await provider.getFullPreviewUrl(frame, 'selected');
  if (!url || signal?.aborted) return null;
  const source = await loadImage(url);
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
  let proposal = mergeAutoSuggestion(base, natural.edit).edit;
  let usedMask = false;
  if (segmentation) {
    const local = proposeSubjectAwareAuto({
      pixels: analysis.data, width: analysis.width, height: analysis.height, edit: proposal, subjectKind: category,
      segmentation, maskId: newId(), framingKey: framingKey(framing), extra: natural.subjectEdit,
    });
    proposal = local.edit;
    usedMask = local.usedMask;
  }
  const plan = planAuto({ pixels: analysis.data, width: analysis.width, height: analysis.height, base, proposal, natural, segmentation, species });
  const improved = plan.verdict.kind === 'improved';
  const keptMask = improved && usedMask && (plan.proposal.masks?.length ?? 0) > (base.masks?.length ?? 0);
  const changes = (improved ? acceptedAutoChanges(base, plan.proposal, keptMask) : []).map((change) => change.key === 'subjectMask'
    ? t.auto.subjectMaskAdded
    : change.direction === 'up' ? t.auto.adjustUp(t.controls[change.key]) : t.auto.adjustDown(t.controls[change.key]));
  const described = describePlan(plan);
  return { plan, headline: described.headline, detail: [...described.detail, ...changes], improved };
}
