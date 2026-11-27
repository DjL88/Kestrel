import { readExternalEdit } from '../../core/externalEdit';
import type { UnsupportedRawCompression } from '../../core/rawCompression';
import { readHdrMergeRecipe } from '../../core/hdrMergeRecipe';
import { pictureProvenance, type PictureSource } from '../../core/pictureSource';
import { readFocusStackRecipe } from '../../core/focusStackRecipe';
import { readPanoramaRecipe } from '../../core/panoramaRecipe';
import { applyFormats, applySizeLinked } from './formatOps';
import { framedSize, DEFAULT_FRAMING } from '../../core/photoFraming';
import { readVideoZoom } from './videoZoomOps';
import { readSplitFrames, readSplitPanOffset } from './splitFrameOps';
import { readFormatSplits } from './formatSplitOps';
import { describeHistory } from './historySteps';
import { describeCheckpoints, describeEditVersions, readEditVersions } from '../../core/editBranches';
import { readFormatHistory } from './formatHistory';
import type { PhotoFrame, ShootDescriptor } from '../../core/types';
import type { EditStatus } from '../../core/editStatus';
import type { CameraAfAreaMode, CameraFocus } from '../../core/cameraFocus';
import { computeCullCounts } from '../../core/cullingEngine';
import type { Photo, Project, TaskInfo, TileState } from '../ui/contract';
import { createDefaultSizes, createEditGroups } from '../ui/stub';
import { editToRecipe } from './recipeMap';
import { readOverlay } from './overlayOps';
import { readEditGroups } from './editGroupState';
import { masksToLayers } from './maskOps';
import { healToSpots } from './healOps';
import { readCrops } from './cropOps';
import { readBoard } from './boardOps';
import type { AutoRun } from './runAuto';
import { guardianNote, type AssistGuardian } from './assistGuardian';
import { autoUnavailableMatches, autoUnavailableSentence, type AutoUnavailable } from './autoUnavailable';
import { colourAreas, colourWarningSentences, colourWords, describeColourMatch, describeColourSense } from './colourWords';
import { colourVerdict } from '../../core/colourVerdict';
import { sameRecipe } from '../../core/naturalAuto';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { isRawPreviewFile, shownFileFormat } from '../../core/rawFormats';
import { STRINGS } from '../ui/strings';
import { engineText } from '../../i18n/areas/engine';
import { editorText } from '../../i18n/areas/editor';
import type { Leaning } from '../../core/editStyle';
import { displaySpeciesName } from '../../core/speciesNames';
import { STARTER_TAGS } from '../../core/subjectTags';
import { areaWords, speciesAreaText } from '../../i18n/areas/speciesArea';
import { speciesNameIndex } from '../../providers/speciesNames';
import type { AssistSuggestion, EditRecipe, PhotoHistogram } from '../ui/contract';
import type { Task } from '../../core/taskStore';
import { buildEditingSequence } from '../../core/editingSequence';
import type { PhotoEdit } from '../../core/photoEdits';
import { VEHICLE_LABELS } from '../../core/vehicleLabels';
import { validVehicleReading, vehicleLabel } from '../../core/vehicleRecognition';
import { sharedPhotoKey } from '../../core/sharedSync';
import { vehicleText } from '../../i18n/areas/vehicles';
import { photoTagsOf, tagWords } from '../../core/photoTags';
import { photoTagEnglishLabel, photoTagLabel, photoTagsText } from '../../i18n/areas/photoTags';

/** A transparent pixel, so a photo whose picture is not ready yet shows an empty tile rather than a broken image. */
export const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** What Auto found for a photo, and what the person has done with it. */
export interface AssistState {
  run: AutoRun;
  dismissed: string[];
  /** The vision guardian's second opinion on each suggestion (assistGuardian.ts). It advises; it never changes a suggestion. */
  guardian?: AssistGuardian;
  /** The recipe Co-pilot applied by itself (its small, safe subset of this run's suggestion). While the photo still has exactly this recipe, the suggestions stay offered and applying one is not stale. */
  safeApplied?: PhotoEdit;
}

