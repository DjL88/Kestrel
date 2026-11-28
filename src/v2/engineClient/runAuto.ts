import { proposeGroupSubjectAuto, groupSubjectSafe } from '../../core/groupSubjectAuto';
import type { InstanceFinding } from '../../providers/multiSubjectDetector';
import { detectSubjectInstances } from '../../providers/multiSubjectDetector';
import { subjectBox } from '../../core/subjectCrop';
import { proposeCrop, type SubjectFractions } from '../../core/proposeCrop';
import { unionSubjectGrid } from '../../core/subjectUnion';
import { speciesReference } from '../../core/speciesKnowledge';
import { observationsFromFrame, preservationPolicy } from '../../core/photographyPolicy';
import { sceneHintsFromPhotoTags } from '../../core/photoTagHints';
import { mergeAutoSuggestion } from '../../core/autoEnhance';
import { stripAutoLayer } from '../../core/autoLayer';
import { guardHighlights } from '../../core/autoHighlightGuard';
import { leanProposal, type Leaning } from '../../core/editStyle';
import { acceptedAutoChanges } from '../../core/autoSuggestionSummary';
import { proposeSubjectAwareAuto, type InsightSubjectKind } from '../../core/insightSubjectAuto';
import { framingKey } from '../../core/maskTypes';
import { naturalAuto, sameRecipe, stageNaturalRecipe } from '../../core/naturalAuto';
import { autoReasonKey } from '../../core/autoReasons';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto } from '../../core/photoFraming';
import { isRawPreviewFile } from '../../core/rawFormats';
import { GUIDED_RENDER_EDGE } from '../../core/subjectGuide';
import type { SubjectDetail, SubjectGrid } from '../../core/maskTypes';
import type { PhotoFrame } from '../../core/types';
import { describePlan, planAuto, settleAfterRender, type AutoPlan } from '../../core/unifiedAuto';
import { checkColour, type ColourReport } from '../../core/colourCheck';
import { measureCastCurve, type CastCurve } from '../../core/castCurve';
import { subjectWeights } from '../../core/naturalAuto';
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
import { timedStep } from '../../providers/previewTiming';

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
  /** The neutral areas' lean measured at a ladder of Temperature and Tint steps, so the cast advice is re-measured as the recipe changes (src/core/castCurve.ts). */
  castCurve?: CastCurve;
  /** The person's learnt leanings this suggestion was leaned by (personal style preview, off by default). Empty when none. */
  leanings?: Leaning[];
  /**
   * Where the subject is, offered so the canvas can suggest a crop (src/core/proposeCrop.ts). Only a high-confidence mask
   * gives one, and only when the core finds a better framing. It is a suggestion: nothing is cropped until it is accepted.
   */
  cropSuggestion?: { box: SubjectFractions };
  /** The photo already carries Auto's recipe and a fresh Auto would leave it exactly as it is: nothing is stacked. */
  alreadyEnhanced?: boolean;
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

/** Auto's lift ceiling before dark subjects could take up to 5 units: the fallback when the bigger lift fails a render check. */
const BIG_LIFT_FALLBACK_UNITS = 1.2;

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
/** One of the checks' English reasons in the person's language; null when it is not one InFlight knows. */
function reasonWords(reason: string | null | undefined): string | null {
  const key = autoReasonKey(reason);
  return key ? engineText.auto.reasons[key] : null;
}

/**
 * Auto's headline in the person's language. The verdict decides it. When nothing changed, the headline says why in plain
 * words (the cause, not one generic sentence); an unknown reason falls back to the generic line, never to raw English.
 */
function headlineFor(plan: AutoPlan, heldDark: boolean): string {
  switch (plan.verdict.kind) {
    case 'improved': return plan.verdict.outcome === 'gentler' ? engineText.auto.appliedGentler : engineText.auto.applied;
    case 'looks-good': return heldDark ? engineText.auto.reasons.keptDark : engineText.auto.looksGood;
    default: return reasonWords(plan.verdict.reason) ?? engineText.auto.cannotImprove;
  }
}

/**
 * `leanings` (personal style, a preview off by default) scale Auto's own global change for the sliders the person has
 * shown a consistent leaning on, before the quality gate checks it, so a leaned suggestion passes the same gate.
 */