/** The file's own edit evidence in the person's words: a short label and one sentence on what it rests on. */
export function editStatusWords(status: EditStatus): NonNullable<Photo['editStatus']> {
  const words = STRINGS.info;
  const label = status.kind === 'edited-elsewhere' ? words.editStatusEdited : status.kind === 'camera' ? words.editStatusCamera : words.editStatusUnknown;
  const first = status.evidence[0];
  const detail = !first ? words.evidenceNone
    : first.kind === 'develop-settings' ? words.evidenceDevelop
      : first.kind === 'edit-history' ? (first.app ? words.evidenceApp(first.app) : words.evidenceHistory)
        : first.kind === 'editing-app' ? words.evidenceApp(first.app)
          : first.kind === 'content-credentials' ? words.evidenceCredentials
            : first.kind === 'sidecar' ? (first.app ? words.evidenceSidecarApp(first.app) : words.evidenceSidecar)
              : first.kind === 'raw-file' ? words.evidenceRaw
              : first.kind === 'maker-notes' ? words.evidenceMakerNotes
                : words.evidenceUnrecognised(first.app);
  return { kind: status.kind, label, detail };
}

/** The camera's own focus record in the person's words: the AF mode, then the camera's verdict and where its AF area sat. */
export function cameraFocusWords(focus: CameraFocus): NonNullable<Photo['cameraFocus']> {
  const words = STRINGS.info;
  const modes: Record<CameraAfAreaMode, string> = {
    pinpoint: words.cameraFocusPinpoint, single: words.cameraFocusSingle, dynamic: words.cameraFocusDynamic,
    'wide-s': words.cameraFocusWideS, 'wide-l': words.cameraFocusWideL, 'wide-custom': words.cameraFocusWideCustom,
    auto: words.cameraFocusAuto, '3d-tracking': words.cameraFocus3d,
  };
  const verdict = focus.focusConfirmed === true ? words.cameraFocusConfirmed : focus.focusConfirmed === false ? words.cameraFocusNotConfirmed : '';
  // Words describe the picture as shown, so they use the turned box when there is one.
  const shown = focus.uprightArea ?? focus.area;
  const place = shown
    ? words.cameraFocusAt(Math.round((shown.x + shown.width / 2) * 100), Math.round((shown.y + shown.height / 2) * 100))
    : words.cameraFocusNoBox;
  return {
    label: focus.areaMode ? modes[focus.areaMode] : words.cameraFocusModeUnknown,
    detail: [verdict, place].filter(Boolean).join(' '),
    ...(focus.uprightArea ? { area: focus.uprightArea } : {}),
  };
}

export function matchesAutoSource(run: AutoRun, frame: PhotoFrame): boolean {
  return frame.removedAt == null && run.source.stableKey === frame.stableKey &&
    run.source.originalSha256 === frame.originalSha256 && run.source.framing === frame.framing;
}

/** Only the sliders Auto would move, in the UI's units. */
export function recipeDelta(base: Parameters<typeof editToRecipe>[0], proposal: Parameters<typeof editToRecipe>[0]): Partial<EditRecipe> {
  const before = editToRecipe(base), after = editToRecipe(proposal);
  return Object.fromEntries((Object.keys(after) as (keyof EditRecipe)[]).filter((key) => before[key] !== after[key]).map((key) => [key, after[key]])) as Partial<EditRecipe>;
}

/** The on-screen slider names, so a step points at the slider the person can find in Adjust. */
const effects = STRINGS.adjust.effects;
export const STEP_LABELS: Record<string, string> = {
  ...engineText.steps,
  // Effects, grading and calibration reuse the words their own panels show, so a step names the slider exactly.
  colourGrade: STRINGS.adjust.grade.heading, dehaze: effects.dehaze, vignette: effects.vignette,
  vignetteSize: `${effects.vignette}: ${effects.size}`, vignetteBlur: `${effects.vignette}: ${effects.blur}`,
  vignetteColour: effects.colourPick, grain: effects.grain, grainSize: effects.grainSize,
  vignetteRoundness: `${effects.vignette}: ${effects.roundness}`, vignetteFeather: `${effects.vignette}: ${effects.feather}`,
  vignetteHighlights: `${effects.vignette}: ${effects.highlights}`, grainRoughness: effects.roughness,
  calibration: STRINGS.adjust.calibration.heading,
  channelCurves: `${STRINGS.adjust.curve.heading} (${STRINGS.adjust.curve.channels.red}, ${STRINGS.adjust.curve.channels.green}, ${STRINGS.adjust.curve.channels.blue})`,
};

const stepValue = (value: unknown) => typeof value === 'number' ? String(Number(value.toFixed(2))) : value === undefined ? '0' : STRINGS.copilot.stepChanged;

/** Auto's accepted recipe as ordered steps in the UI's slider units, with local adjustments counted. */
export function suggestionSteps(base: PhotoEdit, proposal: PhotoEdit): NonNullable<AssistSuggestion['steps']> {
  const before = { ...editToRecipe(base), masks: base.masks?.length ?? 0 };
  const after = { ...editToRecipe(proposal), masks: proposal.masks?.length ?? 0 };
  return buildEditingSequence(before, after, ['lookId']).map((step) => ({
    id: step.id, key: step.key, label: STEP_LABELS[step.key] ?? step.key, from: stepValue(step.from), to: stepValue(step.to),
  }));
}

/**
 * Personal style (a preview, off by default): how Auto's suggestion was leaned, in plain words. British English only
 * while this is a preview; the words move into the V2 i18n area before it is switched on.
 */
export function styleNoteFor(leanings: readonly Leaning[] | undefined): string | undefined {
  if (!leanings?.length) return undefined;
  const names: Record<string, string> = { ...editorText.controls, tint: STEP_LABELS.tint ?? 'Tint', dehaze: STEP_LABELS.dehaze ?? 'Dehaze' };
  const parts = leanings.map((leaning) => {
    const percent = Math.round(Math.abs(leaning.multiplier - 1) * 100);
    return `${names[leaning.key] ?? leaning.key} ${percent}% ${leaning.multiplier < 1 ? 'less' : 'more'} (from ${leaning.examples} photos)`;
  });
  return `Leaned towards your own edits: ${parts.join(', ')}. Learnt on this device from what you kept, undid or corrected. Nothing is sent anywhere.`;
}

export function assistCritiqueFor(assist: AssistState | undefined, currentEdit = DEFAULT_EDIT): Photo['assistCritique'] {
  if (!assist) return { subjectNote: '', colourConfidence: '', kelvinEstimate: '', suggestions: [] };
  const { run } = assist;
  const matching = run.candidates.find((candidate) => candidate.edit === currentEdit);
  const fromBase = sameRecipe(run.plan.base, currentEdit) || (assist.safeApplied !== undefined && currentEdit === assist.safeApplied);
  const available = matching ? [matching] : fromBase ? run.candidates : [];
  const suggestions: AssistSuggestion[] = available.filter((candidate) => !assist.dismissed.includes(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      title: STRINGS.copilot.treatments[candidate.id],
      summary: candidate.summary || run.headline,
      colourReadout: run.plan.species.reason,
      applied: candidate === matching,
      recipeDelta: recipeDelta(run.plan.base, candidate.edit),
      steps: suggestionSteps(run.plan.base, candidate.edit),
      comparison: { before: run.before, after: candidate.after },
      colourSense: describeColourSense(candidate.colourSense),
      colourMatch: describeColourMatch(candidate.colourMatch),
      secondOpinion: guardianNote(assist.guardian, candidate.id),
      ...(run.leanings?.length ? { styleNote: styleNoteFor(run.leanings) } : {}),
    }));
  return {
    subjectNote: run.headline,
    // The warnings are said in words from the colour check, never as the check's internal codes.
    colourConfidence: [run.detail[1], ...colourWarningSentences(run.colour)].filter(Boolean).join(' '),
    colourCheck: run.colour ? colourWords(run.colour) : undefined,
    ...(run.colour ? { colourVerdict: colourVerdict(run.colour) } : {}),
    ...(run.colour && colourAreas(run.colour).length ? { colourAreas: colourAreas(run.colour) } : {}),
    kelvinEstimate: '',
    suggestions,
  };
}