export async function runAuto(frame: PhotoFrame, provider: BrowserPreviewProvider, signal?: AbortSignal, leanings: readonly Leaning[] = []): Promise<AutoRun | AutoUnavailable | null> {
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
  const current: PhotoEdit = frame.edit ?? DEFAULT_EDIT;
  // Auto replaces its own previous contribution instead of adding to it (src/core/autoLayer.ts): it works from the look
  // without Auto's last layer, and leaves alone any control the person moved since.
  const layer = stripAutoLayer(frame.edit, frame.editHistory);
  const base: PhotoEdit = layer.base;
  const keptKeys = new Set(layer.kept);

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
  // Marked (inflight:auto:*), so a trace or the stress test shows how long Auto's steps hold the page.
  const natural = timedStep('auto:natural', () => naturalAuto({ pixels: analysis.data, width: analysis.width, height: analysis.height, segmentation, iso: frame.exif?.iso, photographyObservations, sceneHints }));
  if (natural.notes.includes('This preview is too small or too large to analyse.')) return unavailable('too-small');
  // A scene tag InFlight measured itself (style.low-key) is not the person's intent: it never stops a dark subject being
  // lifted (wildlife is usually just underexposed), as in naturalAuto. The person's own tag, night and astro still do.
  const policy = { ...basePolicy, preserveDark: basePolicy.preserveDark || (sceneHints.preserveDark === true && sceneHints.darkMeasuredOnly !== true) };
  const leaned = leanProposal(base, mergeAutoSuggestion(base, natural.edit).edit, leanings);
  const global: PhotoEdit = { ...leaned.edit };
  for (const key of keptKeys) {
    if (key === 'masks') continue;
    const target = global as unknown as Record<string, unknown>; const mine = base as unknown as Record<string, unknown>;
    if (mine[key] === undefined) delete target[key]; else target[key] = mine[key];
  }
  const input = { pixels: analysis.data, width: analysis.width, height: analysis.height, base, natural, segmentation, species, photographyObservations, protectedKeys: layer.kept };
  // The highlight guard (src/core/autoHighlightGuard.ts): every plan is measured on its lifted render and bounded, so a
  // lift that rescues a dark subject cannot blow a bright sky. What it had to do is said in the detail lines.
  const guardNotes: string[] = [];
  const planGuarded = (proposal: PhotoEdit): AutoPlan => {
    const planned = planAuto({ ...input, proposal });
    if (planned.verdict.kind !== 'improved') return planned;
    const guard = guardHighlights({ pixels: analysis.data, width: analysis.width, height: analysis.height, base, proposal: planned.proposal });
    if (guard.action === 'none') return planned;
    if (!guard.satisfied) {
      guardNotes.push(engineText.auto.guard.held);
      return { ...planned, proposal: base, verdict: { kind: 'cannot-improve-safely', reason: 'Lifting this photo would blow out its highlights, so it was left as it is' } };
    }
    guardNotes.push(guard.action === 'recovered' ? engineText.auto.guard.recovered : guard.action === 'zoned' ? engineText.auto.guard.zoned : engineText.auto.guard.liftedLess);
    return { ...planned, proposal: guard.edit };
  };
  let naturalPlan = timedStep('auto:plan', () => planGuarded(global));
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
      const subjectPlan = planGuarded(local.edit);
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
      const subjectPlan = planGuarded(local);
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
  let rendered = recipes.length ? timedStep('auto:render', () => renderAutoCandidates(analysisCanvas, base, recipes, subjectInstances.map(instance => instance.mask), expectation)) : { before: '', candidates: [], rejected: [] as string[] };
  // A big dark-subject lift (above the old 1.2-unit ceiling) that the render checks refuse is retried at that ceiling,
  // so a dark photo still gets the gentler lift Auto always offered rather than nothing.
  const bigLift = natural.edit.exposure > BIG_LIFT_FALLBACK_UNITS;
  if (bigLift && recipes.length && !rendered.candidates.length && recipes.some(recipe => recipe.id === 'natural')) {
    const gentler = planGuarded({ ...global, exposure: Math.min(global.exposure ?? 0, BIG_LIFT_FALLBACK_UNITS) });
    if (gentler.verdict.kind === 'improved') {
      const retry = renderAutoCandidates(analysisCanvas, base, [{ id: 'natural', edit: gentler.proposal, summary: describeEdit(gentler.proposal) }],
        subjectInstances.map(instance => instance.mask), expectation);
      if (retry.candidates.length) { rendered = { ...retry, rejected: [...rendered.rejected, ...retry.rejected] }; plan = gentler; naturalPlan = gentler; }
    }
  }
  plan = settleAfterRender({
    plan, naturalPlan, base, recipeCount: recipes.length,
    candidateEdits: rendered.candidates.map((candidate) => candidate.edit), rejected: rendered.rejected,
  });
  // Auto's previous layer was taken out above; if the fresh recipe equals what the photo has now, nothing is stacked.
  const alreadyEnhanced = layer.stripped && sameRecipe(plan.proposal, current) && recipes.length > 0;
  plan = { ...plan, base: current };
  // The neutral reference excludes the subject (an orange kingfisher is not a cast) and expects warm light in golden hour.
  const subjectMap = segmentation && segmentation.confidence !== 'low' ? subjectWeights(segmentation.grid, analysis.width, analysis.height) ?? undefined : undefined;
  const castCurve = measureCastCurve({ pixels: analysis.data, width: analysis.width, height: analysis.height, subject: subjectMap, expectWarm: sceneHints.preserveLight === true }) ?? undefined;
  const described = describePlan(plan);
  const reference = segmentation?.confidence === 'high' ? speciesReference(species) : null;
  const improved = !alreadyEnhanced && rendered.candidates.some((candidate) => candidate.edit === plan.proposal);
  // A tag or the person's own words ("low key", night) took a lift away: say so, rather than "looks good" or "unsafe".
  const heldDark = natural.heldBack === 'dark-on-purpose';
  const rejectedWords = rendered.rejected.slice(0, 3).map((reason) => reasonWords(reason) ?? reason);
  const planReason = plan.verdict.kind === 'cannot-improve-safely' ? reasonWords(plan.verdict.reason) : null;
  const coverageNote = instanceCount > 1 && segmentation ? engineText.auto.multipleSubjects : instanceCoverageUnavailable ? engineText.auto.coverageUnavailable : null;
  return {
    ...rendered, plan, improved, ...(alreadyEnhanced ? { alreadyEnhanced } : {}), detail: [...described.detail, ...(improved ? guardNotes : []), ...(planReason && !rendered.candidates.length ? [planReason] : []), ...(rendered.rejected.length ? [engineText.auto.withheld, ...rejectedWords] : []), ...(coverageNote ? [coverageNote] : []), ...(subjectInstances.some((i) => i.mask.approximate) ? [engineText.workspace.subjectApproximate] : []), ...(reference ? [engineText.auto.speciesReference(reference.features)] : [])],
    headline: alreadyEnhanced ? engineText.auto.alreadyEnhanced : rendered.candidates.length ? engineText.auto.ready
      : recipes.length ? (rendered.rejected.length ? (reasonWords(rendered.rejected[0]) ?? engineText.auto.noneDifferent) : engineText.auto.noneDifferent) : headlineFor(plan, heldDark),
    source: { stableKey: frame.stableKey, originalSha256: frame.originalSha256, framing: frame.framing },
    colour: checkColour({ after: { data: analysis.data, width: analysis.width, height: analysis.height }, ...(subjectMap ? { subject: subjectMap } : {}) }),
    ...(castCurve ? { castCurve } : {}),
    leanings: leaned.applied,
    ...cropSuggestionFor(segmentation, analysis.width, analysis.height),
  };
}

/** The subject's box, only when the mask is reliable and the core would suggest a tighter crop for the picture's own shape. */
function cropSuggestionFor(segmentation: { grid: SubjectGrid; confidence: string } | null | undefined, width: number, height: number): { cropSuggestion?: { box: SubjectFractions } } {
  if (!segmentation || segmentation.confidence !== 'high') return {};
  const box = subjectBox(segmentation.grid);
  return box && proposeCrop({ box, imageWidth: width, imageHeight: height }) ? { cropSuggestion: { box } } : {};
}