export interface FrameUrls { thumb?: string; preview?: string; failed?: boolean; /** The original is there but its compression can't be read yet. */ unsupported?: UnsupportedRawCompression }

const NOT_RECORDED = engineText.notRecorded;

/**
 * The words beside the histogram's title: the camera's as-shot white when the RAW develop worked it out ("As shot about
 * 5,600 K (estimated)"), otherwise nothing. It used to say "Not measured" (of the colour temperature) for every photo,
 * which read as if the histogram itself was not measured, right above "Measured from the 16-bit RAW develop".
 */
export function asShotWords(frame: Pick<PhotoFrame, 'asShotWhite'>): string {
  const kelvin = frame.asShotWhite?.kelvin;
  return typeof kelvin === 'number' && Number.isFinite(kelvin) && kelvin > 0
    ? STRINGS.adjust.kelvin.asShot.replace('{k}', Math.round(kelvin).toLocaleString('en-GB')) : '';
}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Only the two known import identity schemes encode the original byte count. */
export function recordedFileSizeMb(key: string): number {
  if (!/^local-(?:file|linked):\/\//.test(key)) return 0;
  const parts = /::(\d+)::\d+$/.exec(key);
  const bytes = parts ? Number(parts[1]) : 0;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes / 1_000_000 : 0;
}

const titleOf = (filename: string) => filename.replace(/\.[^./\\]+$/, '');
const extensionOf = (filename: string) => /\.([^./\\]+)$/.exec(filename)?.[1]?.toUpperCase();

/** A photo's vehicle reading as words in the person's language, and the words it can be searched by (also in English). */
export function vehicleWordsOf(frame: Pick<PhotoFrame, 'vehicle'>): { vehicleLabel?: string; vehicleKind?: string; vehicleType?: string } {
  const reading = validVehicleReading(frame.vehicle, VEHICLE_LABELS);
  if (!reading) return {};
  return {
    vehicleLabel: vehicleLabel(reading, VEHICLE_LABELS, vehicleText),
    ...(reading.kind ? { vehicleKind: reading.kind } : {}),
    ...(reading.type ? { vehicleType: reading.type } : {}),
  };
}

/** The subject name for a photo. A name the app suggested itself is marked as a suggestion; nothing is shown when unknown. */
/** The photo's tags in the person's words. A tag with no words in any language is not shown (never a raw id). */
export function photoTagViews(frame: Pick<PhotoFrame, 'stableKey' | 'photoTags'>): NonNullable<Photo['photoTags']> {
  return photoTagsOf(frame).flatMap((tag) => {
    const label = tagWords(tag, photoTagLabel, photoTagsText.probably);
    if (!label) return [];
    const english = tagWords(tag, photoTagEnglishLabel);
    return [{ id: tag.id, facet: tag.facet, label, words: english && english !== label ? [label, english] : [label] }];
  });
}

/** The tag that names the species: a species name wins over a kind word such as "Bird" or "Perched" that comes first. */
function speciesTagOf(frame: Pick<PhotoFrame, 'tags'>): string | undefined {
  return frame.tags?.find((entry) => !STARTER_TAGS.wildlife.some((word) => word.toLowerCase() === entry.toLowerCase())) ?? frame.tags?.[0];
}

export function speciesLabelOf(frame: Pick<PhotoFrame, 'subjectNames' | 'tags' | 'autoTags'>): string | undefined {
  // Shown in the person's language: the local name, else the scientific name; a name nobody knows stays as stored.
  const shown = (name: string) => displaySpeciesName(name, speciesNameIndex()).name;
  const chosen = frame.subjectNames?.[0];
  if (chosen) return shown(chosen);
  const tag = speciesTagOf(frame);
  if (!tag) return undefined;
  return frame.autoTags?.includes(tag) ? engineText.suggestedName(shown(tag)) : shown(tag);
}

/** The shown species name is InFlight's own suggestion (not one the person chose), so it can be looked at again. */
export function speciesAutoOf(frame: Pick<PhotoFrame, 'subjectNames' | 'tags' | 'autoTags'>): boolean {
  const tag = speciesTagOf(frame);
  return !frame.subjectNames?.length && !!tag && !!frame.autoTags?.includes(tag) && !STARTER_TAGS.wildlife.some((word) => word.toLowerCase() === tag.toLowerCase());
}

/** The place an automatic species name was matched against, in the person's words; nothing for a name of the person's own or an older photo. */
export function speciesAreaLabelOf(frame: Pick<PhotoFrame, 'subjectNames' | 'tags' | 'autoTags' | 'speciesArea'>): string | undefined {
  const tag = speciesTagOf(frame);
  if (!frame.speciesArea || frame.subjectNames?.length || !tag || !frame.autoTags?.includes(tag)) return undefined;
  return speciesAreaText.matchedIn(areaWords(frame.speciesArea, []));
}

/** Importing only while the import now running is adding this photo; a photo whose thumbnail is just on its way otherwise
 * says nothing (its tile stays a quiet empty square until the thumbnail arrives). */
export function tileStateFor(urls: FrameUrls | undefined, beingImported = true): TileState {
  if (urls?.unsupported) return 'unsupported';
  if (urls?.failed) return 'unavailable';
  return urls?.thumb || !beingImported ? 'ready' : 'importing';
}

/**
 * One catalogue photo as the V2 UI's Photo. Only what the catalogue actually holds is filled in: a field the file did
 * not record says "Not recorded" (or is left empty), never an invented value. The edit, size and mask parts start as the
 * UI's neutral defaults; they are connected to the real recipe in a later step.
 */
export interface PhotoExtras { /** The import now running is adding this photo (it says Importing until its thumbnail arrives). */ beingImported?: boolean; pixelSize?: { width: number; height: number }; /** Measured from a connected, decoded JPEG/PNG original, not EXIF or a preview. */ verifiedOriginalSize?: { width: number; height: number }; assist?: AssistState; /** Auto tried and could not look at this photo, with the reason. */ autoUnavailable?: AutoUnavailable; watermarkAuto?: 'light-on-dark' | 'dark-on-light'; histogram?: PhotoHistogram; originalConnected?: boolean; /** What the provider recorded for each address (BrowserPreviewProvider.pictureSourceOf). */ sources?: { preview?: PictureSource; thumb?: PictureSource }; dngCopy?: boolean; /** The develop is being made now; otherwise offered when it can be made here. */ fullDevelop?: 'possible' | 'running' }

/** Decoded JPEG/PNG pixel size (after framing), or null when not measured. */
function verifiedFormatSize(frame: PhotoFrame, verifiedOriginalSize?: { width: number; height: number }): { width: number; height: number } | null {
  return verifiedOriginalSize && /\.(?:jpe?g|png)$/i.test(frame.filename) &&
    Number.isSafeInteger(verifiedOriginalSize.width) && Number.isSafeInteger(verifiedOriginalSize.height) &&
    verifiedOriginalSize.width > 0 && verifiedOriginalSize.height > 0
    ? framedSize(verifiedOriginalSize.width, verifiedOriginalSize.height, frame.framing ?? DEFAULT_FRAMING) : null;
}

/**
 * The Original format's shape: decoded JPEG/PNG pixels when known, otherwise recorded EXIF dimensions. Everything that
 * asks "which formats does this photo have?" (the canvas, Duplicate, Delete) must use this one rule, or a photo without
 * EXIF dimensions shows Original on the canvas while the actions think it is switched off.
 */
export function originalFormatSize(frame: PhotoFrame, verifiedOriginalSize?: { width: number; height: number }, shownSize?: { width: number; height: number }): { width: number; height: number } | null {
  const nativeSize = verifiedFormatSize(frame, verifiedOriginalSize);
  const { exif } = frame;
  // Recorded sensor dimensions are evidence for the *format shape*, not proof
  // that a preview-only RAW has full native pixels available to export.
  const reportedSize = exif.width && exif.height && Number.isSafeInteger(exif.width) &&
    Number.isSafeInteger(exif.height) && exif.width > 0 && exif.height > 0
    ? framedSize(exif.width, exif.height, frame.framing ?? DEFAULT_FRAMING) : null;
  // A RAW or HEIF whose file records no usable size (a NEF's first directory is a 160 × 120 thumbnail) takes its shape
  // from the picture actually shown. Without this the Original was a 1 × 1 square, so the canvas and crop showed a
  // square cut of a 3:2 photo. The renderer still caps every export at the source's real pixels.
  const measured = shownSize && Number.isSafeInteger(shownSize.width) && Number.isSafeInteger(shownSize.height) &&
    shownSize.width > 0 && shownSize.height > 0
    ? framedSize(shownSize.width, shownSize.height, frame.framing ?? DEFAULT_FRAMING) : null;
  return nativeSize ?? reportedSize ?? measured;
}

export function frameToPhoto(frame: PhotoFrame, urls: FrameUrls | undefined, extras: PhotoExtras = {}): Photo {
  const { assist, watermarkAuto, histogram, pixelSize, verifiedOriginalSize, sources } = extras;
  const shownPreview = pictureProvenance(urls?.preview ? sources?.preview : sources?.thumb, frame.rawCodec);
  const shownThumb = pictureProvenance(sources?.thumb, frame.rawCodec);
  const { exif } = frame;
  const nativeSize = verifiedFormatSize(frame, verifiedOriginalSize);
  const originalSize = originalFormatSize(frame, verifiedOriginalSize, pixelSize);
  const recordedDimensions = nativeSize && verifiedOriginalSize ? verifiedOriginalSize : positive(exif.width) && positive(exif.height) && Number.isSafeInteger(exif.width) && Number.isSafeInteger(exif.height) ? { width: exif.width, height: exif.height } : null;
  const rating = frame.rating ?? exif.rating ?? 0;
  const captured = typeof exif.capturedAtMs === 'number' && Number.isFinite(new Date(exif.capturedAtMs).getTime()) ? new Date(exif.capturedAtMs).toLocaleString('en-GB') : NOT_RECORDED;
  // The UI's sample group carries a made-up look. A real photo starts from its own edit: neutral until the person edits it.
  const board = readBoard(frame.boardPositions);
  const crops = readCrops(frame.sizeCrops);
  const savedGroups = readEditGroups(frame);
  const groups = savedGroups.groups.map((saved) => ({
    ...createEditGroups(false)[0],
    id: saved.id,
    name: saved.name,
    recipe: { ...editToRecipe(saved.edit), lookId: saved.id === savedGroups.activeId ? frame.appliedLookId ?? 'none' : 'none' },
    overlay: readOverlay(frame.overlay),
    splitFrames: readSplitFrames(frame.splitFrames),
    splitPanOffset: readSplitPanOffset(frame.splitPanOffset),
  }));
  const thumb = urls?.thumb ?? BLANK_IMAGE;
  return {
    id: frame.id,
    sharedKey: frame.cloudPhoto && !frame.virtualCopy ? frame.cloudPhoto.photoKey : sharedPhotoKey(frame.originalSha256, frame.virtualCopy?.number),
    cloudPreview: frame.cloudPhoto && !frame.cloudPhoto.hasOriginal ? true : undefined,
    filename: frame.filename,
    title: titleOf(frame.filename),
    previewUrl: urls?.preview ?? thumb,
    thumbUrl: thumb,
    state: tileStateFor(urls, extras.beingImported ?? true),
    decision: frame.decision,
    originalConnected: extras.originalConnected ?? !urls?.failed,
    rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0,
    speciesLabel: speciesLabelOf(frame),
    ...(speciesAutoOf(frame) ? { speciesAuto: true } : {}),
    speciesAreaLabel: speciesAreaLabelOf(frame),
    ...vehicleWordsOf(frame),
    speciesName: frame.subjectNames?.[0] ?? frame.tags?.[0],
    // What kind of subject, in the person's language (never the detector's internal word).
    category: frame.subjectKind ? engineText.subjectKinds[frame.subjectKind] : '',
    photoTags: photoTagViews(frame),
    sharpnessScore: frame.cullScore ?? 0,
    ...(exif.editStatus ? { editStatus: editStatusWords(exif.editStatus) } : {}),
    ...(exif.cameraFocus ? { cameraFocus: cameraFocusWords(exif.cameraFocus) } : {}),
    ...(typeof exif.capturedAtMs === 'number' && Number.isFinite(exif.capturedAtMs) ? { capturedAtMs: exif.capturedAtMs } : {}),
    exif: {
      camera: exif.camera ?? NOT_RECORDED,
      lens: exif.lens ?? NOT_RECORDED,
      aperture: exif.apertureF ? `f/${exif.apertureF}` : NOT_RECORDED,
      shutter: exif.shutterSpeed ?? NOT_RECORDED,
      iso: positive(exif.iso) ? exif.iso : 0,
      focalLength: exif.focalLengthMm ? `${exif.focalLengthMm}mm` : NOT_RECORDED,
      capturedAt: captured,
      fileFormat: shownFileFormat(frame.filename, exif.formatLabel) ?? extensionOf(frame.filename) ?? NOT_RECORDED,
      fileSizeMb: recordedFileSizeMb(frame.stableKey),
      dimensions: recordedDimensions ? `${recordedDimensions.width} × ${recordedDimensions.height}` : NOT_RECORDED,
      // InFlight's RAW develop records the as-shot white only after it has validated the camera's own colour matrix, so that
      // is the evidence the picture came from it. Anything else (an embedded preview, a JPEG's own profile) stays unknown.
      colourProfile: isRawPreviewFile(frame.filename) && frame.asShotWhite ? STRINGS.info.rawColourSource : NOT_RECORDED,
    },
    ...(nativeSize ? { pixelSize: { width: nativeSize.width, height: nativeSize.height } } : exif.width && exif.height ? { pixelSize: { width: exif.width, height: exif.height } } : pixelSize ? { pixelSize } : {}),
    activeGroupId: savedGroups.activeId,
    editGroups: groups,
    sizes: applySizeLinked(applyFormats(createDefaultSizes(), frame.formats, originalSize).map((size) => { const crop = crops[size.id]; const at = board[size.id]; return { ...size, ...(crop ? { crop } : {}), ...(at ? { boardX: at.x, boardY: at.y } : {}) }; }), frame.sizeLinked),
    formatSplits: frame.formatSplits === undefined && frame.splitFrames === true
      ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } }
      : readFormatSplits(frame.formatSplits),
    videoZoom: readVideoZoom(frame.videoZoom),
    masks: masksToLayers(frame.edit?.masks),
    healSpots: healToSpots(frame.edit?.heal),
    ...(frame.asShotWhite ? { asShotKelvin: Math.round(frame.asShotWhite.kelvin) } : {}),
    ...(frame.burstGroupId && frame.burstCount > 1 ? { burst: { groupId: frame.burstGroupId, index: frame.burstIndex, count: frame.burstCount, ungrouped: Boolean(frame.burstUngrouped), ...(typeof frame.cullScore === 'number' ? { score: frame.cullScore } : {}) } } : {}),
    ...(describeHistory(frame.editHistory)
      ? { editHistory: describeHistory(frame.editHistory) }
      : frame.editHistory && readEditVersions(frame.editVersions)
        ? { editHistory: {
            steps: [], cursor: 0, originalAvailable: (frame.editHistory.discarded ?? 0) === 0,
          } }
        : {}),
    ...(readEditVersions(frame.editVersions)
      ? { editVersions: {
          activeId: readEditVersions(frame.editVersions)!.activeId,
          versions: describeEditVersions(frame.editVersions),
        } }
      : {}),
    ...(describeCheckpoints(frame.editCheckpoints).length ? { editCheckpoints: describeCheckpoints(frame.editCheckpoints) } : {}),
    ...(frame.formatHistory ? { formatHistory: readFormatHistory(frame.formatHistory).events.map(({ formatId, kind, at, parentFormatId, forkEditCursor, after }) => ({ formatId, kind, at, ...(parentFormatId ? { parentFormatId } : {}), ...(forkEditCursor !== undefined ? { forkEditCursor } : {}), ...(kind === 'crop' && after ? { crop: after } : {}) })) } : {}),
    ...(watermarkAuto ? { watermarkAuto } : {}),
    ...(histogram ? { histogram } : {}),
    ...(readExternalEdit(frame.externalEdit) ? { externalEdit: readExternalEdit(frame.externalEdit) } : {}),
    ...(extras.dngCopy ? { dngCopy: true } : {}),
    ...(readPanoramaRecipe(frame.panorama) ? { panorama: { sources: frame.panorama!.sources.map((source) => source.filename) } } : {}),
    ...(readFocusStackRecipe(frame.focusStack) ? { focusStack: { sources: frame.focusStack!.sources.map((source) => source.filename) } } : {}),
    ...(readHdrMergeRecipe(frame.hdrMerge) ? { hdrMerge: { sources: frame.hdrMerge!.sources.map((source, i) => ({ filename: source.filename, ev: frame.hdrMerge!.exposureEv[i] })) } } : {}),
    ...(urls?.unsupported ? {} : extras.fullDevelop === 'running' ? { fullDevelop: 'running' as const }
      : extras.fullDevelop === 'possible' && sources?.preview !== 'raw-full' ? { fullDevelop: 'offered' as const } : {}),
    ...(shownPreview || shownThumb ? { picture: { ...(shownPreview ? { preview: shownPreview } : {}), ...(shownThumb ? { thumb: shownThumb } : {}) } } : {}),
    assistCritique: {
      ...(assist && matchesAutoSource(assist.run, frame)
        ? assistCritiqueFor(assist, frame.edit)
        : extras.autoUnavailable && autoUnavailableMatches(extras.autoUnavailable, frame)
          ? { ...assistCritiqueFor(undefined), subjectNote: autoUnavailableSentence(extras.autoUnavailable.unavailable, frame.filename) }
          : assistCritiqueFor(undefined, frame.edit)),
      kelvinEstimate: asShotWords(frame),
    },
  };
}

export function shootToProject(shoot: ShootDescriptor, frames: readonly PhotoFrame[], coverUrl = '', sampleUrls: readonly string[] = []): Project {
  const live = frames.filter((frame) => !frame.removedAt);
  return {
    id: shoot.id,
    kind: shoot.collage ? 'collage' : shoot.projectType === 'tethered' ? 'tethered' : 'photography',
    name: shoot.title,
    updatedAt: new Date(shoot.lastUpdatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    coverUrl,
    sampleUrls: [...sampleUrls],
    photoCount: computeCullCounts(live as PhotoFrame[]).all,
    flaggedCount: live.filter((frame) => frame.decision === 'keep').length,
    localCopyStatus: 'offline-ready',
    folderPath: shoot.folderName ?? '',
    archived: Boolean(shoot.archivedAt),
    trashed: Boolean(shoot.trashedAt),
  };
}

export function taskToInfo(task: Task): TaskInfo {
  const progress = task.state === 'done' ? 100 : task.total ? Math.min(100, Math.round((task.done / task.total) * 100)) : 0;
  return {
    id: String(task.id),
    label: task.title,
    ...(task.kind ? { kind: task.kind } : {}),
    detail: task.detail ?? (task.total ? `${task.done} of ${task.total}` : ''),
    progress,
    status: task.state,
    done: task.done,
    total: task.total,
    stage: task.stage,
    location: task.location,
    pauseable: task.pauseable,
    cancellable: task.cancellable,
    priority: task.priority,
    startedAt: task.startedAt,
    items: task.items,
    ...(task.endedAt !== undefined ? { endedAt: task.endedAt } : {}),
  };
}

/** Finished tasks stay in the Completed tab for this long, or until the person deletes them. */
export const COMPLETED_KEEP_MS = 4 * 60 * 60 * 1000;

/** Running tasks first, then finished ones still inside the keep window, newest first. */
export function visibleTasks(running: readonly TaskInfo[], history: readonly TaskInfo[], now: number): TaskInfo[] {
  const keep = history.filter((task) => now - (task.endedAt ?? now) < COMPLETED_KEEP_MS && !running.some((live) => live.id === task.id));
  return [...running, ...keep.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))];
}
