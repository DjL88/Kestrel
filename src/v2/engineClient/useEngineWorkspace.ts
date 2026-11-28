import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { applyImportBatch, createImportHandoff, readPendingImport, writePendingImport, type ImportBatch, type ImportHandoff } from './importHandoff';
import { marksOf } from '../../core/sharedMarks';
import { computeCullCounts, applyDecisionWithHistory, assignBurstGroups, redoDecision, regroupBurstsWithEmbeddings, removedFrames, removeFromLibrary, restoreRemoved, undoDecision } from '../../core/cullingEngine';
import { jumpToStep, recordEdit, stepEdit, type EditWhy } from '../../core/editHistory';
import { deleteCheckpoint, forkEditCheckpoint, renameEditVersion, restoreCheckpoint, saveCheckpoint, switchEditVersion as switchVersionInCatalogue } from '../../core/editBranches';
import { isEmptyEdit, DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { sameRecipe } from '../../core/naturalAuto';
import { newId } from '../../core/ids';
import { exportCollage } from './exportCollage';
import { createCollage, MAX_COLLAGE_SELECTION, readCollage } from '../../core/collage';
import { PHOTO_ACCEPT } from '../../core/rawFormats';
import { appendProjectPhotos, applyImportBursts, createEmptyProject, duplicateProject, moveFrames, setArchived, setTrashed, trashExpired } from '../../core/projects';
import { tasks } from '../../core/taskStore';
import { createSaveGuard, type SaveGuard } from '../../core/saveGuard';
import { engineScheduler, type ScheduledContext, type SchedulerTicket } from '../../core/engineScheduler';
import { measureStep, timedStep } from '../../providers/previewTiming';
import { useTaskList } from './taskListFeed';
import { histogramOffThread } from '../../providers/pixelAnalysis';
import { editGestureActive, onEditGestureEnd } from '../../providers/editGesture';
import { setAdvice } from './adviceStore';
import { measureAdviceFor } from './adviceMeasure';
import { startAdviceRun } from './adviceRun';
import { lookForZoomFocus } from './eyeZoom';
import { stackFocusOffThread } from '../../providers/focusStackOffThread';
import { stitchPanoramaOffThread } from '../../providers/panoramaOffThread';
import { panoramaRecipe, type PanoramaRecipe } from '../../core/panoramaRecipe';
import { focalPxFrom35mm } from '../../core/panorama';
import { panoText } from '../../i18n/areas/pano';
import { imagePanoSource, panoDoneNotice, panoFilename, panoRefusalText, panoramaPreviewOn, panoSelection } from './panoramaOps';
import { focusStackRecipe, type FocusStackRecipe } from '../../core/focusStackRecipe';
import { encodePng16, provePng } from '../../core/png16';
import { maxCanvasPixels } from '../../core/exportLimits';
import { stackText } from '../../i18n/areas/stack';
import { focusStackPreviewOn, imageStackSource, refusalText, rgbaToRgb16, stackDoneNotice, stackedFilename, stackSelection } from './focusStackOps';
import { mergeHdrOffThread, rgb16Source, canvasSource, type HdrFrameInput } from '../../providers/hdrMergeOffThread';
import { hdrMergeRecipe, type HdrMergeRecipe } from '../../core/hdrMergeRecipe';
import { bracketsByFrame, type ExposureBracket } from '../../core/hdrBracket';
import { hdrText } from '../../i18n/areas/hdr';
import { cullWarmupPreviewOn, warmupNeighbours } from './previewWarmup';
import { hdrDoneNotice, hdrFilename, hdrPreviewOn, hdrRefusalText, hdrSelection } from './hdrMergeOps';
import { renderRaw16 } from '../../providers/rawMaster16';
import type { CullDecision, CullingState, PhotoFrame, ShootDescriptor } from '../../core/types';
import { eraseDeviceData } from './eraseDeviceData';
import { BrowserCatalogueStore } from '../../providers/browserCatalogueStore';
import { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { hubPreviewKey, projectPreviewBlobs } from './projectCover';
import { DEVELOP_VERSION } from '../../core/backgroundDevelop';
import { pickResumePhotos, pickSlideshowPhotos } from '../../core/welcomeSlideshow';
import { deviceMemoryBudget } from '../../providers/deviceBudget';
import { scanForCulling } from '../../providers/browserAutoCull';
import { useAccess } from '../../providers/useAccess';
import { useBackgroundDevelop } from '../../useBackgroundDevelop';
import { useSpeciesScan } from '../../useSpeciesScan';
import { shareNearbySpecies } from '../../core/speciesNearby';
import { SPECIES_REGIONS_EVENT, readSpeciesRegions } from '../../core/speciesRegions';
import { regionIdsForArea, reopenForNewArea, sameArea, suggestAreaFromPositions, type SpeciesArea } from '../../core/speciesArea';
import { SPECIES_SCAN_VERSION, kindWords, speciesScanDue, lookAgain } from '../../core/autoTags';
import { LEGACY_SETTINGS } from '../../core/projectSettings';
import { areaWords, speciesAreaText } from '../../i18n/areas/speciesArea';
import { displaySpeciesName } from '../../core/speciesNames';
import { speciesNameIndex } from '../../providers/speciesNames';
import { carryVehicleReadings, correctVehicle } from '../../core/vehicleBursts';
import { syncAllVehicleTags } from '../../core/vehicleTags';
import { VEHICLE_LABELS } from '../../core/vehicleLabels';
import { vehicleText } from '../../i18n/areas/vehicles';
import { useVisualGrouping } from './useVisualGrouping';
import { isDesktopApp, isMobileShell } from '../../providers/desktopShell';
import { canWatchFolder, chooseHotFolder, desktopHotFolder, watchHotFolder, type HotFolderSource } from '../../providers/hotFolderWatch';
import { canReceiveFromCamera, startFtpInbox, stopFtpInbox, type FtpInbox } from '../../providers/ftpInbox';
import { canOpenShootRoom } from '../../providers/shootRoom';
import { useShootRoom } from './useShootRoom';
import { canTetherUsb, startUsbTether, type UsbTether } from '../../providers/usbTether';
import { photoParallelism } from '../../core/photoParallelism';
import { canDevelopRaw, canExportRawMaster } from '../../providers/rawDevelop';
import { developFullSizeOf, fullDevelopPossible } from './fullDevelop';
import { buildDngCopyFile, dngCopyOffered } from './rawDngCopy';
import { useSceneTags } from './useSceneTags';
import { usePictureSearch } from './usePictureSearch';
import { declinePhotoTag } from '../../core/photoTags';
import { inGroups, ratedFirstOrder } from '../../core/importOrder';
import { readSidecarRatings } from '../../providers/importRatings';
import { folderNameOf, linkedRangeOpener, linkedReader, pickedFromFile, pickedKey, pickFolderNatively, pickPhotosNatively, type PickedPhoto } from '../../providers/linkedOriginals';
import { applyDesktopRelink, framesNeedingRelink, pickRelinkFolder, planDesktopRelink, tauriRelinkFs } from './desktopRelink';
import { getLocalFileKey, loadLocalFileListShoot, rehydrateLocalFramesFromStore } from '../../providers/localShootLoader';
import { hashOriginalBytes, isSameOriginalBytes } from '../../core/originalFileIdentity';
import type { EditRecipe, LookPreset, HubViewState, OverlaySettings, PhotoHistogram, WatermarkPreset, Project, TaskInfo, WorkspaceActions, WorkspaceStore } from '../ui/contract';
import { useWorkspace } from '../ui/stub';
import { EngineSurface } from './EngineSurface';
import { featureAccess, featurePlan } from './featureMap';
import { workflowPreviewOn } from './workflowPreview';
import { recordCullObservations, rescoreFromObservations, type ScanEvidence } from '../../core/cullObservationStore';
import { applyCullRules, proposedKeepers, rankWithRules, type CullRules } from '../../core/cullRules';
import { isCullOriginal, type CullSuggestion } from '../../core/autoCull';
import { DETECTOR_MODEL } from '../../core/objectDetection';
import { bundledModelUrl } from '../../providers/bundledModelAssets';
import { hasDeviceFont, listDeviceFonts, loadSavedDeviceFonts, mergeFonts, saveDeviceFonts } from './fonts';
import { addVersion, assetUrl, cutOut, importWatermark, loadStored, makeVariant, moveToSlot, saveStored, textWatermark, toPresets, type StoredWatermark } from './watermarkLibrary';
import { replaceWatermarkIfUnchanged } from './watermarkMutation';
import { watermarkToneForPixels } from '../../core/watermark';
import { createDefaultSizes } from '../ui/stub';
import { toPhotoHistogram } from './histogram';
import { histogramFromWorking } from './histogram16';
import { measuringCopy, raw16Possible, raw16WorkingFor } from '../../providers/raw16Working';
import { renderRaw16Working } from '../../providers/rawMaster16';
import { fullResolutionRasterFormat, isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import { rawSensorSize } from '../../core/rawSensorSize';
import { parseImageExif } from '../../core/exifParser';
import { editStatusWithSidecar } from '../../providers/editStatusSidecar';
import { loadUi, mergeSettings, saveUi, type SavedUi } from './uiSettings';
import { dropSourcePreview, dropSourceUrls } from './previewInvalidation';
import { applyCanvasExportEdit, applyCanvasPhotoEdit } from '../../core/canvasEdit';
import { applyFrameLayers, LAYER_COPY_EDGE, saveLayerAsset } from '../../core/layerAssetVault';
import { MAX_LAYERS } from '../../core/layers';
import { DEFAULT_EDIT as EMPTY_EDIT } from '../../core/photoEdits';
import { DEFAULT_CROP, flipCrop, patchCrop, rotateCrop } from './cropOps';
import { readCrops } from './cropOps';
import { readFormatHistory, recordFormatCrop, recordFormatSetChange, recordFormatLink } from './formatHistory';
import { addLayer, addRow, alignOverlays, moveLayer, moveRow, newLayer, patchOverlay, readOverlay, removeLayer, removeRow, updateLayer, updateRow } from './overlayOps';
import { frameToPhoto, matchesAutoSource, originalFormatSize, shootToProject, taskToInfo, visibleTasks, type AssistState, type FrameUrls } from './frameToPhoto';
import { runAuto, type AutoRun } from './runAuto';
import { learnedLeanings, recordOutcome, type StyleKey } from '../../core/editStyle';
import { loadEditStyle, resetEditStyle, saveEditStyle } from './editStyleStore';
import { autoUnavailableSentence, isAutoUnavailable, type AutoUnavailable } from './autoUnavailable';
import { autopilotHeldForReview, autopilotSkippedEdited, autopilotSkipsEditedElsewhere, commitAutoEdit } from './commitAutoEdit';
import { guardResult } from '../../core/visionGuardian';
import { guardianHolds, guardianOrder, guardianSettled, startGuardian, withOpinion } from './assistGuardian';
import { askOnDeviceGuardian, askOnDeviceGuardianAbout, onDeviceGuardianReady } from '../../providers/visionGuardian';
import { holdDoubtedKeeps, keepsToGuard } from '../../core/cullGuardian';
import type { GuardianOpinion } from '../../core/visionGuardian';
import { hasLocalVision } from '../../providers/localVision';
import type { PictureSource } from '../../core/pictureSource';
import { autoCullSummary, commitAutoCull, cullAfterImport, rawsJudgedFromCameraPreview } from './commitAutoCull';
import { runV2Denoise } from './runDenoise';
import { cloudRecipeEdit, cloudRecipeWhy, prepareCloudRecipe, sendCloudRecipe, type CloudRecipeOffer } from './runCloudRecipe';
import { cloudRecipePreviewOn, httpCloudRecipeService, readFullFileConsent, saveFullFileConsent } from '../../providers/cloudRecipeService';
import { readCloudConsent as readStoredConsent, saveCloudConsent } from '../../providers/cloudConsent';
import { hasPaidPlan } from '../../providers/licenceStore';
import type { CloudUsage } from '../../core/cloudPlan';

// A paying plan is pre-opted-in to the cloud; an explicit No always wins (src/providers/cloudConsent.ts).
const readCloudConsent = () => readStoredConsent(undefined, { paying: hasPaidPlan() });
import { previewBlobFromUrl, previewCopyForCloud } from '../../providers/recipePreviewCopy';
import { MAIN_THREAD_DENOISE_NOTE } from '../../providers/denoiseOffThread';
import { composeDenoiseRecipe } from './denoiseRecipe';
import { preloadTrueDetailAi } from '../../core/trueDetailAiCanvas';
import { moveArtboard } from './boardOps';
import { accountConnection } from '../../providers/licenceStore';
import { runDeepVisionReview } from './deepVisionReview';
import { deepReviewFailure } from '../ui/utils/deepReview';
import { agreeManagedAi, aiOpinionView, applyTargets, askAiSecondOpinion, errorWords, type AiOpinionRecord } from './aiSecondOpinion';
import { saveAiSettings } from '../../providers/aiSettings';
import { useUsableAiSettings } from '../../providers/onlineHelperState';
import { consentFor } from '../../providers/aiProviders';
import { AI_REVIEW_CONSENT_VERSION } from '../../core/aiReview';
import { languageOption } from '../../core/locale';
import { matchProposal, withProposalMarks } from '../../core/assistantProposals';
import { findProposals, forgetProposal, type FoundProposal } from '../../providers/assistantProposals';
import { aiReviewText } from '../../i18n/areas/aiReview';
import { planExport } from './exportOps';
import { useExternalEdits } from './useExternalEdits';
import { placeBeside, readExternalEdit, returnedExif, type ExternalEditRecord } from '../../core/externalEdit';
import { verifyExactOriginalCopy } from './verifiedOriginalCopy';
import { buildRawMasterFile } from './rawMasterExport';
import { TEMPLATES_KEY, addTemplate, deleteTemplate, readTemplates, renameTemplate, type OverlayTemplate } from './overlayTemplates';
import { applyOverlayTemplateToProject, changePhotoOverlay } from './overlayHistory';
import { BRAND_KITS_KEY, addBrandKit, applyBrandKitToProject, deleteBrandKit, editBrandKit, overlayForKit, readBrandKits, shownLogoId, type BrandKit, type KitProblem } from './brandKits';
import { type FormatSet, addFormat, applyFormats, ORIGINAL_FORMAT_ID, removeFormat, toggleFormat, toggleSizeLinked as toggleSizeLinkedRaw, validCustomSize, setOriginalOutputSize, resetOriginalOutputSize } from './formatOps';
import { patchVideoZoom } from './videoZoomOps';
import { isSplitFrameCount, setFormatSplitOffset, setSplitFrameCount as writeSplitFrameCount, toggleFormatSplit, type SplitFrameCount } from './formatSplitOps';
import { readSplitPanOffset } from './splitFrameOps';
import { useTapSelect } from './useTapSelect';
import { addHealSpot as addSpot, canAddHealSpot, nextHealSource, removeHealSpot as removeSpot, sizeToRadius, updateHealSpot as changeSpot } from './healOps';
import { applyHeal, findHealSources } from '../../core/heal';
import { canAddMask, removeMask, setMaskEdit, setMaskFeather, setMaskGeometry, setMaskParts, toggleMask } from './maskOps';
import { guardianDoubtsSubjectMask, subjectMaskShapeKey, verifyFrameMasks } from './maskVerify';
import { maskAdvice, maskVerificationKey } from './maskVerificationCommit';
import { commitSubjectMask, subjectMaskTarget } from './subjectMaskCommit';
import { createMask, createSubjectMask, framingKey, hasActiveMasks, type Mask } from '../../core/maskTypes';
import { v2Text } from '../../i18n/areas/v2';
import { lastProjectFrom, onLaunchIntent, openableProjectIds, resolveLaunchIntent, takeLaunchIntent } from '../launchIntent';
import { forgetLaunchProject, forgetLaunchProjectsExcept, writeLastProject, writeSlideshow } from '../../providers/launchMemory';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize, lensCentre } from '../../core/photoFraming';
import { estimateIlluminant, neutralBalance, samplePatch } from '../../core/neutralWhite';
import { GUIDED_RENDER_EDGE } from '../../core/subjectGuide';
import { detectSubjectGuided } from '../../providers/subjectDetector';
import { judgeSubject } from '../../core/autoCull';
import { archiveExports, saveExportFile, loadExportSource, loadVerifiedRasterOriginalForExport } from '../../providers/browserExport';
import { loadAnalysisPicture } from '../../providers/analysisPicture';
import { toProfile } from '../../core/exportFormats';
import { renderV2Export, type OverlayDraw } from './renderV2Export';
import { renderGalleryPreview } from './galleryPreview';
import { readSharedEdit } from '../../core/sharedSync';
import { createVirtualCopy } from '../../core/virtualCopies';
import { buildPreviewFilterCss, formatOverlayRowText } from '../ui/utils/studioMath';
import { loadImage } from '../../providers/loadImage';
import { deliverExport, describeExport } from './exportDelivery';
import { rawJpegPairs, withPartners } from '../../core/rawJpegPairs';
import { recountBursts, withPairedJpeg } from './pairedPhotos';
import { backUpProjectNow, useAutoBackup, useBackupStatus } from '../../providers/autoBackup';
import { saveProjectBackupFile } from '../../providers/projectBackupFile';
import { restoreProjectBackup } from '../../core/projectBackup';
import { backupStatusText } from './backupWords';
import { applySidecarImports, planXmpImports, saveSidecars, sidecarEdits, sidecarFailureText, xmpScope } from './xmpOps';
import { applyLightroomImport, lightroomNotice } from './lightroomOps';
import { saveCatalogueExport } from './catalogueExport';
import { CatalogueReadError, readLightroomCatalogue } from '../../core/lightroomCatalogue';
import { catalogueFilesInFolder, catalogueOnlyPhotos, commonFolder, planLightroomImport } from '../../core/lightroomImport';
import type { LightroomPhoto } from '../../core/lightroomCatalogue';
import { STRINGS as V2_STRINGS } from '../ui/strings';
import { renderExportJob, scheduleV2PhotoExports, photoExportUnits } from './scheduledPhotoExport';
import { enlargementPreviewRequest, type EnlargementPreviewResult } from './enlargementPreview';
import { uniqueExportFilename } from '../../core/exportNaming';
import { exportMayContinue } from '../../core/exportCancellation';
import type { ExportRequest, Photo } from '../ui/contract';
import { applyRecipePatch, editToRecipe, NEUTRAL_RECIPE, removeLookPatch } from './recipeMap';
import { cloudRecipeChanges } from './cloudRecipeChanges';
import { cloudEditsPhotos, parseCloudEditsChoice, type CloudEditsChoice } from '../../core/cloudEditsChoice';
import { CloudJobError } from '../../core/cloudJobProblem';
import { MAX_USER_LOOKS, exportUserLooks, importUserLooks, parseUserLooks, removeUserLook, renameUserLook, saveUserLook, type UserLook } from '../../core/presets';
import { looksText } from '../../i18n/areas/looks';
import { canvasLensCentre, detectLateralCa } from '../../core/fringe';
import { resolveLensProfile } from '../../core/lensProfiles';
import { lensDatabase } from '../../providers/lensProfileStore';
import { surfaceBridge } from './surfaceBridge';
import { addSavedEditGroup, renameSavedEditGroup, selectSavedEditGroup, syncEditGroup } from './editGroupState';
import { engineText } from '../../i18n/areas/engine';
import { loadSpeciesNames, onSpeciesNamesLoaded } from '../../providers/speciesNames';
import { language } from '../../i18n/messages';
import { reasonOf } from '../../core/exportFolderChoice';
import { pickFiles, pickFolderFiles, pickFolderPhotos, pickImageFile, pickReselectFiles } from './workspacePickers';
import { shootTiers } from '../../core/shootTiers';
import { createReadAhead, importLanes } from '../../core/importReadAhead';
import { startNativeResourceSampling } from '../../providers/nativeResourceSample';

// A task held back by the computer's capacity says why in Tasks, in the person's language.
engineScheduler.setWaitWords((reason) => (reason === 'memory' ? engineText.workspace.waitMemory : engineText.workspace.waitBusy));

/** At most this many confident keepers get the vision guardian's second opinion per Auto-cull pass (seconds each). */
const GUARDED_KEEPS_LIMIT = 60;

/** A picture for a measurement that needs at most a screen's worth of pixels: a RAW's screen-size sensor develop when one can be
 * had (analysisPicture.ts), otherwise the full source as before. Never for anything that writes pixels at full size. */
/**
 * Nearby places to copy a spot from, best first, measured on the framed picture at a bounded size with the photo's other
 * spots already applied (so a source is never another piece of dust that has been covered since). `skip` leaves one spot out.
 */
async function healSourcesFor(frame: PhotoFrame, source: BrowserPreviewProvider, at: { x: number; y: number }, r: number, skip?: string) {
  const image = await boundedSource(frame, source);
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
  const canvas = document.createElement('canvas');
  drawFramedPhoto(image, canvas, framing, { scale: Math.min(1, 1600 / Math.max(width, height)) });
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const others = (frame.edit?.heal ?? []).filter((spot) => spot.id !== skip);
  applyHeal(pixels, canvas.width, canvas.height, 4, 255, others, { aspect: canvas.height / canvas.width, view: { x: 0, y: 0, w: 1, h: 1 } });
  const found = findHealSources(pixels, canvas.width, canvas.height, 4, at.x, at.y, r);
  canvas.width = 0; canvas.height = 0;
  return found;
}

async function boundedSource(frame: PhotoFrame, source: BrowserPreviewProvider): Promise<HTMLImageElement> {
  return (await loadAnalysisPicture(frame, source).catch(() => null)) ?? loadExportSource(frame, source);
}

/** Actions that change a photo's edit, sizes, overlay, masks or assist state. They are not connected to the real
 * recipe yet, so they say so instead of silently changing sample data. */
const NOT_CONNECTED = [] as const satisfies readonly (keyof WorkspaceActions)[];

/** What the export needs to draw the overlay exactly as the canvas does, read from the latest render. */
interface ExportEnv { fonts: ReturnType<typeof mergeFonts>; presets: WatermarkPreset[]; auto: Record<string, 'light-on-dark' | 'dark-on-light'>; textAllowed: boolean; markAllowed: boolean }

async function buildOverlayDraw(frame: PhotoFrame, request: ExportRequest, env: ExportEnv): Promise<OverlayDraw | null> {
  const overlay = readOverlay(frame.overlay);
  const text = request.includeOverlay && overlay.textEnabled && env.textAllowed && overlay.rows.length > 0;
  const preset = env.presets.find((candidate) => candidate.id === overlay.watermarkPresetId) ?? env.presets[0];
  const mark = request.includeWatermark && overlay.watermarkEnabled && env.markAllowed && !!preset;
  if (!text && !mark) return null;
  const photo = frameToPhoto(frame, undefined, {});
  const contrast = overlay.watermarkContrast === 'auto' ? env.auto[frame.id] ?? 'light-on-dark' : overlay.watermarkContrast;
  const fallbackFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
  const imageUrl = preset?.kind === 'image'
    ? (contrast === 'light-on-dark' ? preset.forDarkUrl ?? preset.forLightUrl : preset.forLightUrl ?? preset.forDarkUrl)
    : undefined;
  return {
    overlay, text, watermark: mark, contrast,
    rows: overlay.rows.map((row) => ({ text: formatOverlayRowText(row, photo, overlay), family: env.fonts.find((font) => font.id === row.fontId)?.family ?? fallbackFamily, weight: row.weight, sizePx: row.sizePx, letterSpacing: row.letterSpacing })),
    mark: !mark || !preset ? null : imageUrl ? { kind: 'image', image: await loadImage(imageUrl) } : { kind: 'text', text: preset.text, ...(preset.subtext ? { subtext: preset.subtext } : {}) },
  };
}

const THUMBNAIL_WORKERS = 4;

/** A phone, or a device that says it has little memory: the world comparison is skipped there. */
function lowMemoryDevice(): boolean {
  if (typeof navigator === 'undefined') return true;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return isMobileShell() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (typeof memory === 'number' && memory < 4);
}

/** The GPS positions the project's photos carry, read on this device only (never sent, never in a backup). */
function positionsOf(frames: readonly PhotoFrame[]): { latitude: number; longitude: number }[] {
  return frames.flatMap((frame) => (frame.removedAt == null && frame.exif.gps ? [frame.exif.gps] : []));
}

/**
 * The V2 store backed by the real catalogue. Connected now: projects (create, open, back), importing photos with the
 * real loader and Task Manager, thumbnails and previews from the preview provider, flag (= keep), reject, rating,
 * selection, the Adjust recipe (sliders, Looks, reset, copy and paste, with edit undo and redo) and the canvas renderer,
 * and the deep vision review (real subject detection + trust gate + Look suggestion from src/engine/*, reported as a
 * plain-text notice; see deepVisionReview.ts). Everything else keeps the UI's own layout state; edit-type actions say
 * they are not connected yet (NOT_CONNECTED). Originals are never written.
 */
const NO_FRAMES: PhotoFrame[] = [];

const USER_LOOKS_KEY = 'kestrel.v2.userLooks';

/** The launch welcome's "pick up where you left off" snapshot for a project, built with lastProjectFrom. */
function rememberLastProject(project: Pick<CullingState, 'shoot' | 'frames'>): void {
  const last = lastProjectFrom({
    id: project.shoot.id,
    name: project.shoot.title,
    photoCount: computeCullCounts(project.frames.filter((frame) => !frame.removedAt)).all,
    lastUpdatedAt: project.shoot.lastUpdatedAt,
  });
  if (!last) return;
  // The card shows a few of the project's own photos (owner, 26 Nov: it showed a folder icon), as references only.
  const keys = pickResumePhotos(project.frames).map(hubPreviewKey);
  writeLastProject(keys.length ? { ...last, thumbs: { keys, developVersion: DEVELOP_VERSION } } : last);
}

/** Your looks share the Looks list with the built-in ones, so their ids carry a prefix no built-in uses. */
const USER_LOOK_PREFIX = 'mine-';
const userLookId = () => newId().replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || String(Date.now());
function userLookPreset(look: UserLook): LookPreset {
  const recipeDelta = look.recipe as Partial<EditRecipe>;
  return {
    id: USER_LOOK_PREFIX + look.id, name: look.name, category: looksText.mine, description: looksText.description,
    previewFilter: buildPreviewFilterCss({ ...NEUTRAL_RECIPE, ...recipeDelta }), recipeDelta, mine: true,
  };
}

/** The photo, with the exposure bracket it belongs to (from the camera's settings) when there is one. */
function withBracket(photo: import('../ui/contract').Photo, bracket: ExposureBracket | undefined): import('../ui/contract').Photo {
  return bracket ? { ...photo, bracket: { photoIds: bracket.frameIds, ev: bracket.ev, fromCamera: bracket.fromCamera } } : photo;
}

/** The photo with its rank within the shoot, when Auto pick ranked it. */
const withTier = (tier: Photo['tier'] | undefined, photo: Photo): Photo => (tier ? { ...photo, tier } : photo);

/** Photos read and added to the project together in one scheduler item (one project update per group). */
const IMPORT_GROUP_SIZE = 6;

export function useEngineWorkspace(): { store: WorkspaceStore; actions: WorkspaceActions } {
  // A real measurement of the machine for the task scheduler (desktop app), so heavy jobs can run side by side when there
  // is room, instead of one at a time behind whichever is slowest.
  useEffect(() => startNativeResourceSampling(), []);
  const stub = useWorkspace();
  const { can: canByPlan, capabilities } = useAccess();
  // Photos at once (owner decision 25 Nov): the plan's ceiling, held to this device's memory and cores. The
  // scheduler still runs one heavy job at a time where free memory cannot be measured.
  useEffect(() => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number };
    engineScheduler.setCpuLimit(photoParallelism({
      desktop: isDesktopApp() && !isMobileShell(), paid: capabilities.fullEditor, cloud: canByPlan('cloudAssist'),
      cores: nav?.hardwareConcurrency, memoryGB: nav?.deviceMemory,
    }).local);
  }, [capabilities.fullEditor, canByPlan]);
  // One gate for the whole adapter: the plan's answer, or the developer-only Pro preview (see featureMap.ts).
  // The map is worked out once per plan, not again on every question (it was asked many times on every redraw).
  const access = useMemo(() => featureAccess(canByPlan), [canByPlan]);
  const can = useCallback((feature: Parameters<typeof canByPlan>[0]) => access[feature as keyof typeof access] ?? canByPlan(feature), [access, canByPlan]);
  const catalogue = useRef<BrowserCatalogueStore | null>(null);
  if (!catalogue.current) catalogue.current = new BrowserCatalogueStore();
  const provider = useRef<BrowserPreviewProvider | null>(null);
  if (!provider.current) provider.current = new BrowserPreviewProvider();

  const [screen, setScreen] = useState<'hub' | 'editor'>('hub');
  const [hubState, setHubState] = useState<HubViewState>('loading');
  const [projects, setProjects] = useState<Project[]>([]);
  const [state, setState] = useState<CullingState | null>(null);
  const [urls, setUrls] = useState<Record<string, FrameUrls>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // The person's home regions for species names (Settings → Assistance), kept current when they change there.
  const [homeRegions, setHomeRegions] = useState<string[]>(() => readSpeciesRegions());
  const homeRef = useRef(homeRegions);
  homeRef.current = homeRegions;
  useEffect(() => {
    const update = () => setHomeRegions(readSpeciesRegions());
    window.addEventListener(SPECIES_REGIONS_EVENT, update);
    return () => window.removeEventListener(SPECIES_REGIONS_EVENT, update);
  }, []);
  const [clipboard, setClipboard] = useState<EditRecipe | null>(null);
  const [deviceFonts, setDeviceFonts] = useState<string[]>(loadSavedDeviceFonts);
  const [watermarkStore, setWatermarkStore] = useState<StoredWatermark[]>(loadStored);
  const watermarkStoreRef = useRef(watermarkStore);
  const [watermarkLibrary, setWatermarkLibrary] = useState<WatermarkPreset[]>([]);
  const [templates, setTemplates] = useState<OverlayTemplate[]>(() => { try { return readTemplates(localStorage.getItem(TEMPLATES_KEY)); } catch { return []; } });
  const [userLooks, setUserLooks] = useState<UserLook[]>(() => { try { return parseUserLooks(localStorage.getItem(USER_LOOKS_KEY)); } catch { return []; } });
  const updateUserLooks = useCallback((next: UserLook[]) => { setUserLooks(next); try { localStorage.setItem(USER_LOOKS_KEY, JSON.stringify(next)); } catch { setNotice(looksText.notSaved); } }, []);
  const looks = useMemo<LookPreset[]>(() => [...stub.store.looks, ...userLooks.map(userLookPreset)], [stub.store.looks, userLooks]);
  // Brand kits (K080): kept on this device only, beside the overlay templates.
  const [brandKits, setBrandKits] = useState<BrandKit[]>(() => { try { return readBrandKits(localStorage.getItem(BRAND_KITS_KEY)); } catch { return []; } });
  const updateBrandKits = useCallback((next: BrandKit[] | KitProblem, saved: string): boolean => {
    if (typeof next === 'string') {
      setNotice(next === 'empty' ? 'Give the brand kit a name first.' : next === 'full' ? 'You have saved the most brand kits you can. Delete one first.' : 'That brand kit could not be found.');
      return false;
    }
    try { localStorage.setItem(BRAND_KITS_KEY, JSON.stringify(next)); } catch { setNotice('The brand kit could not be saved on this device. Your photos are unchanged.'); return false; }
    setBrandKits(next);
    setNotice(saved);
    return true;
  }, []);
  const updateTemplates = useCallback((next: OverlayTemplate[]) => { setTemplates(next); try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(next)); } catch { setNotice(engineText.workspace.templateNotSaved); } }, []);
  const [savedUi, setSavedUi] = useState<SavedUi>(loadUi);
  /** Originals (stable keys) whose full-size develop is being made, so the canvas can say so. */
  const [fullDeveloping, setFullDeveloping] = useState<Record<string, true>>({});
  const fullDevelopRunning = useRef(new Set<string>());
  const [pixelSizes, setPixelSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [verifiedRasterSizes, setVerifiedRasterSizes] = useState<Record<string, { width: number; height: number }>>({});
  const verifiedRasterRef = useRef(verifiedRasterSizes);
  verifiedRasterRef.current = verifiedRasterSizes;
  const pixelSizesRef = useRef(pixelSizes);
  pixelSizesRef.current = pixelSizes;
  /** The formats this photo has, worked out exactly as the canvas shows them (decoded size first, then EXIF). */
  const liveFormatsOf = (frame: PhotoFrame | undefined) => applyFormats(createDefaultSizes(), frame?.formats,
    frame ? originalFormatSize(frame, verifiedRasterRef.current[`${frame.stableKey}|${frame.originalSha256 ?? ''}`], pixelSizesRef.current[frame.id]) : null);
  const [histograms, setHistograms] = useState<Record<string, PhotoHistogram>>({});
  const [watermarkAuto, setWatermarkAuto] = useState<Record<string, 'light-on-dark' | 'dark-on-light'>>({});
  useEffect(() => { let live = true; void toPresets(watermarkStore).then((presets) => { if (live) setWatermarkLibrary(presets); }); return () => { live = false; }; }, [watermarkStore]);
  const updateWatermarks = useCallback((change: (current: StoredWatermark[]) => StoredWatermark[]) => {
    const current = watermarkStoreRef.current;
    const next = change(current);
    if (next === current) return;
    watermarkStoreRef.current = next;
    setWatermarkStore(next);
    saveStored(next);
  }, []);
  const [assists, setAssists] = useState<Record<string, AssistState>>({});
  const [autoUnavailable, setAutoUnavailable] = useState<Record<string, AutoUnavailable>>({});
  const [autoRequest, setAutoRequest] = useState<{ photoId: string; sequence: number } | null>(null);
  // What Auto last did, per photo, so the Auto button and Auto-pilot never end in silence (Dave, 27 Nov: on his own
  // RAW, Auto-pilot applied nothing and said nothing). The last dozen photos are kept.
  const [autoStatus, setAutoStatus] = useState<Record<string, { state: 'working' | 'applied' | 'unchanged' | 'unavailable'; text: string }>>({});
  // Why the last Denoise changed nothing, per photo: the panel offers "Denoise anyway" or says to wait for the develop.
  const [denoiseStatus, setDenoiseStatus] = useState<Record<string, { state: 'no-visible-noise' | 'waiting-develop'; text: string }>>({});
  const sayDenoise = useCallback((photoId: string, status: { state: 'no-visible-noise' | 'waiting-develop'; text: string } | null) => {
    setDenoiseStatus((current) => {
      const { [photoId]: _gone, ...rest } = current;
      return status ? { ...rest, [photoId]: status } : rest;
    });
  }, []);
  const sayAuto = useCallback((photoId: string, state: 'working' | 'applied' | 'unchanged' | 'unavailable', text: string) => {
    setAutoStatus((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([id]) => id !== photoId).slice(-11)), [photoId]: { state, text } }));
  }, []);
  /** Photos whose Auto button was pressed: the checked edit is applied when the check finishes. */
  const autoApplyWanted = useRef(new Set<string>());
  const lastAutoRequest = useRef(0);
  const cullController = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  // The photos the import now running has added: only these say Importing while they have no thumbnail yet. A reopened
  // project's photos whose thumbnail is still on its way say nothing (owner, 27 Nov).
  const importingIds = useRef(new Set<string>());
  const [removedOpen, setRemovedOpen] = useState(false);
  const stateRef = useRef<CullingState | null>(null);
  stateRef.current = state;
  const maskInFlight = useRef(new Set<string>());
  const exportEnv = useRef<ExportEnv>({ fonts: [], presets: [], auto: {}, textAllowed: false, markAllowed: false });
  useEffect(() => { surfaceBridge.set(state?.frames ?? [], provider.current); }, [state?.frames]);
  const importController = useRef<AbortController | null>(null);
  // Live shoot (hot folder): the folder being watched, how it is going, and how to stop it.
  const [liveFolder, setLiveFolder] = useState<{ projectId: string; name: string; imported: number; arriving: number; problem: boolean; ftp?: FtpInbox; tether?: { camera: string; fetching: string | null } } | null>(null);
  // The USB tether feeding the watched folder, while one is running (desktop app, preview).
  const usbTether = useRef<UsbTether | null>(null);
  const liveWatch = useRef<AbortController | null>(null);
  const followLiveFrame = useRef<((photoId: string) => void) | null>(null);
  const lastFollowed = useRef<string | null>(null);
  const relinking = useRef(false);
  // At most four times a second, drawn as a transition: a busy job's progress never holds the page (taskListFeed.ts).
  const taskList = useTaskList();
  // The core task store keeps only the last few finished tasks. V2 keeps them in a Completed tab for 4 hours.
  const [taskHistory, setTaskHistory] = useState<Record<string, TaskInfo>>({});
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const finished = taskList.filter((task) => task.state === 'done' || task.state === 'failed' || task.state === 'cancelled');
    if (!finished.length) return;
    setTaskHistory((current) => {
      let changed = false;
      const next = { ...current };
      for (const task of finished) {
        const info = taskToInfo({ ...task, endedAt: task.endedAt ?? Date.now() });
        if (JSON.stringify(next[info.id]) !== JSON.stringify(info)) { next[info.id] = info; changed = true; }
      }
      return changed ? next : current;
    });
  }, [taskList]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  const hubCoverUrls = useRef<string[]>([]);
  useEffect(() => () => { hubCoverUrls.current.forEach((url) => URL.revokeObjectURL(url)); hubCoverUrls.current = []; }, []);
  const loadHub = useCallback(async () => {
    setHubState('loading');
    const nextUrls: string[] = [];
    try {
      const store = catalogue.current!;
      const listed = (await store.listProjects()).filter((shoot: ShootDescriptor) => !shoot.inbox);
      // A project kept in Recently deleted for the full 30 days is removed for good now. One that cannot be
      // removed stays listed there, so nothing disappears without being gone.
      const now = Date.now();
      const removed = new Set<string>();
      for (const shoot of listed.filter((candidate) => trashExpired(candidate, now))) {
        try { await store.deleteProject(shoot.id); removed.add(shoot.id); } catch { /* kept; tried again next time */ }
      }
      const shoots = listed.filter((shoot) => !removed.has(shoot.id));
      const loaded = await Promise.all(shoots.map(async (shoot) => {
        const frames = (await store.loadProject(shoot.id))?.frames ?? [];
        // The best favourites at review size, developed from the RAW where that is cached. Never the original itself.
        const previews = await projectPreviewBlobs(frames);
        const url = previews.cover ? URL.createObjectURL(previews.cover) : '';
        const samples = previews.samples.map((blob) => URL.createObjectURL(blob));
        nextUrls.push(...(url ? [url] : []), ...samples);
        return shootToProject(shoot, frames, url, samples);
      }));
      hubCoverUrls.current.forEach((url) => URL.revokeObjectURL(url));
      hubCoverUrls.current = nextUrls;
      setProjects(loaded);
      setHubState(loaded.length ? 'ready' : 'empty');
      // The welcome never offers, or shows photos from, a project that is deleted (here, in another window, or expired).
      forgetLaunchProjectsExcept(openableProjectIds(loaded));
    } catch {
      nextUrls.forEach((url) => URL.revokeObjectURL(url));
      setHubState('error');
    }
  }, []);
  useEffect(() => { void loadHub(); }, [loadHub]);
  /** Puts a project in Recently deleted (a time) or takes it back out (undefined); everything else is unchanged. */
  const setProjectTrashed = useCallback((id: string, at: number | undefined) => {
    void (async () => {
      const store = catalogue.current!;
      const found = await store.loadProject(id);
      if (!found) { setNotice('That project could not be found.'); return; }
      await store.saveProject(setTrashed(found, at));
      if (at !== undefined) forgetLaunchProject(id);
      await loadHub();
    })().catch(() => setNotice('InFlight could not update the project.'));
  }, [loadHub]);

  // Save the open project whenever it changes. A failed save is never dropped (G07): the latest state of each project is
  // kept and retried until it is stored, and closing InFlight asks first while a failed change is still unsaved.
  const saveGuard = useRef<SaveGuard<CullingState> | null>(null);
  if (!saveGuard.current) {
    saveGuard.current = createSaveGuard<CullingState>({
      save: (next) => catalogue.current!.saveProject(next),
      onStatus: (status, { failures }) => {
        if (status === 'failed' && failures === 1) setNotice(engineText.workspace.projectSaveRetrying);
        else if (status === 'saved' && failures > 0) setNotice(engineText.workspace.projectSavedAfterRetry);
      },
    });
  }
  // While a slider is held, the newest state waits here and is saved once when the drag ends (or when the editor closes):
  // each save copies the whole project, which on a large project would hold the slider on every step.
  const heldSave = useRef<{ id: string; state: CullingState } | null>(null);
  useEffect(() => {
    const flush = () => {
      const held = heldSave.current;
      heldSave.current = null;
      if (held) saveGuard.current!.submit(held.id, held.state);
    };
    const stop = onEditGestureEnd(flush);
    return () => { stop(); flush(); };
  }, []);
  useEffect(() => {
    if (!state || screen !== 'editor') return;
    if (editGestureActive()) { heldSave.current = { id: state.shoot.id, state }; return; }
    heldSave.current = null;
    saveGuard.current!.submit(state.shoot.id, state);
  }, [state, screen]);
  useEffect(() => {
    const guard = saveGuard.current!;
    const retry = () => { if (document.visibilityState !== 'hidden') guard.retryNow(); };
    const warn = (event: BeforeUnloadEvent) => {
      if (!guard.hasFailedUnsaved()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);
  // Not disposed on unmount: a pending retry must still store the change (and React's development double-mount would
  // otherwise switch the guard off).

  // An import belongs to its project, not the screen (G07): photos that finish after the project is left are written
  // to its saved catalogue, and photos that finish while it is reopening are added once it is on screen.
  const leavingProject = useRef<string | null>(null);
  /** The project an import is adding to, while it runs. */
  const importingInto = useRef<string | null>(null);
  // Which photos an unfinished import has not added yet, kept on this device (throttled: a 2,000-photo import would
  // otherwise rewrite it 2,000 times). An empty list, the start and the end are written at once.
  const pendingImportWrites = useRef(new Map<string, { names: string[]; timer: number | null }>());
  const recordPendingImport = (projectKey: string, names: string[], now = false) => {
    const book = pendingImportWrites.current;
    const entry = book.get(projectKey) ?? { names, timer: null };
    entry.names = names;
    book.set(projectKey, entry);
    const write = () => {
      entry.timer = null;
      book.delete(projectKey);
      try { writePendingImport(window.localStorage, projectKey, entry.names); } catch { /* storage unavailable */ }
    };
    if (now || !names.length) { if (entry.timer !== null) window.clearTimeout(entry.timer); write(); }
    else if (entry.timer === null) entry.timer = window.setTimeout(write, 2000);
  };
  const importHandoff = useRef<ImportHandoff | null>(null);
  if (!importHandoff.current) {
    importHandoff.current = createImportHandoff({
      isOpen: (key) => stateRef.current?.shoot.id === key && leavingProject.current !== key,
      applyOpen: (key, batches) => setState((current) => {
        if (current?.shoot.id === key) return batches.reduce(applyImportBatch, current);
        // Another project came on screen first: these photos still go to their own project. Adding is idempotent.
        queueMicrotask(() => { for (const batch of batches) importHandoff.current!.add(key, batch); });
        return current;
      }),
      // The newest state not yet stored wins over the catalogue copy, so a failed save never loses earlier photos.
      load: async (key) => saveGuard.current!.pendingState(key) ?? catalogue.current!.loadProject(key),
      save: async (key, project) => { saveGuard.current!.submit(key, project); },
    });
  }

  const openRequest = useRef(0);
  useEffect(() => () => { openRequest.current += 1; }, []);

  const enterProject = useCallback((next: CullingState, restored?: BrowserPreviewProvider) => {
    // Remember it for the launch welcome's "pick up where you left off", however it was entered (opened from the hub,
    // just created, quick start). Local only; erased with device data.
    rememberLastProject(next);
    openRequest.current += 1;
    provider.current!.clear();
    if (restored) provider.current = restored;
    thumbs.current.ticket?.cancel();
    thumbs.current = { generation: thumbs.current.generation + 1, requested: new Set<string>(), queue: [] as PhotoFrame[], active: 0, ticket: null };
    setUrls({});
    setAssists({});
    setSelected(next.selectedFrameId ? [next.selectedFrameId] : []);
    setState(next);
    setScreen('editor');
  }, []);

  const projectsRef = useRef<Project[]>([]);
  projectsRef.current = projects;
  const openProject = useCallback(async (id: string) => {
    const request = ++openRequest.current;
    const store = catalogue.current!;
    const restored = new BrowserPreviewProvider();
    setHubState('loading');
    const handoff = importHandoff.current!;
    let entered = false;
    try {
      // Photos an import finished while this project was closed are written first; any that finish from now on are
      // held and added once the project is on screen (see the effect below).
      await handoff.beginOpen(id);
      const project = saveGuard.current!.pendingState(id) ?? await store.loadProject(id);
      if (request !== openRequest.current) return;
      if (!project) throw new Error('Missing project');
      // Restore stored Blobs and register native path readers. Opening the
      // catalogue does not require a connected drive or a full RAW decode.
      await rehydrateLocalFramesFromStore(project.frames, restored, store, { checkPaths: false });
      if (request !== openRequest.current) return;
      enterProject(project, restored);
      entered = true;
    } catch {
      if (request === openRequest.current) {
        setHubState('ready');
        setNotice(engineText.workspace.projectNotOpened);
      }
    } finally {
      if (!entered) handoff.abortOpen(id);
      if (provider.current !== restored) restored.clear();
    }
  }, [enterProject]);

  // The launch welcome's choice: once projects have loaded (now, or when the welcome finishes later), open the chosen
  // project or stay on the hub. The intent is taken once, so it can never open a project twice.
  const projectsLoaded = hubState === 'ready' || hubState === 'empty';
  useEffect(() => {
    if (!projectsLoaded) return;
    const consume = () => {
      const intent = takeLaunchIntent();
      if (!intent) return;
      const { open, notice: why } = resolveLaunchIntent(intent, openableProjectIds(projectsRef.current));
      if (why === 'missing-project') setNotice(v2Text.welcome.missingProject);
      if (open) void openProject(open);
    };
    consume();
    return onLaunchIntent(consume);
  }, [projectsLoaded, openProject]);

  // The welcome-back slideshow: while a project is open, remember which of its flagged photos to show next launch, as
  // references to previews already stored on this device (never the pictures, never uploaded). A moment after the
  // flags settle, so culling is never slowed. No flagged photos forgets it. The last project is written with it, so the
  // welcome's card and the slideshow's caption always name the same project (and the photo count stays current).
  // Local only; erased with device data.
  const slideshowFrames = state?.frames;
  const slideshowProject = state?.shoot;
  useEffect(() => {
    if (!slideshowFrames || !slideshowProject) return;
    const timer = window.setTimeout(() => {
      rememberLastProject({ shoot: slideshowProject, frames: slideshowFrames });
      const keys = pickSlideshowPhotos(slideshowFrames).map(hubPreviewKey);
      writeSlideshow(keys.length ? { projectId: slideshowProject.id, projectName: slideshowProject.title, developVersion: DEVELOP_VERSION, keys } : null);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [slideshowFrames, slideshowProject]);

  // The opened project is on screen: add the photos an import finished while it was opening. Their originals were
  // registered in the provider of the time, so register them in this project's provider first (from the stored copy or
  // the verified linked path, exactly as opening does). A photo whose original cannot be found shows as not connected.
  const openedProjectId = state?.shoot.id;
  useEffect(() => {
    if (!openedProjectId) return;
    // An earlier import into this project stopped before it finished (the tab closed, or it failed part-way): say which
    // photos are still to come, so the project never looks complete when it is not.
    if (importingInto.current !== openedProjectId) {
      let pending: ReturnType<typeof readPendingImport> = null;
      try { pending = readPendingImport(window.localStorage, openedProjectId); } catch { /* storage unavailable */ }
      if (pending) setNotice(engineText.workspace.importNotFinished(pending.count, pending.names.slice(0, 3).join(', ')));
    }
    const late = importHandoff.current!.finishOpen(openedProjectId);
    if (!late.length) return;
    const target = provider.current!;
    void rehydrateLocalFramesFromStore(late.flatMap((batch) => batch.frames), target, catalogue.current!, { checkPaths: false })
      .catch(() => false)
      .then(() => { for (const batch of late) importHandoff.current!.add(openedProjectId, batch); });
  }, [openedProjectId]);

  // Thumbnails: a few at a time, so a large project does not start thousands of reads at once. Each photo is asked for
  // once; a read in flight is never thrown away when more photos arrive, only when the project changes (generation).
  const thumbs = useRef({
    generation: 0, requested: new Set<string>(), queue: [] as PhotoFrame[],
    active: 0, ticket: null as import('../../core/engineScheduler').SchedulerTicket | null,
  });
  // One photo's thumbnail, for the background fill and for a tile on screen alike.
  const makeThumbnail = useCallback(async (frame: PhotoFrame, ctx: ScheduledContext, generation: number, sourceProvider: BrowserPreviewProvider) => {
    ctx.stage(engineText.workspace.thumbnailStage);
    const thumb = await sourceProvider.getThumbnailUrl(frame, 'visible');
    ctx.checkCancelled();
    if (generation !== thumbs.current.generation) return;
    // A DNG shown only by its camera preview (or not at all) may be one whose compression can't be read yet (JPEG
    // XL): then say that, never "original unavailable", which would be untrue.
    const unsupported = !thumb || sourceProvider.pictureSourceOf(thumb) === 'camera-preview'
      ? await sourceProvider.unsupportedCompression(frame) : null;
    if (unsupported) {
      ctx.commitIfCurrent(() => setUrls(current =>
        ({ ...current, [frame.id]: { ...current[frame.id], unsupported } })));
    }
    if (!thumb) {
      if (!unsupported) {
        ctx.commitIfCurrent(() => setUrls(current =>
          ({ ...current, [frame.id]: { ...current[frame.id], failed: true } })));
      }
      throw new Error(unsupported ? engineText.workspace.rawJpegXl : engineText.workspace.thumbnailFailed(frame.filename));
    }
    ctx.commitIfCurrent(() => setUrls(current => current[frame.id]?.thumb ? current
      : { ...current, [frame.id]: { ...current[frame.id], thumb } }));
  }, []);
  const pumpThumbnails = useCallback(() => {
    const book = thumbs.current;
    if (book.active || !book.queue.length) return;
    const frames = book.queue.splice(0);
    const generation = book.generation;
    book.active = 1;
    const sourceProvider = provider.current!;
    void engineScheduler.submit({
      title: engineText.workspace.thumbnailsTask(frames.length), kind: 'thumbnail', resource: 'io',
      group: { key: `thumbnails:${stateRef.current?.shoot.id ?? ''}`, title: engineText.workspace.thumbnailsGroup },
      priority: 1, pauseable: frames.length > 1, items: frames,
      snapshot: { generation, keys: frames.map(frame => frame.stableKey) },
      itemId: frame => frame.id, itemLabel: frame => frame.filename,
      runItem: (frame, _, ctx) => makeThumbnail(frame, ctx, generation, sourceProvider),
    }).then(ticket => {
      book.ticket = ticket;
      return ticket.finished;
    }).catch(() => {
      // Individual file failures are shown in the task and unavailable tile.
    }).finally(() => {
      if (generation !== thumbs.current.generation) return;
      book.active = 0;
      book.ticket = null;
      pumpThumbnails();
    });
  }, []);
  const projectId = state?.shoot.id;
  const frameCount = state?.frames.length ?? 0;
  useEffect(() => {
    if (!projectId) return;
    const book = thumbs.current;
    for (const frame of stateRef.current?.frames ?? []) {
      if (frame.removedAt || book.requested.has(frame.id)) continue;
      book.requested.add(frame.id);
      book.queue.push(frame);
    }
    pumpThumbnails();
  }, [projectId, frameCount, pumpThumbnails]);

  // The tiles on screen come first (owner, 27 Nov: "we display 5-10 in the filmstrip at a time"): each one the person
  // can see that has no thumbnail yet gets its own small job, admitted whatever the load and ahead of develops and
  // analysis, so they appear one by one. A tile that scrolls away before its turn is dropped from the queue; the
  // background fill above still gets to it later, at the lowest priority.
  const urlsNow = useRef(urls);
  urlsNow.current = urls;
  const onScreenThumbs = useRef(new Map<string, SchedulerTicket | null>());
  const thumbnailsOnScreen = useCallback((ids: readonly string[]) => {
    const jobs = onScreenThumbs.current;
    const shown = new Set(ids);
    for (const [id, ticket] of jobs) {
      if (shown.has(id) || !ticket) continue;
      if (!ticket.queued()) continue;
      ticket.cancel();
      jobs.delete(id);
    }
    const frames = stateRef.current?.frames ?? [];
    const sourceProvider = provider.current;
    if (!sourceProvider) return;
    const generation = thumbs.current.generation;
    for (const id of ids) {
      const known = urlsNow.current[id];
      if (jobs.has(id) || known?.thumb || known?.failed || known?.unsupported) continue;
      const frame = frames.find((candidate) => candidate.id === id && !candidate.removedAt);
      if (!frame) continue;
      jobs.set(id, null);
      void engineScheduler.submit({
        title: engineText.workspace.thumbnailsTask(1), kind: 'thumbnail', resource: 'io', light: true,
        group: { key: `thumbnails:${stateRef.current?.shoot.id ?? ''}`, title: engineText.workspace.thumbnailsGroup },
        priority: 500, pauseable: false, items: [frame],
        snapshot: { generation, keys: [frame.stableKey] },
        itemId: (item) => item.id, itemLabel: (item) => item.filename,
        runItem: (item, _, ctx) => makeThumbnail(item, ctx, generation, sourceProvider),
      }).then((ticket) => {
        if (jobs.get(id) === null) jobs.set(id, ticket);
        return ticket.finished.finally(() => { if (jobs.get(id) === ticket) jobs.delete(id); });
      }).catch(() => { if (jobs.get(id) === null) jobs.delete(id); });
    }
  }, [makeThumbnail]);

  // The photo on the canvas gets the larger preview, ahead of the queue.
  const activeId = state?.selectedFrameId ?? state?.frames.find((frame) => !frame.removedAt)?.id ?? null;
  useEffect(() => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === activeId);
    if (!frame || urls[frame.id]?.preview) return;
    let live = true;
    provider.current!.getFullPreviewUrl(frame, 'selected').then(
      (preview) => { if (live) setUrls((current) => ({ ...current, [frame.id]: { ...current[frame.id], preview } })); },
      () => { /* the thumbnail stays; the tile already says if the original is unavailable */ },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Culling read-ahead (off by default): once the photo on the canvas has its preview, prepare the photos either side
  // of it, the same preview they would show anyway, read, unpacked and decoded, so the next key press finds it ready.
  const warmed = useRef<Map<string, HTMLImageElement>>(new Map());
  useEffect(() => {
    const source = provider.current;
    const frames = stateRef.current?.frames ?? [];
    if (!source || !activeId || !urls[activeId]?.preview || (!can('cullWarmup') && !cullWarmupPreviewOn())) return;
    let live = true;
    // How far ahead, and how many decoded pictures are held, comes from the device's memory budget.
    const budget = deviceMemoryBudget();
    const neighbours = warmupNeighbours(frames, activeId, budget.readAheadReach);
    void (async () => {
      for (const frame of neighbours) {
        if (!live) return;
        const preview = await source.getFullPreviewUrl(frame, 'background').catch(() => '');
        if (!live || !preview || provider.current !== source) return;
        setUrls((current) => current[frame.id]?.preview === preview ? current : ({ ...current, [frame.id]: { ...current[frame.id], preview } }));
        // Decoding here keeps the picture in the browser's image cache; a few are held so it is not dropped at once.
        const image = new Image();
        image.src = preview;
        await image.decode().catch(() => undefined);
        warmed.current.delete(frame.id);
        warmed.current.set(frame.id, image);
        while (warmed.current.size > budget.readAheadHeld) warmed.current.delete(warmed.current.keys().next().value!);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, Boolean(activeId && urls[activeId]?.preview)]);

  // Developing, relinking or replacing an original revokes the provider's blob URLs. Forget them for every photo of
  // that original and ask again, so views that draw `previewUrl` directly (the All formats board) never show a dead link.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const listenedProvider = useRef<{ source: BrowserPreviewProvider; detach: () => void } | null>(null);
  useEffect(() => {
    const source = provider.current;
    if (!source || listenedProvider.current?.source === source) return;
    listenedProvider.current?.detach();
    const onSourceChanged = (event: Event) => {
      const stableKey = (event as CustomEvent<string>).detail;
      if (provider.current !== source || typeof stableKey !== 'string') return;
      const frames = stateRef.current?.frames ?? [];
      setUrls((current) => dropSourceUrls(current, frames, stableKey).urls);
      const affected = frames.filter((frame) => frame.stableKey === stableKey && !frame.removedAt);
      for (const frame of affected) {
        thumbs.current.requested.add(frame.id);
        thumbs.current.queue.push(frame);
      }
      pumpThumbnails();
      const active = affected.find((frame) => frame.id === activeIdRef.current);
      if (active) source.getFullPreviewUrl(active, 'selected').then(
        (preview) => { if (provider.current === source && preview) setUrls((current) => ({ ...current, [active.id]: { ...current[active.id], preview } })); },
        () => { /* the refreshed thumbnail stays */ },
      );
    };
    // The full-preview cache made room: only the large preview was revoked. A photo revisited later asks again.
    const onPreviewReleased = (event: Event) => {
      const stableKey = (event as CustomEvent<string>).detail;
      if (provider.current !== source || typeof stableKey !== 'string') return;
      const frames = stateRef.current?.frames ?? [];
      setUrls((current) => dropSourcePreview(current, frames, stableKey).urls);
      const active = frames.find((frame) => frame.stableKey === stableKey && !frame.removedAt && frame.id === activeIdRef.current);
      if (active) source.getFullPreviewUrl(active, 'selected').then(
        (preview) => { if (provider.current === source && preview) setUrls((current) => ({ ...current, [active.id]: { ...current[active.id], preview } })); },
        () => { /* the thumbnail stays */ },
      );
    };
    source.events.addEventListener('developed', onSourceChanged);
    source.events.addEventListener('preview-invalidated', onSourceChanged);
    source.events.addEventListener('full-preview-released', onPreviewReleased);
    listenedProvider.current = {
      source,
      detach: () => {
        source.events.removeEventListener('developed', onSourceChanged);
        source.events.removeEventListener('preview-invalidated', onSourceChanged);
        source.events.removeEventListener('full-preview-released', onPreviewReleased);
      },
    };
  });
  useEffect(() => () => { listenedProvider.current?.detach(); listenedProvider.current = null; }, []);

  // Automatic backups of the open project, shared with V1: soon after a change, every so often, and on leaving.
  useAutoBackup(state && !state.shoot.collage ? state : null, Boolean(state));
  const backupStatus = useBackupStatus(state?.shoot.id ?? '');
  // First run: pick photos, and InFlight makes a project, adds them and runs Auto on the first one.
  const [quickStart, setQuickStart] = useState<{ projectId: string; photoId: string | null; phase: 'working' | 'ready' | 'unchanged' | 'held' | 'failed' } | null>(null);
  const lightroomPending = useRef<{ projectId: string; photos: LightroomPhoto[]; toAdd: LightroomPhoto[] } | null>(null);
  const [lightroomOffer, setLightroomOffer] = useState<{ missing: number; folder: string } | null>(null);
  const mutate = useCallback((change: (current: CullingState) => CullingState) => setState((current) => (current ? change(current) : current)), []);

  // RAW + JPEG of one shot are one photo: the JPEG is kept but not listed, and decisions and ratings cover both.
  const pairs = useMemo(() => rawJpegPairs(state?.frames ?? []), [state?.frames]);
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;
  const decide = useCallback((given: string[], decision: CullDecision) => {
    const ids = withPartners(given, pairsRef.current);
    mutate((current) => ids.reduce((next, id) => applyDecisionWithHistory(next, id, decision, { allowAdvance: false }), current));
  }, [mutate]);

  // Live shoot room (desktop): other screens on this network watch the shoot and star or pick; their marks are combined
  // with the photographer's own and never overwrite a change the photographer made meanwhile.
  const shootRoom = useShootRoom({
    stateRef, provider, projectId: state?.shoot.id ?? null,
    hidden: (photoId) => pairsRef.current.rawOf.has(photoId),
    apply: (photoId, marks) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      if (!frame) return;
      if ((frame.rating ?? 0) !== marks.rating) {
        const ids = withPartners([photoId], pairsRef.current);
        mutate((current) => ({ ...current, frames: current.frames.map((each) => (ids.includes(each.id) ? { ...each, rating: marks.rating } : each)), shoot: { ...current.shoot, lastUpdatedAt: Date.now() } }));
      }
      if (frame.decision !== marks.decision) decide([photoId], marks.decision);
    },
    onKeptYours: (count) => setNotice(V2_STRINGS.liveShoot.roomKeptYours(count)),
    onProblem: (message) => setNotice(message),
  });

  // Moves already set-aside (rejected) photos to Trash. removeFromLibrary (shared with V1) ignores any id that
  // is not currently rejected, so this never deletes a kept or unreviewed photo by mistake. The removal itself is
  // written to the same undoStack that per-photo Undo already reads, so Cmd/Ctrl+Z brings it straight back.
  // RAWs imported before the sensor-size reader (or whose EXIF had no size) landed as a 1x1 Original: read the
  // recorded size from the original's own IFDs in the background, once per photo, and record it.
  const rawSizeTried = useRef(new Set<string>());
  const rawSizeWaiting = (state?.frames ?? []).filter((frame) => !frame.removedAt && !frame.isDemo && isRawPreviewFile(frame.filename)
    && !(frame.exif.width && frame.exif.height) && !rawSizeTried.current.has(frame.id)).map((frame) => frame.id).join(',');
  useEffect(() => {
    if (!rawSizeWaiting || !provider.current) return;
    let live = true;
    void (async () => {
      for (const id of rawSizeWaiting.split(',')) {
        if (!live) return;
        rawSizeTried.current.add(id);
        const frame = stateRef.current?.frames.find((candidate) => candidate.id === id);
        if (!frame) continue;
        const original = await provider.current!.ensureOriginal(frame.stableKey, 'background').catch(() => undefined);
        if (!original || !live) continue;
        const size = await original.slice(0, 2 << 20).arrayBuffer().then((buffer) => rawSensorSize(new Uint8Array(buffer))).catch(() => null);
        if (!size || !live) continue;
        mutate((current) => ({ ...current, frames: current.frames.map((item) => item.id === id && !(item.exif.width && item.exif.height)
          ? { ...item, exif: { ...item.exif, width: size.width, height: size.height } } : item) }));
      }
    })();
    return () => { live = false; };
  }, [rawSizeWaiting, mutate]);

  // Photos imported before the edit-status check (src/core/editStatus.ts) have none: read it in the background, once per
  // photo per session, from the first megabyte of the original (and its XMP sidecar on the desktop). Only the status is
  // recorded; nothing else in the photo's metadata changes, and an original that cannot be reached now is tried next time.
  const editStatusTried = useRef(new Set<string>());
  // The camera's own focus record (src/core/cameraFocus.ts) is read by the same pass: undefined means not read yet, and a
  // box read before the upright box existed is read again so it can be drawn on the picture.
  const focusUnread = (focus: PhotoFrame['exif']['cameraFocus']) => focus === undefined || (!!focus?.area && !focus.uprightArea);
  const needsEditStatus = (frame: PhotoFrame) => !frame.removedAt && !frame.isDemo && (!frame.exif.editStatus || focusUnread(frame.exif.cameraFocus)) && !editStatusTried.current.has(frame.id);
  // Only whether any photo is waiting: the fill's own writes must not restart it.
  const editStatusWaiting = (state?.frames ?? []).some(needsEditStatus);
  const editStatusProject = state?.shoot.id;
  useEffect(() => {
    if (!editStatusWaiting || !provider.current) return;
    let live = true;
    const timer = window.setTimeout(() => void (async () => {
      const found = new Map<string, { status?: NonNullable<PhotoFrame['exif']['editStatus']>; focus: PhotoFrame['exif']['cameraFocus'] }>();
      const flush = () => {
        if (!found.size || !live) return;
        const batch = new Map(found);
        found.clear();
        mutate((current) => ({ ...current, frames: current.frames.map((item) => {
          const read = batch.get(item.id);
          if (!read) return item;
          const exif = { ...item.exif };
          if (read.status && !exif.editStatus) exif.editStatus = read.status;
          if (focusUnread(exif.cameraFocus) && read.focus !== undefined) exif.cameraFocus = read.focus;
          return { ...item, exif };
        }) }));
      };
      for (const id of (stateRef.current?.frames ?? []).filter(needsEditStatus).map((frame) => frame.id)) {
        if (!live) return;
        editStatusTried.current.add(id);
        const frame = stateRef.current?.frames.find((candidate) => candidate.id === id);
        if (!frame || (frame.exif.editStatus && !focusUnread(frame.exif.cameraFocus))) continue;
        const head = await provider.current?.readOriginalHead(frame.stableKey).catch(() => undefined);
        if (!head || !live) continue;
        const exif = await parseImageExif(head, frame.filename).catch(() => null);
        const status = frame.exif.editStatus ? undefined
          : await editStatusWithSidecar(exif?.editStatus, frame.filename, frame.sourcePath).catch(() => exif?.editStatus);
        if (status || exif?.cameraFocus !== undefined) found.set(id, { status, focus: exif?.cameraFocus });
        if (found.size >= 25) flush();
        // Leave the main thread to the person between photos.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      flush();
    })(), 4000);
    return () => { live = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStatusWaiting, editStatusProject, mutate]);

  const removePhotos = useCallback((given: string[]) => {
    const ids = withPartners(given, pairsRef.current);
    mutate((current) => removeFromLibrary(current, ids));
    setSelected((current) => current.filter((id) => !ids.includes(id)));
  }, [mutate]);

  const activeFrame = state?.frames.find((frame) => frame.id === activeId) ?? null;
  // Measure the original only when the user opens an ordinary JPEG/PNG photo.
  // Do NOT promote a RAW embedded JPEG, EXIF or a cached review preview to native.
  const activeRasterKey = activeFrame ? `${activeFrame.stableKey}|${activeFrame.originalSha256 ?? ''}` : null;
  useEffect(() => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === activeId);
    if (!frame || !activeRasterKey || frame.isDemo || !fullResolutionRasterFormat(frame.filename) ||
        verifiedRasterSizes[activeRasterKey]) return;
    const controller = new AbortController();
    void loadVerifiedRasterOriginalForExport(frame, provider.current!, controller.signal).then(
      (image) => {
        if (!controller.signal.aborted) setVerifiedRasterSizes((current) => ({
          ...current, [activeRasterKey]: { width: image.naturalWidth, height: image.naturalHeight },
        }));
      },
      () => { /* Remain at an unverified preview size; never invent native pixels. */ },
    );
    return () => controller.abort();
    // Depends on source identity, not editing controls or unstable frame objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeRasterKey]);
  const editTargets = (photoId: string) => (selected.includes(photoId) ? selected : [photoId]);
  const editFrames = useCallback((ids: string[], change: (frame: PhotoFrame) => PhotoEdit | undefined, why?: EditWhy) => {
    const at = Date.now();
    mutate((current) => ({
      ...current,
      shoot: { ...current.shoot, lastUpdatedAt: at },
      frames: current.frames.map((frame) => {
        if (!ids.includes(frame.id)) return frame;
        const edit = change(frame);
        return syncEditGroup(recordEdit(frame, { edit: edit && !isEmptyEdit(edit) ? edit : undefined }, at, why));
      }),
    }));
  }, [mutate]);
  const applyPatch = useCallback((ids: string[], patch: Partial<EditRecipe>) => {
    const { unmapped } = applyRecipePatch(undefined, patch);
    if (unmapped.length) setNotice(engineText.workspace.notConnected(unmapped.join(', ')));
    editFrames(ids, (frame) => applyRecipePatch(frame.edit, patch).edit);
  }, [editFrames]);

  // RAW photos are developed from their sensor data in the background, so V2 shows InFlight's develop, not the camera's
  // JPEG. The photo on the canvas goes first. Paused while photos are being imported.
  useBackgroundDevelop({
    projectId: state?.shoot.id ?? '', frames: state?.frames ?? [], provider: provider.current,
    active: screen === 'editor' && Boolean(state) && !importing, onScreen: activeId,
    // Keep the camera's as-shot white with the photo, so Temperature can show kelvin. Never changes an edit.
    onAsShotWhite: (stableKey, white) => setState((current) => (current ? { ...current, frames: current.frames.map((frame) =>
      frame.stableKey === stableKey && (frame.asShotWhite?.kelvin !== white.kelvin || frame.asShotWhite?.duv !== white.duv)
        ? { ...frame, asShotWhite: white } : frame) } : current)),
    // Lets the picture label name Nikon HE/HE*. Never changes an edit.
    onRawCodec: (stableKey, codec) => setState((current) => (current ? { ...current, frames: current.frames.map((frame) =>
      frame.stableKey === stableKey && frame.rawCodec !== codec ? { ...frame, rawCodec: codec } : frame) } : current)),
  });

  // Photos read before vehicle tags joined the shared tag store get their tags once when the project opens; nothing is
  // written when they already match.
  const shootId = state?.shoot.id;
  useEffect(() => {
    if (!shootId) return;
    setState((current) => {
      if (!current) return current;
      const frames = syncAllVehicleTags(current.frames, VEHICLE_LABELS);
      return frames === current.frames ? current : { ...current, frames };
    });
  }, [shootId]);

  // Subject and species are named quietly on this device after photos are added (the species name is a suggestion the
  // person can change, and it never changes a decision). The species check is the Pro feature `speciesId`.
  useSpeciesScan({
    projectId: state?.shoot.id ?? '', frames: state?.frames ?? [], provider: provider.current,
    active: screen === 'editor' && Boolean(state) && !importing && can('speciesId'),
    area: state?.settings?.speciesArea,
    // Whether a photo may be from elsewhere is checked only while the place is unanswered and not yet asked, and not on
    // phones or low-memory devices (the world's birds and mammals take about 20 MB while it runs).
    checkOutside: Boolean(state && !state.settings?.speciesArea && !state.settings?.speciesAreaPrompt && !lowMemoryDevice()),
    onOutsideRegion: (_frameId, label) => setState((current) => (current && !current.settings?.speciesArea && !current.settings?.speciesAreaPrompt
      ? { ...current, settings: { ...(current.settings ?? LEGACY_SETTINGS), speciesAreaPrompt: { example: label.common } } } : current)),
    // A vehicle reading is carried across its burst: the same aircraft, read once, shown on every frame.
    // Sure shots taken at the same moment also confirm the same guess on their neighbours (src/core/speciesNearby.ts).
    onResult: (frameId, patch) => setState((current) => (current ? { ...current, frames: shareNearbySpecies(syncAllVehicleTags(carryVehicleReadings(current.frames.map((frame) =>
      frame.id === frameId && !frame.removedAt && speciesScanDue(frame) && kindWords(frame.tags) && !frame.subjectNames?.length
        ? { ...frame, ...patch, speciesScanVersion: SPECIES_SCAN_VERSION, ...(frame.subjectKind && patch.subjectKind ? { subjectKind: frame.subjectKind } : {}) } : frame), VEHICLE_LABELS), VEHICLE_LABELS)) } : current)),
  });

  // Bursts are refined quietly on this device from image embeddings (DINOv2): a real scene change splits a burst, and
  // look-alike frames without capture times group. Never changes a decision; paused while photos are being imported.
  useVisualGrouping({
    projectId: state?.shoot.id ?? '', frames: state?.frames ?? [], provider: provider.current,
    active: screen === 'editor' && Boolean(state) && !importing, onScreen: activeId,
    onEmbedded: (frameId, embedding) => setState((current) => (current ? { ...current, frames: current.frames.map((frame) =>
      frame.id === frameId ? { ...frame, visualEmbedding: embedding } : frame) } : current)),
    onBatchDone: () => setState((current) => {
      const regrouped = current ? regroupBurstsWithEmbeddings(current.frames) : null;
      return current && regrouped ? { ...current, frames: regrouped } : current;
    }),
    onUnavailable: (message) => setNotice(message),
  });

  // Plain-language tags (place from GPS, light, weather, style, genre) are worked out quietly on this device after photos
  // are added. Never changes a decision, rating or edit; paused while photos are being imported.
  useSceneTags({
    projectId: state?.shoot.id ?? '', frames: state?.frames ?? [], provider: provider.current,
    active: screen === 'editor' && Boolean(state) && !importing, onScreen: activeId,
    onTagged: (frameId, update) => setState((current) => (current ? { ...current, frames: current.frames.map((frame) =>
      frame.id === frameId && frame.removedAt == null ? update(frame) : frame) } : current)),
  });

  // Search by description: the photos whose picture matches the words in the search box (only with the opt-in pack).
  const searchPictureIds = usePictureSearch(stub.store.filmstripSearch, state?.frames ?? NO_FRAMES);

  const activePhotoExport = useRef<number | null>(null);
  useEffect(() => () => {
    if (activePhotoExport.current !== null) {
      tasks.cancel(activePhotoExport.current);
      activePhotoExport.current = null;
    }
  }, [projectId]);
  const runExportAction = useCallback(async (request: ExportRequest) => {
    const clickedAt = Date.now();
    const current = stateRef.current;
    if (!current) return;
    if (activePhotoExport.current !== null && request.destination !== 'local-individual' && request.destination !== 'local-folder') {
      setNotice(engineText.workspace.exportRunning); return;
    }
    const sourceProvider = provider.current!;
    const env = exportEnv.current;
    if (request.rawMaster) {
      const masterFormat = request.rawMasterFormat === 'png' ? 'png' : 'tiff';
      const png = masterFormat === 'png';
      const matches = current.frames.filter((frame) => frame.id === request.photoIds[0] && frame.removedAt == null);
      if (request.photoIds.length !== 1 || matches.length !== 1) { setNotice(png ? engineText.workspace.selectOneRawPng : engineText.workspace.selectOneRaw); return; }
      try {
        const frame = structuredClone(matches[0]);
        const ticket = await engineScheduler.submit({
          title: png ? engineText.workspace.rawPngTask : engineText.workspace.rawTiffTask, kind: 'raw', resource: 'gpu', priority: 10,
          pauseable: false, items: [{ id: frame.id, name: frame.filename }],
          snapshot: { frameId: frame.id, originalSha256: frame.originalSha256 },
          itemId: item => item.id, itemLabel: item => item.name,
          runItem: async (_, __, ctx) => {
            ctx.stage(engineText.workspace.rawTiffDevelop);
            const file = await buildRawMasterFile(frame, sourceProvider, ctx.signal, masterFormat);
            ctx.checkCancelled();
            ctx.stage(png ? engineText.workspace.rawPngSave : engineText.workspace.rawTiffSave);
            if (!await saveExportFile(file, file.name, ctx.signal))
              throw new DOMException(engineText.workspace.saveCancelled, 'AbortError');
            ctx.acknowledgeCommitted();
            ctx.commitIfCurrent(() => setNotice(png ? engineText.workspace.rawPngSaved : engineText.workspace.rawTiffSaved));
          },
        });
        const result = await ticket.finished;
        if (result === 'failed') setNotice(png ? engineText.workspace.rawPngFailed : engineText.workspace.rawTiffFailed);
        else if (result === 'cancelled') setNotice(png ? engineText.workspace.rawPngCancelled : engineText.workspace.rawTiffCancelled);
      } catch (reason) {
        setNotice(reason instanceof Error ? reason.message : (png ? engineText.workspace.rawPngNotQueued : engineText.workspace.rawTiffNotQueued));
      }
      return;
    }
    const plan = planExport(request, current.frames, createDefaultSizes());
    if ('error' in plan) { setNotice(plan.error); return; }
    // One photograph / output variant per scheduler item. Unlike a ZIP, local
    // individual and exclusive-folder saves have safe, confirmed file boundaries.
    // The snapshot survives edits made while the batch is waiting in the queue.
    if (request.destination === 'local-zip' || request.destination === 'local-individual' || request.destination === 'local-folder') {
      const count = photoExportUnits(plan, current.frames).length;
      const submittedEnv = structuredClone(env);
      try {
        const ticket = await scheduleV2PhotoExports({
          request, plan, frames: current.frames, provider: sourceProvider, clickedAt,
          buildOverlay: (frame, submittedRequest) => buildOverlayDraw(frame, submittedRequest, submittedEnv),
        });
        if (!ticket) { setNotice(engineText.workspace.noFolder); return; }
        setNotice(engineText.workspace.exportQueued(count));
        void ticket.finished.then(result => {
          if (result === 'done') setNotice(engineText.workspace.exportDone(count));
          else if (result === 'failed') setNotice(engineText.workspace.exportSomeFailed);
          else setNotice(engineText.workspace.exportStopped);
        });
      } catch (error) {
        // The desktop app rejects with plain text, not an Error: show its reason rather than hiding it.
        setNotice(reasonOf(error) || engineText.workspace.exportNotQueued);
      }
      return;
    }
    setNotice(engineText.workspace.destinationUnavailable);
  }, []);

  const runAutoCull = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    if (!can('smartCulling')) { setNotice(engineText.workspace.cullSwitchedOff); return; }
    if (cullController.current) { setNotice(engineText.workspace.cullRunning); return; }
    const candidates = current.frames.filter(frame =>
      frame.removedAt == null && frame.decision === 'unreviewed' && !frame.isDemo && !frame.virtualCopy);
    if (!candidates.length) { setNotice(engineText.workspace.cullNothing); return; }
    const controller = new AbortController();
    cullController.current = controller;
    const projectKey = current.shoot.id;
    const requestId = openRequest.current;
    try {
      // Keeper selection requires all shoot-wide evidence, so it is one
      // non-pauseable unit. Per-photo progress is real; cancellation prevents
      // a late scan-wide decision from changing the catalogue.
      const ticket = await engineScheduler.submit({
        title: engineText.workspace.cullTask,
        kind: 'cull', resource: 'cpu', priority: 5, pauseable: false,
        items: [{ id: projectKey, label: candidates.length + ' photos' }],
        snapshot: { projectKey, requestId, candidates: candidates.map(frame => frame.id) },
        itemId: item => item.id, itemLabel: item => item.label,
        runItem: async (_, __, ctx) => {
          ctx.stage(engineText.workspace.cullScan);
          ctx.setSubitems(candidates.map(frame => ({ id: frame.id, label: frame.filename })));
          const judgedFrom = new Map<string, PictureSource | undefined>();
          // With the cull-rules preview on, each photo keeps the numbers it was judged from (x-std-rescore). When every
          // candidate has current ones, the photos are judged again from them, with no new scan; a project from before
          // this, or any photo whose file or detector changed, is scanned once more.
          const storeObservations = can('cullRules') || workflowPreviewOn('cullRules');
          const stored = storeObservations
            ? rescoreFromObservations(candidates, DETECTOR_MODEL.sha256, Boolean(bundledModelUrl(DETECTOR_MODEL.file))) : null;
          let scanned: { scan: ScanEvidence; healthy: boolean } | null = null;
          let results;
          if (stored && !stored.missing.length) {
            results = stored.results;
            ctx.reportProgress(candidates.length, candidates.length, `${candidates.length} of ${candidates.length} analysed`);
          } else {
            results = await scanForCulling(candidates, current.frames, provider.current!, null,
              ctx.signal, count => ctx.reportProgress(count, candidates.length, `${count} of ${candidates.length} analysed`),
              () => ctx.commitIfCurrent(() => setNotice(engineText.workspace.cullNoDetector)),
              (frameId, stage) => ctx.updateSubitem(frameId,
                stage === 'analysing' ? 'running' : 'done',
                stage === 'unavailable' ? engineText.workspace.cullDetectorStage : stage),
              undefined, (frameId, source) => judgedFrom.set(frameId, source),
              storeObservations ? (scan, healthy) => { scanned = { scan, healthy }; } : undefined);
          }
          ctx.checkCancelled();
          if (requestId !== openRequest.current || stateRef.current?.shoot.id !== projectKey) return;
          ctx.stage(engineText.workspace.cullApply);
          // Vision AI is the guardian: before confident keepers are applied (Auto-pilot does this after every import), the
          // on-device model is asked whether the main subject is clearly visible and sharp. A clear "no" holds that keeper
          // as a suggestion for the person; agreement, doubt or no model change nothing (src/core/cullGuardian.ts).
          let guarded = results;
          let held: string[] = [];
          if (await onDeviceGuardianReady()) {
            const opinions = new Map<string, GuardianOpinion>();
            for (const frameId of keepsToGuard(results, GUARDED_KEEPS_LIMIT)) {
              ctx.checkCancelled();
              const frame = candidates.find((candidate) => candidate.id === frameId);
              const url = frame ? await provider.current!.getFullPreviewUrl(frame, 'background').catch(() => '') : '';
              const picture = url ? await fetch(url).then((response) => response.blob()).catch(() => null) : null;
              const opinion = picture ? await askOnDeviceGuardianAbout(picture, 'subjectClear') : null;
              if (opinion) opinions.set(frameId, opinion);
            }
            ctx.checkCancelled();
            ({ results: guarded, held } = holdDoubtedKeeps(results, opinions));
          }
          if (requestId !== openRequest.current || stateRef.current?.shoot.id !== projectKey) return;
          ctx.commitIfCurrent(() => setState(latest => {
            if (!latest || latest.shoot.id !== projectKey || requestId !== openRequest.current || ctx.signal.aborted) return latest;
            const committed = commitAutoCull(latest, candidates, guarded);
            const seen = scanned as { scan: ScanEvidence; healthy: boolean } | null;
            return seen ? recordCullObservations(committed, candidates, seen.scan, DETECTOR_MODEL.sha256, seen.healthy, Date.now()) : committed;
          }));
          // Which picture each RAW was actually judged from; unknown counts as the camera's preview (never overstated).
          const summary = autoCullSummary(candidates.length, rawsJudgedFromCameraPreview(candidates, results, judgedFrom), held.length);
          ctx.commitIfCurrent(() => setNotice(summary));
        },
      });
      controller.signal.addEventListener('abort', () => ticket.cancel(), { once: true });
      if (controller.signal.aborted) ticket.cancel();
      const result = await ticket.finished;
      if (result === 'failed') setNotice(engineText.workspace.cullFailed);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : engineText.workspace.cullNotQueued);
    } finally {
      controller.abort();
      if (cullController.current === controller) cullController.current = null;
    }
  }, [can]);

  /** Text and watermark overlays stay with the photograph and are reversible in its saved history. */
  const changeOverlay = useCallback((photoId: string, change: (overlay: OverlaySettings) => OverlaySettings) => {
    const at = Date.now();
    mutate((current) => {
      let changed = false;
      const frames = current.frames.map((frame) => {
        if (frame.id !== photoId) return frame;
        const next = changePhotoOverlay(frame, change, at);
        if (next !== frame) changed = true;
        return next;
      });
      return changed ? { ...current, shoot: { ...current.shoot, lastUpdatedAt: at }, frames } : current;
    });
  }, [mutate]);

  /** Add an image layer on top of the photo's stack, sized to fit its frame. */
  const addLayerTo = useCallback((photoId: string, assetId: string, label: string, aspect: number, widthShare = 0.5) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame) return;
    if (readOverlay(frame.overlay).layers?.length === MAX_LAYERS) { setNotice(`A photo can have up to ${MAX_LAYERS} layers. Remove one to add another.`); return; }
    const w = frame.exif.width || 3, h = frame.exif.height || 2;
    const framed = framedSize(w, h, frame.framing ?? DEFAULT_FRAMING);
    changeOverlay(photoId, (overlay) => addLayer(overlay, newLayer(`layer-${newId().slice(0, 8)}`, assetId, label, aspect, framed.height / framed.width, widthShare)));
  }, [changeOverlay]);

  // 'auto' watermark: light or dark from the pixels behind it, using the same measure as the export (src/core/watermark.ts).
  const activeOverlay = activeFrame ? readOverlay(activeFrame.overlay) : null;
  const detectKey = activeFrame && activeOverlay?.watermarkEnabled && activeOverlay.watermarkContrast === 'auto'
    ? `${activeFrame.id}|${activeOverlay.watermarkX}|${activeOverlay.watermarkY}|${activeOverlay.watermarkScale}` : null;
  useEffect(() => {
    if (!detectKey || !activeFrame || !activeOverlay) return;
    let live = true;
    const frame = activeFrame, overlay = activeOverlay;
    provider.current!.getFullPreviewUrl(frame, 'selected').then(async (url) => {
      if (!url || !live) return;
      const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = url; });
      const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      // The patch the watermark covers: about 22% by 12% of the frame, scaled with the watermark, centred on its position.
      const w = Math.max(8, Math.round(canvas.width * 0.22 * (overlay.watermarkScale / 100))), h = Math.max(8, Math.round(canvas.height * 0.12 * (overlay.watermarkScale / 100)));
      const x = Math.min(canvas.width - w, Math.max(0, Math.round((overlay.watermarkX / 100) * canvas.width - w / 2)));
      const y = Math.min(canvas.height - h, Math.max(0, Math.round((overlay.watermarkY / 100) * canvas.height - h / 2)));
      const patch = context.getImageData(x, y, w, h);
      const tone = watermarkToneForPixels(patch.data, patch.width, patch.height);
      if (live) setWatermarkAuto((current) => ({ ...current, [frame.id]: tone === 'light' ? 'light-on-dark' : 'dark-on-light' }));
    }).catch(() => { /* no measurement: the watermark falls back to light on dark */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectKey]);

  // A photo whose file records no size takes its Original shape from the picture shown, measured at once (not after the
  // histogram's debounce), so Formats does not open as an unknown 1:1 Original and correct itself later (owner, 25 Nov).
  const measureId = activeFrame && !(activeFrame.exif.width && activeFrame.exif.height) && !pixelSizes[activeFrame.id] ? activeFrame.id : null;
  useEffect(() => {
    if (!measureId || !activeFrame) return;
    let live = true;
    const frame = activeFrame;
    provider.current!.getFullPreviewUrl(frame, 'selected').then(async (url) => {
      if (!url || !live) return;
      const image = await loadImage(url);
      if (live && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setPixelSizes((current) => (current[frame.id] ? current : { ...current, [frame.id]: { width: image.naturalWidth, height: image.naturalHeight } }));
      }
    }).catch(() => { /* the histogram pass measures it later */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureId]);

  // The histogram is measured from the picture as it is now: the preview with this photo's edit applied, small and debounced.
  const histogramKey = activeFrame ? `${activeFrame.id}|${JSON.stringify(activeFrame.edit ?? null)}|${JSON.stringify(activeFrame.framing ?? null)}` : null;
  // The preview the histogram is measured from, decoded once per address (not once per slider step).
  // One entry, replaced when the address changes: the loaded preview (the 16-bit pass checks its turn against it) and its
  // small unedited copy.
  const histogramSource = useRef<{ url: string; picture: Promise<{ element: HTMLImageElement; naturalWidth: number; naturalHeight: number; small: ImageData }> } | null>(null);
  useEffect(() => {
    if (!histogramKey || !activeFrame) return;
    let live = true;
    const frame = activeFrame;
    let stopWaiting: (() => void) | undefined;
    const measure = () => {
      // Not while a slider is held: the histogram follows once the hand is still.
      if (editGestureActive()) { stopWaiting = onEditGestureEnd(() => { stopWaiting?.(); stopWaiting = undefined; if (live) measure(); }); return; }
      provider.current!.getFullPreviewUrl(frame, 'selected').then(async (url) => {
        if (!url || !live) return;
        if (histogramSource.current?.url !== url) {
          const picture = loadImage(url).then((element) => {
            const scale = Math.min(1, 256 / Math.max(element.naturalWidth, element.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(element.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
            const context = canvas.getContext('2d', { willReadFrequently: true })!;
            context.drawImage(element, 0, 0, canvas.width, canvas.height);
            return { element, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, small: context.getImageData(0, 0, canvas.width, canvas.height) };
          });
          histogramSource.current = { url, picture };
          picture.catch(() => { if (histogramSource.current?.picture === picture) histogramSource.current = null; });
        }
        const image = await histogramSource.current.picture;
        // When the file records no size, the shown picture gives the photo its shape. For a plain picture file that is
        // the original size; for RAW and HEIF it is the preview's size, which the export renderer never enlarges past.
        if (live && !(frame.exif.width && frame.exif.height)) setPixelSizes((current) => (current[frame.id]?.width === image.naturalWidth && current[frame.id]?.height === image.naturalHeight ? current : { ...current, [frame.id]: { width: image.naturalWidth, height: image.naturalHeight } }));
        const measureStart = performance.now();
        // The small unedited picture is drawn once per preview (above) and kept: each step only applies its edit to a copy,
        // in the picture worker (pixelAnalysis.ts), so measuring never holds the page; here only if that cannot run.
        const fromWorker = await histogramOffThread(image.small, frame.edit ?? EMPTY_EDIT).catch(() => null);
        if (!live) return;
        let measuredHere = fromWorker;
        if (!measuredHere) {
          const canvas = document.createElement('canvas');
          canvas.width = image.small.width; canvas.height = image.small.height;
          const context = canvas.getContext('2d', { willReadFrequently: true })!;
          context.putImageData(image.small, 0, 0);
          applyCanvasPhotoEdit(canvas, frame.edit ?? EMPTY_EDIT);
          measuredHere = toPhotoHistogram(context.getImageData(0, 0, canvas.width, canvas.height).data);
        }
        measureStep('histogram:measure', measureStart, { worker: Boolean(fromWorker) });
        const histogram = measuredHere;
        if (live) setHistograms((current) => ({ ...current, [frame.id]: histogram }));
        // When the picture on screen is InFlight's own RAW develop, measure again from the 16-bit develop (kept small, made
        // once per photo) with the same 16-bit edit maths as the export. The 8-bit measurement stands until then, or if not.
        if (!live || !raw16Possible(frame, provider.current!.pictureSourceOf(url), canDevelopRaw())) return;
        // Only for a photo the person stays on: browsing past photos never starts a full RAW develop for each one.
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        if (!live) return;
        const working = await raw16WorkingFor(frame, () => provider.current!.ensureOriginal(frame.stableKey, 'selected'), image.element);
        const measured = live && working ? timedStep('histogram:raw16', () => histogramFromWorking(measuringCopy(working), frame.edit ?? EMPTY_EDIT, frame.framing, renderRaw16Working)) : null;
        if (live && measured) setHistograms((current) => ({ ...current, [frame.id]: measured }));
      }).catch(() => { /* no measurement: the panel says it is still measuring, never a made-up curve */ });
    };
    const timer = window.setTimeout(measure, 160);
    return () => { live = false; window.clearTimeout(timer); stopWaiting?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histogramKey]);

  // On-image advice (a preview, off by default): where the highlights and shadows clip and whether the edit kept the
  // subject's colour, measured from the same small preview as the histogram, once the edit settles (never while a slider
  // is held), and cleared the moment the edit changes. The clipping is published first; the colour follows once the subject
  // is found (adviceRun.ts). The key includes the preview's address, so a preview that was not ready, or is replaced by a
  // better one, is measured when it arrives. Read-only: the canvas layer only draws it (adviceStore.ts).
  const advicePreview = activeFrame ? urls[activeFrame.id]?.preview ?? '' : '';
  const adviceKey = (can('onImageAdvice') || workflowPreviewOn('onImageAdvice')) && histogramKey ? `${histogramKey}|${advicePreview}` : null;
  useEffect(() => {
    const frame = activeFrame;
    if (!adviceKey || !frame) return;
    return startAdviceRun<HTMLImageElement>({
      photoId: frame.id,
      getUrl: () => provider.current!.getFullPreviewUrl(frame, 'selected'),
      loadPicture: async (url) => (histogramSource.current?.url === url ? (await histogramSource.current.picture).element : loadImage(url)),
      findSubject: async (url) => { const found = await lookForZoomFocus(frame.id, url); return found.kind === 'ready' ? found.subject : null; },
      measure: (image, subject) => measureAdviceFor(image, frame.edit ?? EMPTY_EDIT, frame.framing, subject),
      publish: (advice) => setAdvice(frame.id, advice),
      gestureActive: editGestureActive,
      onGestureEnd: onEditGestureEnd,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adviceKey]);

  // A stored AI denoise result lives on the device that made it. Say plainly when this device does not have it: the view
  // is drawn without it, and export refuses rather than quietly leave it out.
  const aiAsset = activeFrame?.edit?.trueDetailAi?.asset ?? null;
  useEffect(() => {
    if (!aiAsset || !activeFrame) return;
    let live = true;
    void preloadTrueDetailAi(activeFrame.edit).then(found => {
      if (live && !found) setNotice('This photo’s learned denoise result is not on this device, so it is shown without it and will not export. Run Denoise again here, or turn the learned denoise off in Enhance.');
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAsset]);

  // Once the active photo's masks settle (debounced, same idea as the histogram above but a real pixel
  // render so it waits for a pause rather than running on every drag tick), run them through the real
  // verified-and-retried engine action (maskVerify.ts's verifyFrameMasks -> engine/maskAction.ts). Scoped to
  // the one open photo, same boundary the histogram and watermark-tone checks already draw. The check only
  // ADVISES: a slider value the person set is their decision and is never rewritten in the background. It
  // used to write the gentler retry back, which silently pulled a deliberate Subject Exposure of -1.5 to
  // nearly 0 (a dark subject on a cool background reads frame-wide as a "cool colour cast", and a comparison
  // the verifier cannot make suggests strength 0), so the edit looked lost after Hide and Show.
  const guardedMaskShapes = useRef(new Set<string>());
  const maskVerifyKey = activeFrame && projectId && hasActiveMasks(activeFrame.edit?.masks)
    ? maskVerificationKey(projectId, activeFrame) : null;
  useEffect(() => {
    if (!maskVerifyKey || !activeFrame || !projectId) return;
    const controller = new AbortController();
    const frame = activeFrame;
    const capturedProject = projectId;
    const sourceProvider = provider.current!;
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const image = await loadExportSource(frame, sourceProvider);
          if (controller.signal.aborted) return;
          const outcome = await verifyFrameMasks(image, frame, controller.signal);
          if (controller.signal.aborted || !outcome) return;
          const stillSame = () => {
            const currentState = stateRef.current;
            const latest = currentState?.frames.find(candidate => candidate.id === frame.id);
            return Boolean(latest && currentState?.shoot.id === capturedProject && maskVerificationKey(capturedProject, latest) === maskVerifyKey);
          };
          const advice = maskAdvice(outcome.verification);
          if (advice) {
            if (stillSame()) setNotice(advice);
            return;
          }
          // Vision guardian (owner decision 2): is the subject mask on the subject, and does it cover all of it? Asked
          // once per mask shape, on this device only. Advice only: a "no" adds a notice; the mask is never changed.
          const subjectMask = frame.edit?.masks?.find((mask): mask is Extract<Mask, { kind: 'subject' }> => mask.kind === 'subject' && !mask.hidden);
          if (!subjectMask || !hasLocalVision()) return;
          const shapeKey = subjectMaskShapeKey(frame, subjectMask);
          if (guardedMaskShapes.current.has(shapeKey)) return;
          guardedMaskShapes.current.add(shapeKey);
          const doubted = await guardianDoubtsSubjectMask(image, frame, subjectMask, controller.signal);
          if (doubted && !controller.signal.aborted && stillSame()) setNotice(v2Text.guardian.maskDoubted);
        } catch {
          // A failed safety check must not block the manual editor.
        }
      })();
    }, 500);
    return () => { controller.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskVerifyKey]);

  /** Each format's crop lives with the photo (saved, backed up, used by the export). It is not an edit, so it is not in edit history. */
  const changeCrops = useCallback((photoId: string, sizeIds: string[], change: (crop: ReturnType<typeof readCrops>[string] | undefined) => ReturnType<typeof readCrops>[string]) => {
    const at = Date.now();
    mutate((current) => ({
      ...current,
      shoot: { ...current.shoot, lastUpdatedAt: at },
      frames: current.frames.map((frame) => {
        if (frame.id !== photoId) return frame;
        const crops = readCrops(frame.sizeCrops);
        let formatHistory = frame.formatHistory;
        for (const id of sizeIds) {
          const before = crops[id] ?? DEFAULT_CROP;
          const after = change(crops[id]);
          crops[id] = after;
          formatHistory = recordFormatCrop(formatHistory, id, before, after, at);
        }
        return { ...frame, sizeCrops: crops, formatHistory };
      }),
    }));
  }, [mutate]);

  /** Change a photo's format set. Returns false when the change was refused (nothing is saved). `crops` may also rewrite the saved crops. */
  const changeFormats = useCallback((photoId: string, change: (raw: unknown) => FormatSet | undefined, crops?: (raw: unknown) => unknown): boolean => {
    const current = stateRef.current;
    const frame = current?.frames.find((candidate) => candidate.id === photoId);
    if (!current || !frame) return false;
    const next = change(frame.formats);
    if (!next) return false;
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, formats: next,
      formatHistory: recordFormatSetChange(entry.formatHistory, entry.formats, next, at, entry.editHistory?.cursor ?? 0),
      ...(crops ? { sizeCrops: crops(entry.sizeCrops) } : {}) } : entry)) }));
    return true;
  }, [mutate]);

  /** Flip a format between paper-clipped to the active edit group and independent. Only that one photo's choice changes. */
  const toggleSizeLinked = useCallback((photoId: string, sizeId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame) return;
    const next = toggleSizeLinkedRaw(frame.sizeLinked, sizeId);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, sizeLinked: next, formatHistory: recordFormatLink(entry.formatHistory, sizeId, next[sizeId] ?? true, at) } : entry)) }));
  }, [mutate]);

  /** Change a photo's video pan/zoom (Ken Burns) settings. Only the given fields change; the rest are kept. */
  const updateVideoZoom = useCallback((photoId: string, patch: Parameters<typeof patchVideoZoom>[1]) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame) return;
    const next = patchVideoZoom(frame.videoZoom, patch);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? { ...entry, videoZoom: next } : entry)) }));
  }, [mutate]);

  /** Save each split/rejoin or pan-offset as a genuinely undoable edit. Older
   * projects used a photo-wide splitFrames flag with no per-format record:
   * capture its effective two-frame state before changing it, so Undo restores
   * that layout rather than an invented empty baseline. */
  const recordSplitChange = (entry: PhotoFrame, next: ReturnType<typeof writeSplitFrameCount>, at: number): PhotoFrame => {
    const legacy = entry.splitFrames === true
      ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(entry.splitPanOffset) } }
      : {};
    const before = entry.formatSplits ?? legacy;
    return recordEdit({ ...entry, formatSplits: before }, { formatSplits: next }, at);
  };

  /** Split only the active FORMAT; other outputs of the photo are unaffected. */
  const toggleSplitFrames = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    const sizeId = stub.store.activeSizeId;
    if (!frame || !sizeId) return;
    const next = toggleFormatSplit(frame.formatSplits ?? (frame.splitFrames === true ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } } : undefined), sizeId);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? recordSplitChange(entry, next, at) : entry)) }));
  }, [mutate, stub.store.activeSizeId]);

  /** One format's persisted 1/2/3 continuous split, used by both V2 canvas and export planner. */
  const setSplitFrameCount = useCallback((photoId: string, sizeId: string, count: SplitFrameCount) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
    if (!frame || !isSplitFrameCount(count)) return;
    const sizes = applyFormats(createDefaultSizes(), frame.formats);
    if (!sizes.some((size) => size.id === sizeId && size.kind === 'photo')) {
      setNotice(engineText.workspace.formatFirst);
      return;
    }
    const current = frame.formatSplits ?? (frame.splitFrames === true
      ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } } : undefined);
    const next = writeSplitFrameCount(current, sizeId, count);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at },
      frames: state.frames.map((entry) => entry.id === photoId ? recordSplitChange(entry, next, at) : entry) }));
    setNotice(count === 1 ? engineText.workspace.formatRejoined : engineText.workspace.formatSplit(count));
  }, [mutate]);

  /** Move both halves together inside this format's two-section composition. */
  const setSplitPanOffset = useCallback((photoId: string, offset: number) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    const sizeId = stub.store.activeSizeId;
    if (!frame || !sizeId) return;
    const next = setFormatSplitOffset(frame.formatSplits ?? (frame.splitFrames === true ? { 'orig-3x2': { enabled: true, offset: readSplitPanOffset(frame.splitPanOffset) } } : undefined), sizeId, offset);
    const at = Date.now();
    mutate((state) => ({ ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map((entry) => (entry.id === photoId ? recordSplitChange(entry, next, at) : entry)) }));
  }, [mutate, stub.store.activeSizeId]);

  const tapSelect = useTapSelect({ stateRef, provider, editFrames, setNotice, onScreen: screen === 'editor' && !importing ? activeId : null });

  /** Reuse actual area/gradient masks from the shared engine. Sky detection and brush painting are intentionally gated. */
  const addMask = useCallback(async (photoId: string, type: 'subject' | 'sky' | 'background' | 'brush' | 'area' | 'gradient') => {
    if (type === 'sky') { setNotice(engineText.workspace.skyUnavailable); return; }
    if (type === 'brush') { setNotice(engineText.workspace.brushUnavailable); return; }
    const project = stateRef.current;
    const frame = project?.frames.find((candidate) => candidate.id === photoId && !candidate.removedAt);
    if (!project || !frame) return;
    if (!canAddMask(frame.edit?.masks)) { setNotice(engineText.workspace.masksFull); return; }
    if (type === 'area' || type === 'gradient') {
      const shape = createMask(type === 'area' ? 'radial' : 'linear', newId());
      editFrames([photoId], (latest) => canAddMask(latest.edit?.masks)
        ? ({ ...(latest.edit ?? DEFAULT_EDIT), masks: [...(latest.edit?.masks ?? []), shape] }) : latest.edit);
      setNotice(type === 'area' ? engineText.workspace.ovalAdded : engineText.workspace.gradientAdded);
      return;
    }
    const jobKey = JSON.stringify([project.shoot.id, photoId]);
    if (maskInFlight.current.has(jobKey)) return;
    maskInFlight.current.add(jobKey);
    // Subject and background detection share the GPU queue with export and
    // denoise. This one-photo job cannot pause mid-model; Cancel prevents its
    // eventual result from changing the current photograph.
    void engineScheduler.submit({
      title: type === 'subject' ? engineText.workspace.findSubjectTask : engineText.workspace.findBackgroundTask,
      kind: 'mask', resource: 'gpu', priority: 18, interactive: true,
      pauseable: false, items: [{ id: photoId, name: frame.filename }],
      snapshot: { projectId: project.shoot.id, photoId, framing: frame.framing },
      itemId: item => item.id, itemLabel: item => item.name,
      runItem: async (_, __, ctx) => {
        ctx.stage(engineText.workspace.findEdgesStage);
        // A mask needs the photo's shape and content, not export-grade pixels. A RAW this device cannot develop (for
        // example Nikon HE*) made the export loader throw, so subject detection always failed on such files; it now
        // falls back to the preview shown on the canvas, which has the same framing.
        const image = await loadExportSource(frame, provider.current!).catch(async (reason) => {
          const shown = isRawPreviewFile(frame.filename) || isHeifFile(frame.filename)
            ? await provider.current!.getFullPreviewUrl(frame, 'selected').catch(() => '') : '';
          if (!shown) throw reason;
          return loadImage(shown);
        });
        ctx.checkCancelled();
        const framing = frame.framing ?? DEFAULT_FRAMING;
        const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
        const framed = document.createElement('canvas');
        drawFramedPhoto(image, framed, framing, { scale: Math.min(1, GUIDED_RENDER_EDGE / Math.max(width, height)) });
        const { grid, assessment, detail, boxFinding } = await detectSubjectGuided(framed);
        ctx.checkCancelled();
        if (!assessment.usable) {
          ctx.commitIfCurrent(() => setNotice(assessment.reason));
          return;
        }
        // Desktop with the fine-edge pack (BiRefNet-lite): its finer edges, only when it found the same subject. The
        // built-in U²-Netp mask stays otherwise, and always on phones and in browsers.
        const refined = await import('../../providers/fineEdgeMask').then((m) => m.refineSubjectGrid(framed, grid, detail, ctx.signal)).catch(() => null);
        ctx.checkCancelled();
        const mask = {
          ...createSubjectMask(newId(), refined?.grid ?? grid, framingKey(framing), assessment.confidence, refined?.detail ?? detail),
          invert: type === 'background', feather: 0.5,
        };
        const latest = stateRef.current;
        if (!latest || !subjectMaskTarget(latest, project.shoot.id, frame)) {
          ctx.commitIfCurrent(() => setNotice(engineText.workspace.maskDiscarded));
          return;
        }
        const at = Date.now();
        ctx.stage(engineText.workspace.saveMaskStage);
        ctx.commitIfCurrent(() => mutate(current =>
          ctx.signal.aborted ? current : commitSubjectMask(current, project.shoot.id, frame, mask, at)));
        const confidence = boxFinding
          ? (engineText.workspace.confidence as Record<string, string>)[judgeSubject({ label: boxFinding.detection.label, score: boxFinding.detection.score,
              size: Math.max(boxFinding.detection.box.w, boxFinding.detection.box.h),
              sharpness: boxFinding.sharpness }).confidence] ?? ''
          : '';
        ctx.commitIfCurrent(() => setNotice(type === 'subject' ? engineText.workspace.subjectMaskAdded(confidence) : engineText.workspace.backgroundMaskAdded(confidence)));
      },
    }).then(ticket => ticket.finished).then(result => {
      if (result === 'failed') setNotice(engineText.workspace.subjectFailed);
    }).catch(reason => setNotice(reason instanceof Error ? reason.message : engineText.workspace.subjectNotQueued))
      .finally(() => { maskInFlight.current.delete(jobKey); });
  }, [editFrames, mutate]);
  const editMasks = useCallback((photoId: string, change: (masks: ReturnType<typeof removeMask>) => ReturnType<typeof removeMask>) =>
    editFrames([photoId], (frame) => ({ ...(frame.edit ?? DEFAULT_EDIT), masks: change(frame.edit?.masks ?? []) })), [editFrames]);

  // The person pressed "Denoise this photo". Signed in, online and with the cloud feature on, that press is the consent to
  // upload a working-size copy for this one job; otherwise, or if the cloud fails or does not verify, it runs on this device.
  const denoiseInFlight = useRef(new Set<string>());
  const denoisePhoto = useCallback((photoId: string, options?: { anyway?: boolean }) => {
    const frame = stateRef.current?.frames.find(candidate => candidate.id === photoId);
    if (!frame || denoiseInFlight.current.has(photoId)) return;
    denoiseInFlight.current.add(photoId);
    sayDenoise(photoId, null);
    // Existing explicit cloud opt-in is preserved. A local fallback is labelled
    // with the runner that actually returned, never as a successful cloud job.
    const connection = can('cloudAssist') ? accountConnection() : null;
    void engineScheduler.submit({
      title: engineText.workspace.denoiseTask(frame.filename),
      // One photo the person pressed Denoise on and is watching: it starts beside a running background RAW develop
      // instead of waiting for that develop's current photo to finish (engineScheduler `interactive`).
      kind: 'denoise', resource: 'gpu', priority: 12, location: 'local', interactive: true,
      pauseable: false, items: [{ id: photoId, name: frame.filename }],
      snapshot: { photoId, edit: frame.edit ?? DEFAULT_EDIT },
      itemId: item => item.id, itemLabel: item => item.name,
      runItem: async (_, __, ctx) => {
        ctx.stage(engineText.workspace.denoiseStage);
        const outcome = await runV2Denoise(frame, provider.current!,
          connection ? { connection, online: navigator.onLine !== false } : null, ctx.signal,
          (done, total, label) => ctx.reportProgress(done, total, label),
          // The Tasks row says what was measured and the strength chosen, as soon as both are known.
          { anyway: options?.anyway, onMeasured: text => ctx.stage(text) });
        ctx.checkCancelled();
        if (!outcome) throw new Error(engineText.workspace.denoiseNoSource);
        if (outcome.notDeveloped) {
          // Not a failure: the RAW is not developed yet. Say so plainly and let the panel show "Wait for develop".
          ctx.commitIfCurrent(() => { sayDenoise(photoId, { state: 'waiting-develop', text: outcome.notes.join(' ') }); setNotice(outcome.notes.join(' ')); });
          return;
        }
        ctx.setLocation(outcome.runner === 'cloud-processing' ? 'cloud' : 'local');
        const valid = (current: PhotoFrame) => sameRecipe(current.edit ?? DEFAULT_EDIT, frame.edit ?? DEFAULT_EDIT) &&
          framingKey(current.framing) === framingKey(frame.framing);
        const latest = stateRef.current?.frames.find(candidate => candidate.id === photoId);
        if (!latest || !valid(latest)) {
          ctx.commitIfCurrent(() => setNotice(engineText.workspace.denoisePhotoChanged));
          return;
        }
        if (outcome.verified) {
          ctx.stage(engineText.workspace.denoiseApplyStage);
          ctx.commitIfCurrent(() => editFrames([photoId], current => {
            if (!valid(current)) return current.edit;
            const edit = current.edit ?? DEFAULT_EDIT;
            const id = `auto-denoise-${photoId}`;
            const next = composeDenoiseRecipe(edit, id, outcome.strength, outcome.masks, outcome.strength > 0 ? outcome.luminance / outcome.strength : 0);
            return outcome.trueDetailAi ? { ...next, trueDetailAi: outcome.trueDetailAi } : next;
          }));
        }
        // A main-thread fallback is always said, even on success, so a pause is never unexplained.
        ctx.commitIfCurrent(() => {
          // A photo with no visible noise keeps its answer in the panel, with "Denoise anyway" beside it.
          if (outcome.noVisibleNoise) sayDenoise(photoId, { state: 'no-visible-noise', text: outcome.notes.filter(Boolean).join(' ') });
          setNotice(outcome.verified
            ? [outcome.anywayNote, outcome.notes[0], ...outcome.notes.slice(1).filter(note => note === MAIN_THREAD_DENOISE_NOTE)].filter(Boolean).join(' ')
            : engineText.denoise.leftAsItWas(outcome.notes.filter(Boolean).join(' ')));
        });
      },
    }).then(ticket => ticket.finished).then(result => {
      if (result === 'failed') setNotice(engineText.workspace.denoiseFailed);
    }).catch(reason => setNotice(reason instanceof Error ? reason.message : engineText.workspace.denoiseNotQueued))
      .finally(() => { denoiseInFlight.current.delete(photoId); });
  }, [can, editFrames, sayDenoise]);

  // Cloud edit settings (x-std-cloud-recipe), a preview that is off by default. Preparing shows what would be sent and
  // its size and sends nothing; the person's press of Send is the consent for that one upload. The settings that come
  // back are applied as one undoable step, and only if the photo's edit has not changed since the offer was made.
  const cloudRecipeOn = can('cloudRecipe') || cloudRecipePreviewOn();
  // Culling Assistant rules (x-std-cull-rules, a preview that is off by default): every judged photo ranked again from
  // its stored observations on each movement of a slider, with no new scan. The judgement is worked out once per
  // catalogue change; the rules themselves are cheap. Applying only ever keeps, as one step that Undo takes back.
  const cullRulesOn = can('cullRules') || workflowPreviewOn('cullRules');
  const brandKitsOn = can('brandKits') || workflowPreviewOn('brandKits');
  const judgedCache = useRef<{ frames: PhotoFrame[]; originals: PhotoFrame[]; results: CullSuggestion[]; notScanned: number } | null>(null);
  const judgedNow = useCallback(() => {
    const current = stateRef.current;
    if (!current) return null;
    if (judgedCache.current?.frames !== current.frames) {
      const originals = current.frames.filter(isCullOriginal);
      const { results, missing } = rescoreFromObservations(originals, DETECTOR_MODEL.sha256, Boolean(bundledModelUrl(DETECTOR_MODEL.file)));
      judgedCache.current = { frames: current.frames, originals, results, notScanned: missing.length };
    }
    return judgedCache.current;
  }, []);
  const rankCulling = useCallback((rules: CullRules) => {
    const judged = judgedNow();
    if (!judged) return { rows: [], notScanned: 0, newKeepers: 0 };
    const ranked = rankWithRules(judged.originals, judged.results, rules);
    const names = new Map(judged.originals.map((frame) => [frame.id, frame.filename]));
    return {
      rows: ranked.map((row) => ({ photoId: row.frameId, filename: names.get(row.frameId) ?? '', score: Math.round(row.score), outcome: row.outcome, why: row.why, burst: row.burstId })),
      notScanned: judged.notScanned, newKeepers: proposedKeepers(ranked).length,
    };
  }, [judgedNow]);
  const applyCullRulesFor = useCallback((rules: CullRules) => {
    const judged = judgedNow();
    if (!judged) return 0;
    const ranked = rankWithRules(judged.originals, judged.results, rules);
    const count = proposedKeepers(ranked).length;
    if (count) mutate((current) => applyCullRules(current, ranked));
    return count;
  }, [judgedNow, mutate]);
  const cloudRecipeOffers = useRef(new Map<string, { prepared: Awaited<ReturnType<typeof prepareCloudRecipe>>; edit: PhotoEdit; framing: string }>());
  const prepareCloudRecipeFor = useCallback(async (photoId: string) => {
    const frame = stateRef.current?.frames.find(candidate => candidate.id === photoId && candidate.removedAt == null);
    if (!frame || !provider.current) return { status: 'unavailable' as const, message: 'This photo is not available.' };
    const source = provider.current;
    // Web, phones and JPEG photos have no 2,560 px smart preview: a copy of the photo's preview stands in, made in memory.
    const prepared = await prepareCloudRecipe(frame, {
      smartPreview: (f) => source.smartPreview(f),
      ensureOriginal: (key, priority) => source.ensureOriginal(key, priority),
      previewCopy: async (f) => { const blob = await previewBlobFromUrl(await source.getFullPreviewUrl(f, 'visible')); return blob ? previewCopyForCloud(blob) : null; },
    }, readFullFileConsent());
    cloudRecipeOffers.current.set(photoId, { prepared, edit: frame.edit ?? DEFAULT_EDIT, framing: framingKey(frame.framing) });
    const offer: CloudRecipeOffer = prepared.offer;
    if (offer.plan.status !== 'ready') {
      return { status: 'unavailable' as const, message: 'This photo has no preview InFlight can send yet. Wait for it to finish loading, then try again. Nothing was sent.' };
    }
    const previewNote = offer.previewSource === 'copy' && isRawPreviewFile(frame.filename)
      ? "This is a copy of the preview the camera saved inside the RAW, not InFlight's own develop, so the settings may need a small touch-up."
      : undefined;
    return { status: 'ready' as const, sendLabel: offer.sendLabel, alternativeLabel: offer.alternativeLabel, ...(previewNote ? { previewNote } : {}) };
  }, []);
  const sendCloudRecipeFor = useCallback(async (photoId: string, choice: 'send' | 'alternative', inBatch = false) => {
    const cloudText = v2Text.cloudResult;
    const held = cloudRecipeOffers.current.get(photoId);
    cloudRecipeOffers.current.delete(photoId);
    if (!held) throw new Error('Check the photo again before sending.');
    if (readCloudConsent().answer !== 'yes') throw new Error("Say yes to using InFlight's cloud first. Nothing was sent.");
    const connection = accountConnection();
    if (!connection) throw new Error('Sign in to use cloud edit settings. Nothing was sent.');
    if (navigator.onLine === false) throw new Error('You are offline. Nothing was sent.');
    // One row in Tasks for the job (Dave, 27 Nov: he could not tell the cloud had been used): how long it took and
    // whether the cloud confirmed its copy was deleted.
    const startedAt = performance.now();
    // A project's Cloud edits run has its own single row for all its photos.
    const row = inBatch ? null : tasks.start(cloudText.taskTitle, { kind: 'cloud', location: 'cloud' });
    let outcome: Awaited<ReturnType<typeof sendCloudRecipe>>;
    try {
      outcome = await sendCloudRecipe(held.prepared, choice, readFullFileConsent(), httpCloudRecipeService(connection));
    } catch (error) {
      row?.fail(error instanceof Error ? error.message : cloudText.taskFailed);
      throw error;
    }
    const seconds = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
    const copy = outcome.inputDeleted ? cloudText.copyDeleted : cloudText.copyNotConfirmed;
    const finish = (said: string) => { row?.finish(cloudText.taskDone(seconds, said, copy)); };
    const copyDeleted = outcome.inputDeleted === true;
    if (outcome.status === 'refused') { finish(cloudText.refusedShort); return { message: 'The cloud sent back settings this device could not check, so nothing was changed.', copyDeleted }; }
    if (outcome.status === 'empty') { finish(cloudText.noChangesShort); return { message: 'The cloud suggested no changes for this photo.', copyDeleted }; }
    const unchanged = (current: PhotoFrame) => sameRecipe(current.edit ?? DEFAULT_EDIT, held.edit) && framingKey(current.framing) === held.framing;
    const latest = stateRef.current?.frames.find(candidate => candidate.id === photoId);
    if (!latest || !unchanged(latest)) { finish(cloudText.notAppliedShort); return { message: 'The photo was edited while the cloud worked, so its settings were not applied.', copyDeleted }; }
    const changes = cloudRecipeChanges(editToRecipe(held.edit), outcome.recipe.settings, v2Text.history.sliders);
    if (!changes.lines.length) { finish(cloudText.noChangesShort); return { message: 'The cloud suggested no changes for this photo.', copyDeleted }; }
    editFrames([photoId], current => (unchanged(current) ? cloudRecipeEdit(current.edit, outcome.recipe) : current.edit), cloudRecipeWhy(outcome.recipe, outcome.sent, outcome.previewSource));
    finish(cloudText.appliedShort(changes.lines.length));
    return { message: 'Applied the cloud\'s edit settings. Undo takes them back.', changes: changes.lines, before: changes.before, copyDeleted };
  }, [editFrames]);

  // Cloud edits for the whole project (Dave, 27 Nov): the project says which photos (Nothing, Best only, Top 50, All),
  // and one run does them one after another under a single row in Tasks. A photo is sent once: what a run has sent is
  // kept with the project. A photo the person has already edited is left alone, and so is one edited while the cloud worked.
  const cloudEditsChoice = parseCloudEditsChoice(state?.shoot.cloudEdits);
  // The month's numbers, handed down by the screen that reads them. When known, a run is cut to what the allowance has
  // left, best photos first; when not known, nothing is trimmed.
  const [cloudUsageHint, setCloudUsageHint] = useState<CloudUsage | undefined>(undefined);
  const cloudEditsPlan = useMemo(() => {
    const covered = state ? cloudEditsPhotos(cloudEditsChoice, state.frames.filter(isCullOriginal), cloudUsageHint) : [];
    const done = new Set(state?.shoot.cloudEditsDone ?? []);
    const untouched = new Set((state?.frames ?? []).filter((frame) => sameRecipe(frame.edit ?? DEFAULT_EDIT, DEFAULT_EDIT)).map((frame) => frame.id));
    return { covered, toDo: covered.filter((id) => !done.has(id) && untouched.has(id)) };
  }, [state, cloudEditsChoice, cloudUsageHint]);
  const cloudEditsPlanRef = useRef(cloudEditsPlan);
  cloudEditsPlanRef.current = cloudEditsPlan;
  const [cloudEditsRunning, setCloudEditsRunning] = useState(false);
  const cloudEditsBusy = useRef(false);
  const runCloudEditsFor = useCallback(async (): Promise<string> => {
    const cloudText = v2Text.cloudResult;
    if (cloudEditsBusy.current) return cloudText.batchAlready;
    const ids = [...cloudEditsPlanRef.current.toDo];
    if (!ids.length) return cloudText.batchNothing;
    if (readCloudConsent().answer !== 'yes') throw new Error("Say yes to using InFlight's cloud first. Nothing was sent.");
    if (!accountConnection()) throw new Error('Sign in to use Cloud edits. Nothing was sent.');
    if (navigator.onLine === false) throw new Error('You are offline. Nothing was sent.');
    cloudEditsBusy.current = true;
    setCloudEditsRunning(true);
    const stop = new AbortController();
    const row = tasks.start(cloudText.batchTitle, { total: ids.length, kind: 'cloud', location: 'cloud', priority: 1, cancel: () => stop.abort() });
    let applied = 0, sent = 0, notConfirmed = 0, failures = 0;
    const sentIds: string[] = [];
    const keep = () => { if (sentIds.length) mutate((current) => ({ ...current, shoot: { ...current.shoot, cloudEditsDone: [...new Set([...(current.shoot.cloudEditsDone ?? []), ...sentIds])] } })); };
    try {
      for (let index = 0; index < ids.length; index += 1) {
        if (stop.signal.aborted) break;
        const photoId = ids[index];
        try {
          const offer = await prepareCloudRecipeFor(photoId);
          if (offer.status === 'ready' && !stop.signal.aborted) {
            const result = await sendCloudRecipeFor(photoId, 'send', true);
            sent += 1;
            sentIds.push(photoId);
            if (result.changes?.length) applied += 1;
            if (!result.copyDeleted) notConfirmed += 1;
          }
          failures = 0;
        } catch (error) {
          // Out of allowance, signed out or offline: stop here and say so. Nothing more is sent.
          const stopNow = (error instanceof CloudJobError && error.problem.topUp) || !navigator.onLine || !accountConnection();
          failures += 1;
          if (stopNow || failures >= 3) {
            keep();
            const why = error instanceof Error ? error.message : cloudText.taskFailed;
            row.fail(cloudText.batchStopped(sent, ids.length, why));
            throw error instanceof Error ? error : new Error(why);
          }
        }
        row.progress(index + 1, ids.length, cloudText.batchProgress(index + 1, ids.length));
      }
      keep();
      const copies = sent === 0 ? '' : notConfirmed === 0 ? cloudText.copiesDeleted : cloudText.copiesNotConfirmed(notConfirmed);
      const said = cloudText.batchDone(sent, ids.length, applied, copies);
      row.finish(said);
      return said;
    } finally {
      cloudEditsBusy.current = false;
      setCloudEditsRunning(false);
    }
  }, [mutate, prepareCloudRecipeFor, sendCloudRecipeFor]);

  // Personal editing style (x-spec-personal-style, on by default; an admin flag can switch it off): when Auto's edit is applied, the
  // photo is remembered; when the person moves on, what they kept, undid or corrected is learnt on this device only.
  // Auto leans only after enough consistent examples (src/core/editStyle.ts). Nothing is ever sent anywhere.
  const editStyleOn = can('editStyle') || workflowPreviewOn('editStyle');
  const pendingStyle = useRef(new Map<string, { base: PhotoEdit; applied: PhotoEdit; multipliers: Partial<Record<StyleKey, number>> }>());
  const noteAutoApplied = useCallback((frameId: string, run: AutoRun, applied: PhotoEdit) => {
    if (!editStyleOn) return;
    pendingStyle.current.set(frameId, { base: run.plan.base, applied, multipliers: Object.fromEntries((run.leanings ?? []).map((leaning) => [leaning.key, leaning.multiplier])) });
  }, [editStyleOn]);
  const settleStyle = useCallback((frameId: string) => {
    const pending = pendingStyle.current.get(frameId);
    if (!pending) return;
    pendingStyle.current.delete(frameId);
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === frameId);
    if (!frame || frame.removedAt != null) return;
    saveEditStyle(recordOutcome(loadEditStyle(), { ...pending, final: frame.edit ?? DEFAULT_EDIT, at: Date.now() }));
  }, []);
  const styleWatch = useRef<string | null>(null);
  useEffect(() => {
    const previous = styleWatch.current;
    const current = screen === 'editor' ? activeFrame?.id ?? null : null;
    styleWatch.current = current;
    if (previous && previous !== current) settleStyle(previous);
  }, [screen, activeFrame?.id, settleStyle]);
  const forgetEditStyle = useCallback(() => {
    resetEditStyle();
    pendingStyle.current.clear();
    setNotice('InFlight has forgotten your editing style. Auto\'s suggestions are its own again.');
  }, []);

  const applyAuto = useCallback((frameId: string, candidateId?: string) => {
    const assist = assists[frameId];
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === frameId);
    if (!assist || !frame) return;
    const candidate = candidateId ? assist.run.candidates.find((item) => item.id === candidateId) : assist.run.candidates[0];
    if (!candidate || assist.dismissed.includes(candidate.id)) return;
    const valid = (latest: PhotoFrame) => matchesAutoSource(assist.run, latest) && sameRecipe(latest.edit ?? DEFAULT_EDIT, assist.run.plan.base);
    if (!valid(frame)) { setNotice(engineText.workspace.suggestionStale); return; }
    editFrames([frameId], (latest) => valid(latest) ? candidate.edit : latest.edit, { by: 'auto', notes: assist.run.detail });
    noteAutoApplied(frameId, assist.run, candidate.edit);
  }, [assists, editFrames, noteAutoApplied]);

  // First run: once Auto has looked at the first photo, apply its suggestion (one undoable step), or say plainly that
  // the photo already looked natural and was left alone. The vision guardian's second opinion comes first: a clear "no"
  // leaves the photo unchanged and the suggestion in Co-pilot for the person to decide.
  useEffect(() => {
    if (!quickStart || quickStart.phase !== 'working' || !quickStart.photoId) return;
    const assist = assists[quickStart.photoId];
    if (!assist) return;
    const first = assist.run.improved ? assist.run.candidates[0] : undefined;
    if (first && !guardianSettled(assist.guardian, first.id)) return;
    const held = Boolean(first && guardianHolds(assist.guardian, first.id));
    if (first && !held) applyAuto(quickStart.photoId);
    setQuickStart({ ...quickStart, phase: !first ? 'unchanged' : held ? 'held' : 'ready' });
  }, [assists, quickStart, applyAuto]);
  useEffect(() => {
    if (!quickStart || quickStart.phase !== 'working' || !quickStart.photoId) return;
    // Auto normally answers in a few seconds; if it cannot check the photo, say so instead of waiting forever.
    const timer = window.setTimeout(() => setQuickStart((current) => current === quickStart ? { ...current, phase: 'failed' } : current), 45_000);
    return () => window.clearTimeout(timer);
  }, [quickStart]);

  // Co-pilot and Auto-pilot look at the photo on the canvas, on this device, one at a time. Solo never does.
  // Each project keeps its own Flight mode; an older project without one follows Settings' default.
  const assistMode = state?.shoot.assistMode ?? savedUi.settings.defaultAssistMode ?? savedUi.assistMode ?? stub.store.assistMode;
  // Read by importPhotos (a stable callback) when an import finishes: start, offer or explain Auto-cull.
  const afterImport = useRef({ mode: assistMode, canCull: can('smartCulling'), run: runAutoCull });
  afterImport.current = { mode: assistMode, canCull: can('smartCulling'), run: runAutoCull };
  // Auto-pilot means automatic: with the project's choice made and the one-time yes given, the run starts by itself once
  // importing and Auto pick are quiet (Best and Top 50 follow Auto pick's ranking, so it waits for that). A run that
  // stopped (allowance used up, offline) is not started again by itself in this session; the button still works.
  // First use on a paying plan: switch on the account's standing consent once, say plainly what is sent, and never
  // swallow a failure. An explicit No on this device is left alone.
  const paidConsentTried = useRef(false);
  useEffect(() => {
    if (!cloudRecipeOn || paidConsentTried.current || !hasPaidPlan() || !accountConnection()) return;
    if (readStoredConsent().answer === 'no') return;
    let agreed = false;
    try { agreed = localStorage.getItem('kestrel.cloudAiAgreed.v1') === '1'; } catch { /* unreadable: ask the server again */ }
    paidConsentTried.current = true;
    if (agreed) return;
    agreeManagedAi().then(() => {
      try { localStorage.setItem('kestrel.cloudAiAgreed.v1', '1'); } catch { /* shown again next launch, harmless */ }
      setNotice(v2Text.cloudEdits.autoOn);
    }).catch(() => setNotice(v2Text.cloudEdits.agreeFailed));
  });
  const cloudEditsAutoBlocked = useRef(new Set<string>());
  const projectKey = state?.shoot.id ?? '';
  const backgroundBusy = taskList.some((task) => (task.kind === 'import' || task.kind === 'cull') && (task.state === 'running' || task.state === 'queued' || task.state === 'paused'));
  useEffect(() => {
    if (!cloudRecipeOn || screen !== 'editor' || assistMode !== 'autopilot' || !projectKey || backgroundBusy || cloudEditsRunning) return;
    if (!cloudEditsPlan.toDo.length || cloudEditsAutoBlocked.current.has(projectKey)) return;
    if (readCloudConsent().answer !== 'yes' || !accountConnection() || navigator.onLine === false) return;
    const timer = window.setTimeout(() => {
      void runCloudEditsFor().catch((error) => {
        cloudEditsAutoBlocked.current.add(projectKey);
        setNotice(error instanceof Error ? error.message : v2Text.cloudResult.taskFailed);
      });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [cloudRecipeOn, screen, assistMode, projectKey, backgroundBusy, cloudEditsRunning, cloudEditsPlan.toDo.length, runCloudEditsFor]);
  const assistProjectId = state?.shoot.id;
  const ongoingLocalReview = savedUi.settings.ongoingCritique ?? stub.store.settings.ongoingCritique;
  // Photos Auto-pilot already told the person it left alone (edited elsewhere), so the notice is said once each.
  const editedElsewhereNoticed = useRef(new Set<string>());
  useEffect(() => {
    if (screen !== 'editor' || !assistProjectId || !activeFrame || activeFrame.removedAt != null) return;
    const frame = activeFrame;
    const manual = autoRequest?.photoId === frame.id && autoRequest.sequence > lastAutoRequest.current;
    if (!manual && assistMode === 'solo') return;
    const previous = assists[frame.id];
    if (!manual && previous && matchesAutoSource(previous.run, frame) &&
        (sameRecipe(previous.run.plan.base, frame.edit ?? DEFAULT_EDIT) ||
         previous.run.candidates.some((candidate) => candidate.edit === frame.edit))) return;
    if (!manual && previous && !ongoingLocalReview) return;
    const request = openRequest.current;
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && request === openRequest.current;
    const timer = window.setTimeout(() => {
      if (!isCurrent()) return;
      if (manual) lastAutoRequest.current = autoRequest.sequence;
      void engineScheduler.submit({
        title: engineText.workspace.checkTask(frame.filename),
        kind: 'auto-edit', resource: 'cpu', priority: manual ? 20 : 8, pauseable: false,
        // The automatic checks share one row per project; one the person asked for keeps its own.
        ...(manual ? {} : { group: { key: `checks:${assistProjectId}`, title: engineText.workspace.checksGroup } }),
        items: [{ id: frame.id, name: frame.filename }],
        snapshot: { projectId: assistProjectId, frameId: frame.id, edit: frame.edit ?? DEFAULT_EDIT },
        itemId: item => item.id, itemLabel: item => item.name,
        runItem: async (_, __, ctx) => {
          ctx.stage(engineText.workspace.checkStage);
          const run = await runAuto(frame, provider.current!, ctx.signal, editStyleOn ? learnedLeanings(loadEditStyle()) : []);
          ctx.checkCancelled();
          if (!isCurrent()) return;
          if (!run) return;
          const applyNow = manual && autoApplyWanted.current.delete(frame.id);
          if (isAutoUnavailable(run)) {
            // Say why in Co-pilot (and, for a press of the button, as a notice) instead of finishing silently.
            ctx.commitIfCurrent(() => {
              setAutoUnavailable(current => ({ ...current, [frame.id]: run }));
              sayAuto(frame.id, 'unavailable', autoUnavailableSentence(run.unavailable, frame.filename));
              if (manual) setNotice(autoUnavailableSentence(run.unavailable, frame.filename));
            });
            return;
          }
          ctx.commitIfCurrent(() => setAutoUnavailable(current => {
            if (!(frame.id in current)) return current;
            const { [frame.id]: _cleared, ...rest } = current;
            return rest;
          }));
          // Vision AI is the guardian: a second opinion on every suggestion Auto rendered (assistGuardian.ts). Auto's own
          // pick is asked first, because Auto-pilot and the quick start wait on it. It advises only: a clear "no" holds an
          // automatic apply and adds a line to that suggestion; it never changes or removes a suggestion.
          const order = guardianOrder(run.candidates, run.plan.proposal);
          ctx.commitIfCurrent(() => setAssists(current => {
            if (!isCurrent()) return current;
            const recent = Object.entries(current).filter(([id]) => id !== frame.id).slice(-11);
            return { ...Object.fromEntries(recent), [frame.id]: { run, dismissed: [], guardian: startGuardian(order, hasLocalVision()) } };
          }));
          const skipEdited = !manual && assistMode === 'autopilot' && run.improved && autopilotSkipsEditedElsewhere(frame);
          if (skipEdited && !editedElsewhereNoticed.current.has(frame.id)) {
            editedElsewhereNoticed.current.add(frame.id);
            ctx.commitIfCurrent(() => setNotice(autopilotSkippedEdited()));
          }
          // Applying is wanted by the Auto button, or by Auto-pilot for a photo opened unedited.
          const wantsApply = applyNow || (!manual && assistMode === 'autopilot');
          if (skipEdited) ctx.commitIfCurrent(() => sayAuto(frame.id, 'unchanged', autopilotSkippedEdited()));
          // Never silently nothing: when the checks leave the photo alone, the one-line reason is said.
          else if (wantsApply && !run.improved) ctx.commitIfCurrent(() => sayAuto(frame.id, 'unchanged', run.headline));
          const autopilot = wantsApply && run.improved && !skipEdited;
          let piloted = false;
          const pilot = (held: boolean) => {
            piloted = true;
            if (held) { ctx.commitIfCurrent(() => { setNotice(autopilotHeldForReview()); sayAuto(frame.id, 'unchanged', autopilotHeldForReview()); }); return; }
            const at = Date.now();
            const what = run.candidates.find((candidate) => candidate.edit === run.plan.proposal)?.summary;
            ctx.commitIfCurrent(() => { if (isCurrent() && !ctx.signal.aborted) sayAuto(frame.id, 'applied', what || run.headline); });
            ctx.commitIfCurrent(() => mutate(current =>
              isCurrent() && !ctx.signal.aborted
                ? commitAutoEdit(current, assistProjectId, frame, run.plan.proposal, at, { by: 'auto', notes: run.detail }) : current));
            ctx.commitIfCurrent(() => { if (isCurrent() && !ctx.signal.aborted) noteAutoApplied(frame.id, run, run.plan.proposal); });
          };
          // The Auto button is the person's own decision: it applies at once, without waiting for the second opinion.
          if (applyNow && autopilot) pilot(false);
          for (const candidate of hasLocalVision() ? order : []) {
            ctx.stage(engineText.workspace.secondOpinionStage);
            const opinion = await askOnDeviceGuardian(candidate.after, 'editNatural');
            ctx.checkCancelled();
            if (!isCurrent()) return;
            ctx.commitIfCurrent(() => setAssists(current => {
              const assist = current[frame.id];
              if (!assist || assist.run !== run || !assist.guardian) return current;
              return { ...current, [frame.id]: { ...assist, guardian: withOpinion(assist.guardian, candidate.id, opinion) } };
            }));
            if (autopilot && !piloted && candidate.edit === run.plan.proposal) {
              pilot(guardResult('apply', opinion ? [opinion] : []).status !== 'apply');
            }
          }
          if (autopilot && !piloted) pilot(false);
        },
      }).then(ticket => {
        controller.signal.addEventListener('abort', () => ticket.cancel(), { once: true });
        if (controller.signal.aborted) ticket.cancel();
        return ticket.finished;
      }).then(result => {
        // A thrown RAW or decode error used to end here unseen (and its text talked about exporting).
        if (result !== 'failed' || !isCurrent()) return;
        setAutoUnavailable(current => ({ ...current, [frame.id]: { unavailable: 'failed', source: { stableKey: frame.stableKey, originalSha256: frame.originalSha256, framing: frame.framing } } }));
        sayAuto(frame.id, 'unavailable', autoUnavailableSentence('failed', frame.filename));
        if (manual) setNotice(autoUnavailableSentence('failed', frame.filename));
      }).catch(() => {
        if (isCurrent()) setNotice(engineText.workspace.checkFailed);
      });
    }, manual ? 0 : 550);
    return () => {
      window.clearTimeout(timer);
      // The abort cancels this check's own job through its ticket (never the shared row, which other checks are in).
      controller.abort();
    };
    // Recheck a settled recipe, source or framing change without rerunning a completed matching analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, assistMode, assistProjectId, activeFrame?.id, activeFrame?.edit, activeFrame?.framing,
    activeFrame?.stableKey, activeFrame?.originalSha256, activeFrame?.removedAt, ongoingLocalReview, autoRequest, mutate]);

  // The person asked for this (Co-pilot/Assist "deep review" or refresh button); it is not the automatic
  // per-photo pass above. Wired to the real engine (src/engine/subjectDetectAction.ts, lookSuggestions.ts)
  // via deepVisionReview.ts. Result is shown as a plain-text notice for now, not yet an AssistSuggestion.
  const deepVisionInFlight = useRef(new Set<string>());
  const [reviewingIds, setReviewingIds] = useState<string[]>([]);
  const failedBecause = useRef(new Map<string, string>());
  const runDeepVisionReviewAction = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame || deepVisionInFlight.current.has(photoId)) return;
    deepVisionInFlight.current.add(photoId);
    setReviewingIds((current) => [...current, photoId]);
    void engineScheduler.submit({
      title: engineText.workspace.deepTask,
      kind: 'vision', resource: 'gpu', priority: 15, pauseable: false, interactive: true,
      items: [{ id: photoId, name: frame.filename }],
      snapshot: { frameId: frame.id, stableKey: frame.stableKey },
      itemId: item => item.id, itemLabel: item => item.name,
      runItem: async (_, __, ctx) => {
        ctx.stage(engineText.workspace.deepStage);
        // The batch's own signal: the subject finder then runs inside this task, not queued behind it.
        let result: Awaited<ReturnType<typeof runDeepVisionReview>>;
        try {
          result = await runDeepVisionReview(frame, provider.current!, ctx.signal);
        } catch (error) {
          // Say why (the subject finder not installed, say), not only that it failed.
          if (!ctx.signal.aborted) failedBecause.current.set(photoId, deepReviewFailure(error, engineText.workspace.deepFailed));
          throw error;
        }
        ctx.checkCancelled();
        if (!result) throw new Error(engineText.workspace.deepNoResult);
        // The review is advisory. Do not publish stale observations after
        // deletion, a project switch or a source relink.
        const current = stateRef.current?.frames.find(item => item.id === photoId);
        if (current?.stableKey !== frame.stableKey || current?.removedAt != null) return;
        ctx.commitIfCurrent(() => setNotice(result.summary));
      },
    }).then(ticket => ticket.finished).then(result => {
      if (result === 'failed') setNotice(failedBecause.current.get(photoId) ?? engineText.workspace.deepFailed);
    }).catch(error => setNotice(error instanceof Error ? error.message : engineText.workspace.deepNotQueued))
      .finally(() => {
        failedBecause.current.delete(photoId);
        deepVisionInFlight.current.delete(photoId);
        setReviewingIds(current => current.filter(id => id !== photoId));
      });
  }, []);

  // Bring your own AI: a second opinion on colour and light from the person's own key or a model on this computer.
  // Advisory only. The answer is kept for one photo; Apply is one undoable edit, refused if the photo changed since.
  // A saved InFlight online helper is not used while it is not available to this account (invite-only, switch on, online).
  const aiSettings = useUsableAiSettings();
  const [aiOpinion, setAiOpinion] = useState<AiOpinionRecord | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const cancelAiOpinion = useCallback(() => {
    aiAbort.current?.abort();
    aiAbort.current = null;
    setAiOpinion((current) => (current?.phase === 'asking' ? null : current));
  }, []);
  const askAiOpinion = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!frame || !aiSettings || !provider.current || aiAbort.current) return;
    const controller = new AbortController();
    aiAbort.current = controller;
    const base = frame.edit ?? DEFAULT_EDIT;
    const record: AiOpinionRecord = { photoId, base, stableKey: frame.stableKey, phase: 'asking' };
    setAiOpinion(record);
    const findings = (assists[photoId]?.run.detail ?? []).slice(0, 4);
    void askAiSecondOpinion(frame, provider.current, aiSettings, languageOption(language).englishName, findings, controller.signal)
      .then(({ review, targets }) => {
        if (controller.signal.aborted) return;
        setAiOpinion((current) => (current === record ? { ...record, phase: 'ready', review, targets } : current));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setAiOpinion((current) => (current === record ? { ...record, phase: 'failed', message: errorWords(error) } : current));
      })
      .finally(() => { if (aiAbort.current === controller) aiAbort.current = null; });
  }, [aiSettings, assists]);
  const applyAiOpinion = useCallback((photoId: string) => {
    const record = aiOpinion;
    const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
    if (!record || record.photoId !== photoId || record.phase !== 'ready' || !record.targets || !frame) return;
    const valid = (latest: PhotoFrame) => latest.stableKey === record.stableKey && sameRecipe(latest.edit ?? DEFAULT_EDIT, record.base);
    if (!valid(frame)) { setNotice(engineText.workspace.suggestionStale); setAiOpinion(null); return; }
    editFrames([photoId], (latest) => (valid(latest) ? applyTargets(latest.edit ?? DEFAULT_EDIT, record.targets!) : latest.edit));
    setAiOpinion({ ...record, phase: 'applied' });
  }, [aiOpinion, editFrames]);
  const agreeAiOpinion = useCallback(() => {
    if (!aiSettings) return;
    saveAiSettings({ ...aiSettings, consent: consentFor(AI_REVIEW_CONSENT_VERSION, aiSettings) });
    // InFlight's own AI also needs the account's standing Gemini consent on the server; this press is that choice.
    if (aiSettings.kind === 'inflight') void agreeManagedAi().catch(() => setNotice(v2Text.cloudEdits.agreeFailed));
  }, [aiSettings]);
  // A different provider or photo never leaves an old answer on screen.
  useEffect(() => { aiAbort.current?.abort(); aiAbort.current = null; setAiOpinion(null); }, [aiSettings]);

  // Suggestions an AI assistant left through the MCP tool, beside this project's backups. Read when a project opens and
  // every minute while it is open; shown in Co-pilot; nothing changes until the person presses Apply.
  const [proposals, setProposals] = useState<FoundProposal[]>([]);
  const handledProposals = useRef(new Set<string>());
  const proposalProjectId = state?.shoot.id;
  useEffect(() => {
    setProposals([]);
    if (!proposalProjectId) return;
    let live = true;
    const look = () => {
      const current = stateRef.current;
      if (!current || current.shoot.id !== proposalProjectId || current.shoot.collage) return;
      void findProposals(current).then((found) => {
        if (live) setProposals(found.filter((item) => !handledProposals.current.has(`${proposalProjectId}/${item.proposal.name}`)));
      }).catch(() => undefined);
    };
    const first = window.setTimeout(look, 2000);
    const timer = window.setInterval(look, 60_000);
    return () => { live = false; window.clearTimeout(first); window.clearInterval(timer); };
  }, [proposalProjectId]);
  const closeProposal = useCallback((name: string) => {
    const found = proposals.find((item) => item.proposal.name === name);
    if (!found || !proposalProjectId) return null;
    handledProposals.current.add(`${proposalProjectId}/${name}`);
    setProposals((current) => current.filter((item) => item !== found));
    void forgetProposal(found);
    return found;
  }, [proposals, proposalProjectId]);
  const applyProposal = useCallback((name: string) => {
    const found = proposals.find((item) => item.proposal.name === name);
    const current = stateRef.current;
    if (!found || !current) return;
    const matched = matchProposal(current.frames, found.proposal);
    closeProposal(name);
    if (!matched.length) { setNotice(aiReviewText.assistant.noneLeft); return; }
    const at = Date.now();
    mutate((latest) => {
      const fresh = matchProposal(latest.frames, found.proposal);
      let next = { ...latest, frames: withProposalMarks(latest.frames, fresh), shoot: { ...latest.shoot, lastUpdatedAt: at } };
      for (const item of fresh) if (item.decision) next = applyDecisionWithHistory(next, item.frameId, item.decision, { allowAdvance: false });
      return next;
    });
    setNotice(aiReviewText.assistant.applied(matched.length));
  }, [proposals, closeProposal, mutate]);
  const proposalView = useMemo(() => {
    const first = proposals[0];
    if (!first || !state) return undefined;
    const t = aiReviewText.assistant;
    const matched = matchProposal(state.frames, first.proposal);
    const when = (() => { try { return new Date(first.proposal.createdAt).toLocaleString(); } catch { return first.proposal.createdAt; } })();
    return {
      name: first.proposal.name,
      intro: t.intro(matched.length, when),
      lines: matched.slice(0, 8).map((item) => ({
        photo: item.filename,
        change: [item.decision ? t[item.decision] : null, item.rating !== undefined ? t.stars(item.rating) : null, item.addTags?.length ? t.tags(item.addTags.join(', ')) : null].filter(Boolean).join(', '),
        reason: item.reason,
      })),
      more: matched.length > 8 ? t.more(matched.length - 8) : undefined,
    };
  }, [proposals, state]);

  const cloudImports = useRef(new Map<string, { projectId: string; photoKey: string }>());
  const externalReturns = useRef(new Map<string, ExternalEditRecord>());
  const importPhotos = useCallback(async (suppliedPicks?: Array<File | PickedPhoto> | null,
    /** Fields to add to a photo as it is read (a focus stack's, panorama's or HDR merge's recipe), by its picked key. */
    attach?: (key: string) => Partial<PhotoFrame> | undefined,
    /** A frame from a watched folder during a live shoot: no notices for each arrival, and it never waits for a picker. */
    live = false): Promise<boolean> => {
    const target = stateRef.current;
    if (!target) return false;
    if (importController.current) { if (!live) setNotice(engineText.workspace.importRunning); return false; }
    const picks = suppliedPicks === undefined ? await pickFiles() : suppliedPicks;
    if (!picks?.length) return false;
    const files = picks.map((pick) => (pick instanceof File ? pickedFromFile(pick) : pick));
    const existing = new Set(target.frames.filter((frame) => !frame.removedAt).map((frame) => frame.stableKey));
    const additions = files.filter((file) => { const key = pickedKey(file); if (existing.has(key)) return false; existing.add(key); return true; });
    if (!additions.length) { if (!live) setNotice(engineText.workspace.importNothingNew); return true; }
    const projectKey = target.shoot.id;
    const controller = new AbortController();
    importController.current = controller;
    setImporting(true);
    const importId = newId().slice(0, 8);
    const sequenceBase = target.frames.reduce((max, frame) => Math.max(max, frame.sequenceIndex), 0);
    const importedFrames: PhotoFrame[] = [];
    let initialImportFinished = false;
    const warnings: string[] = [];
    // The provider of whichever project is on screen when each photo is read, never the one of the moment the import
    // started: leaving and reopening the project replaces (and clears) that one, which lost originals and previews.
    const sourceProvider = new Proxy({} as BrowserPreviewProvider, {
      get: (_, name) => {
        const current = provider.current! as unknown as Record<PropertyKey, unknown>;
        const value = current[name];
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(current) : value;
      },
    });
    const sourceCatalogue = catalogue.current!;
    const handoff = importHandoff.current!;
    const importBatch = (frames: PhotoFrame[], bursts?: PhotoFrame[]): ImportBatch => ({ importId, sequenceBase, frames, ...(bursts ? { bursts } : {}) });
    const pendingNames = new Map(additions.map((file) => [pickedKey(file), file.name]));
    recordPendingImport(projectKey, [...pendingNames.values()], true);
    importingInto.current = projectKey;
    // Rated photos are read first (ratings from XMP sidecars, read only), in groups so the project is updated once per
    // group. Only the reading order changes: each photo keeps its picked-list position, which gives its id and capture-order
    // sequence number, and the catalogue sorts this import's photos by it as they arrive.
    const ratings = additions.length > 1 ? await readSidecarRatings(additions, files, { signal: controller.signal }).catch(() => []) : [];
    const order = ratedFirstOrder(additions.map((_, index) => ratings[index]));
    const committedKeys = new Set<string>();
    // Several photos are read at once (src/core/importReadAhead.ts), by position in that order.
    const reads = createReadAhead(additions.length, importLanes(deviceMemoryBudget(), navigator.hardwareConcurrency),
      async (position) => {
        // Which project's provider registered this photo's original while it was read (the read may run ahead of its turn).
        const readIn = provider.current;
        const result = await loadLocalFileListShoot([additions[order[position]]], sourceProvider, sourceCatalogue,
          undefined, { allowPartial: true, signal: controller.signal });
        return { result, readIn };
      });
    try {
      // An actual scheduler item for each small group of photographs: complete each original's fingerprint, preview and
      // catalogue registration before advancing. This releases the CPU slot at each group boundary so someone can
      // continue editing while 300 files import.
      const groups = inGroups(order.map((index, position) => ({ index, position, file: additions[index] })), IMPORT_GROUP_SIZE);
      const ticket = await engineScheduler.submit({
        title: engineText.workspace.importTask(additions.length),
        // Above background work (the open photo's Co-pilot check 8, culling 5, RAW develop 9-10), which otherwise took
        // the one heavy slot at every photo boundary as soon as the first photos arrived (owner's 2,000-NEF test:
        // "only 2 came in, then everything crawled"). Below what the person asks for now (denoise 12 and up).
        kind: 'import', resource: 'cpu', priority: 11, pauseable: additions.length > 1,
        items: groups.map((group) => ({ group })),
        // Source file handles are intentionally NOT copied into the journal or
        // snapshot; a picker token cannot be persisted as a verified original.
        snapshot: { projectKey, importId },
        itemId: item => item.group.length === 1 ? pickedKey(item.group[0].file) : `${pickedKey(item.group[0].file)}+${item.group.length - 1}`,
        itemLabel: item => item.group.length === 1 ? item.group[0].file.name : `${item.group[0].file.name} and ${item.group.length - 1} more`,
        runItem: async (item, _, ctx) => {
          const frames: PhotoFrame[] = [];
          const failed: string[] = [];
          const unreadable: string[] = [];
          const keys: string[] = [];
          for (const entry of item.group) {
            const key = pickedKey(entry.file);
            if (committedKeys.has(key)) continue; // A retried group does not add its finished photos twice.
            ctx.stage(engineText.workspace.importReadStage);
            let taken;
            try { taken = await reads.take(entry.position); } catch (reason) { ctx.checkCancelled(); failed.push(reason instanceof Error ? reason.message : entry.file.name); continue; }
            const { result, readIn } = taken;
            ctx.checkCancelled();
            // Read before the project was left and reopened: its original was registered in the provider of the time,
            // which reopening replaced. Register it in the open project's provider too (from its stored copy or its path),
            // or the photo would say "Original not connected, preview only". A closed project does this when it opens.
            if (readIn !== provider.current && provider.current && stateRef.current?.shoot.id === projectKey && result.frames.length) {
              await rehydrateLocalFramesFromStore(result.frames, provider.current, sourceCatalogue, { checkPaths: false }).catch(() => false);
              ctx.checkCancelled();
            }
            if (!result.frames.length) { failed.push(engineText.workspace.importOneFailed(entry.file.name)); continue; }
            if (result.failedNames.length) { unreadable.push(...result.failedNames); continue; }
            // Brought back from another editor: where it came from, and the original's capture details (the PNG has none).
            const cloudPhoto = cloudImports.current.get(key);
            const externalEdit = externalReturns.current.get(key);
            const fromFrame = externalEdit ? stateRef.current?.frames.find((candidate) => candidate.id === externalEdit.fromFrameId) : undefined;
            // Id and capture-order index come from the picked-list position, whatever order the photos were read in.
            frames.push(...result.frames.map(frame => ({
              ...frame, id: `file-${entry.index + 1}-${frame.filename}`,
              sequenceIndex: entry.index + 1,
              ...(cloudPhoto ? { cloudPhoto } : {}),
              ...(externalEdit ? { externalEdit, ...(fromFrame ? { exif: { ...frame.exif, ...returnedExif(fromFrame.exif) } } : {}) } : {}),
              ...(attach?.(key) ?? {}),
            })));
            keys.push(key);
            if (result.unstoredKeys.length) warnings.push(`${entry.file.name} could not be stored for reopening. Relink it when needed.`);
          }
          ctx.stage(engineText.workspace.importSaveStage);
          if (frames.length) ctx.commitIfCurrent(() => {
            if (ctx.signal.aborted) return;
            importedFrames.push(...frames);
            for (const frame of frames) importingIds.current.add(frame.id);
            for (const key of keys) { committedKeys.add(key); pendingNames.delete(key); }
            // One update for the whole group. To the project, wherever it is: on screen, closed (written to its catalogue)
            // or reopening (held). Failed-only retry can happen long after the initial batch finished; recompute burst
            // relationships for those newly added photographs, but not for every file in a 300-photo import.
            handoff.add(projectKey, importBatch(frames, initialImportFinished ? [...importedFrames] : undefined));
            recordPendingImport(projectKey, [...pendingNames.values()]);
          });
          // What was added stays added; the group is then reported as failed so only what is missing is tried again.
          if (failed.length) throw new Error(failed[0]);
          if (unreadable.length) throw new Error(engineText.workspace.importUnreadable(unreadable.join(', ')));
        },
      });
      controller.signal.addEventListener('abort', () => ticket.cancel(), { once: true });
      if (controller.signal.aborted) ticket.cancel();
      const outcome = await ticket.finished;
      initialImportFinished = true;
      if (importedFrames.length) handoff.add(projectKey, importBatch([], [...importedFrames]));
      // Every photo read is in its project (or held for it). What was not read is recorded until a later import
      // completes, so reopening the project says which photos are still to come rather than looking finished.
      recordPendingImport(projectKey, outcome === 'done' ? [] : [...pendingNames.values()], true);
      if (outcome === 'failed') setNotice(engineText.workspace.importSomeFailed(importedFrames.length));
      else if (outcome === 'cancelled') setNotice(engineText.workspace.importStopped(importedFrames.length));
      else if (warnings.length) setNotice(warnings.slice(0, 3).join(' '));
      // Auto-pilot sorts the new photos on this device; Co-pilot offers it; a switched-off cull says so (never silent).
      if (stateRef.current?.shoot.id === projectKey) {
        const next = cullAfterImport(afterImport.current.mode, afterImport.current.canCull, importedFrames.length, outcome, live);
        if (next === 'run') void afterImport.current.run();
        else if (!live && outcome === 'done' && !warnings.length && next === 'offer') setNotice(engineText.workspace.cullOffer);
        else if (!live && outcome === 'done' && !warnings.length && next === 'switched-off') setNotice(engineText.workspace.cullSwitchedOff);
        // Live shoot: show the frame that just landed, so the photographer sees each shot as it arrives.
        const newest = live ? importedFrames.at(-1) : undefined;
        if (newest) followLiveFrame.current?.(newest.id);
      }
      return true;
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : engineText.workspace.importFailed);
      return true;
    } finally {
      controller.abort();
      if (importingInto.current === projectKey) importingInto.current = null;
      if (importController.current === controller) importController.current = null;
      setImporting(false);
      importingIds.current.clear();
    }
  }, []);

  // Live shoot: follow the newest frame only while the photographer is at the newest one, so culling an earlier frame
  // is never pulled away by the next arrival.
  followLiveFrame.current = (photoId: string) => {
    void (async () => {
      for (let wait = 0; !stateRef.current?.frames.some((frame) => frame.id === photoId) && wait < 100; wait++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const current = stateRef.current;
      if (!current?.frames.some((frame) => frame.id === photoId)) return;
      const atNewest = current.selectedFrameId == null || current.selectedFrameId === lastFollowed.current || lastFollowed.current === null;
      lastFollowed.current = photoId;
      if (!atNewest) return;
      setSelected([photoId]);
      mutate((now) => (now.shoot.id === current.shoot.id ? { ...now, selectedFrameId: photoId } : now));
    })();
  };

  const stopLiveFolder = useCallback(() => {
    liveWatch.current?.abort();
    liveWatch.current = null;
    lastFollowed.current = null;
    usbTether.current?.stop();
    usbTether.current = null;
    setLiveFolder((current) => { if (current?.ftp) void stopFtpInbox(); return null; });
  }, []);

  const startLiveFolder = useCallback((source: HotFolderSource, ftp?: FtpInbox) => {
    const projectId = stateRef.current?.shoot.id;
    if (!projectId) return;
    liveWatch.current?.abort();
    const controller = new AbortController();
    liveWatch.current = controller;
    lastFollowed.current = null;
    setLiveFolder({ projectId, name: source.name, imported: 0, arriving: 0, problem: false, ...(ftp ? { ftp } : {}) });
    watchHotFolder(source, {
      signal: controller.signal,
      // Frames for a project that is no longer open are left for the next look (the watch stops when the project closes).
      onReady: (photos) => (stateRef.current?.shoot.id === projectId ? importPhotos(photos, undefined, true) : Promise.resolve(false)),
      onStatus: (status) => { if (!controller.signal.aborted) setLiveFolder((current) => ({ projectId, name: source.name, ...status, ...(ftp ? { ftp } : {}), ...(current?.tether ? { tether: current.tether } : {}) })); },
    });
  }, [importPhotos]);

  // Leaving the project (or closing InFlight's editor) ends the watch: a live shoot belongs to the project it started in.
  useEffect(() => {
    if (liveFolder && liveFolder.projectId !== state?.shoot.id) stopLiveFolder();
  }, [liveFolder, state?.shoot.id, stopLiveFolder]);
  useEffect(() => () => { liveWatch.current?.abort(); usbTether.current?.stop(); void stopFtpInbox(); }, []);

  // Edit in another app (desktop): the current edit at its own size, the same render as an Original-size export
  // without overlays, so the other editor gets the photo itself. Each settled save comes back as a new photo.
  const externalEdits = useExternalEdits({
    frameOf: (photoId) => stateRef.current?.frames.find((frame) => frame.id === photoId && frame.removedAt == null),
    renderEdit: async (frame) => {
      const current = stateRef.current;
      if (!current || !provider.current) throw new Error(engineText.workspace.exportStopped);
      const request: ExportRequest = {
        photoIds: [frame.id], sizeIds: [ORIGINAL_FORMAT_ID], groupIds: [], destination: 'local-individual', fileFormat: 'png',
        includeAfter: true, includeBefore: false, includeOriginal: false, includeOverlay: false, includeWatermark: false, includeVideo: false,
      };
      const plan = planExport(request, current.frames, createDefaultSizes());
      if ('error' in plan) throw new Error(plan.error);
      const job = plan.jobs[0];
      const variant = job?.variants[0];
      if (!job || !variant) throw new Error(engineText.workspace.exportStopped);
      const snapshot = structuredClone(frame);
      const env = structuredClone(exportEnv.current);
      const sourceProvider = provider.current;
      let rendered: File | null = null;
      let failure = '';
      const ticket = await engineScheduler.submit({
        title: v2Text.externalEdit.sending, kind: 'export', location: 'local', resource: 'gpu', priority: 6, pauseable: false,
        items: [{ id: snapshot.id, name: snapshot.filename }], snapshot: { frameId: snapshot.id },
        itemId: (item) => item.id, itemLabel: (item) => item.name,
        runItem: async (_, __, ctx) => {
          try {
            const files = await renderExportJob({ frame: snapshot, job, variant, request, provider: sourceProvider,
              buildOverlay: (target, submitted) => buildOverlayDraw(target, submitted, env), started: new Date(), signal: ctx.signal,
              stage: (message) => ctx.stage(message), checkCancelled: () => ctx.checkCancelled() });
            rendered = files[0] ?? null;
          } catch (reason) {
            failure = reason instanceof Error ? reason.message : String(reason);
            throw reason;
          }
        },
      });
      const outcome = await ticket.finished;
      const file = rendered as File | null;
      if (outcome !== 'done' || !file) throw new Error(failure || engineText.workspace.exportStopped);
      return file;
    },
    importReturned: async (picked, record) => {
      if (importController.current) return false;
      const key = pickedKey(picked);
      externalReturns.current.set(key, record);
      try {
        await importPhotos([picked]);
      } finally {
        externalReturns.current.delete(key);
      }
      const isThis = (frame: PhotoFrame) => {
        const stored = readExternalEdit(frame.externalEdit);
        return stored?.fromFrameId === record.fromFrameId && stored.sentAt === record.sentAt && stored.round === record.round;
      };
      if (!stateRef.current?.frames.some(isThis)) return false;
      mutate((current) => ({ ...current, frames: placeBeside(current.frames, current.frames.filter(isThis).map((frame) => frame.id), record.fromFrameId) }));
      return true;
    },
    notify: (message) => setNotice(message),
  });

  /**
   * Reconnect originals the catalogue can no longer read (moved, renamed, or a browser session that lost its blob),
   * reusing the same verified primitives App.tsx's reconnectFileSelection already uses: getLocalFileKey to identify a
   * picked file, BrowserPreviewProvider.hasBlob/registerBlob and BrowserCatalogueStore.saveLocalFileBlob to store it.
   * Browser/web, sourceKind 'file' originals only: matches every picked file against every frame still missing its
   * original (not just the one clicked), exactly as App.tsx's whole-project reselect does. On the desktop app the
   * person picks the folder or drive that now holds the originals instead, and each one is proved by its full-file
   * SHA-256 before its saved path changes (desktopRelink.ts, the same matching App.tsx's folder reconnect uses).
   */
  const reconnectOriginal = useCallback(() => {
    if (relinking.current) return;
    relinking.current = true;
    /** Forget the failed pictures of reconnected photos and read them again from their verified originals. */
    const refreshRecovered = (target: CullingState, recoveredIds: readonly string[]) => {
      setUrls((current) => {
        const updated = { ...current };
        for (const id of recoveredIds) delete updated[id];
        return updated;
      });
      for (const id of recoveredIds) {
        thumbs.current.requested.delete(id);
        const frame = target.frames.find((candidate) => candidate.id === id);
        if (frame) thumbs.current.queue.push(frame);
      }
      pumpThumbnails();
      if (activeId && recoveredIds.includes(activeId)) {
        const frame = target.frames.find((candidate) => candidate.id === activeId);
        if (frame) provider.current!.getFullPreviewUrl(frame, 'selected').then(
          (preview) => setUrls((current) => ({ ...current, [frame.id]: { ...current[frame.id], preview } })),
          () => { /* thumbnail reload shows failures without replacing original bytes */ },
        );
      }
    };
    if (isDesktopApp()) {
      // Desktop: originals stay where they are on the disk. Pick the folder or drive that now holds them; each missing
      // photo is proved by its full-file fingerprint before its saved path changes (see desktopRelink.ts).
      const words = engineText.workspace.relink;
      void (async () => {
        const target = stateRef.current;
        const projectId = target?.shoot.id;
        const stillCurrent = () => Boolean(projectId) && stateRef.current?.shoot.id === projectId;
        try {
          if (!target || !projectId) return;
          const folder = await pickRelinkFolder(words.chooseFolder);
          if (!folder || !stillCurrent()) return;
          const missing = framesNeedingRelink(target.frames, (key) => provider.current!.hasBlob(key));
          if (!missing.length) { setNotice(words.nothingMissing); return; }
          const connectedPaths = target.frames
            .filter((frame) => frame.sourcePath && provider.current!.hasBlob(frame.stableKey))
            .map((frame) => frame.sourcePath!);
          setNotice(words.checking(missing.length));
          const plan = await planDesktopRelink(missing, connectedPaths, folder, await tauriRelinkFs(), stillCurrent);
          if (!stillCurrent()) return;
          for (const [key, path] of plan.replacements) {
            const frame = missing.find((candidate) => candidate.stableKey === key)!;
            const size = Number(key.split('::').at(-2)) || 0;
            const lastModified = Number(key.split('::').at(-1)) || 0;
            provider.current!.registerLinked(key, {
              read: linkedReader(path, frame.filename, lastModified, size || undefined, frame.originalSha256!),
              openRange: linkedRangeOpener(path, size || undefined, frame.originalSha256!),
              size, lastModified, path, sha256: frame.originalSha256,
            });
            provider.current!.retryLinkedOriginal(key);
          }
          if (plan.replacements.size) mutate((current) => current.shoot.id !== projectId ? current
            : { ...current, frames: applyDesktopRelink(current.frames, missing, plan.replacements) });
          const now = stateRef.current ?? target;
          refreshRecovered(now, now.frames.filter((frame) => plan.replacements.has(frame.stableKey)).map((frame) => frame.id));
          const left = missing.length - plan.replacements.size;
          setNotice([
            plan.replacements.size ? words.reconnected(plan.replacements.size) : words.noMatch,
            plan.replacements.size && left ? words.stillMissing(left) : '',
            plan.ambiguous ? words.ambiguous(plan.ambiguous) : '',
            plan.unverifiable ? words.unverifiable(plan.unverifiable) : '',
            plan.truncated ? words.scanLimit : '',
          ].filter(Boolean).join(' '));
        } catch {
          if (stillCurrent()) setNotice(words.unreadable);
        } finally {
          relinking.current = false;
        }
      })();
      return;
    }
    void (async () => {
      try {
        const files = await pickReselectFiles();
        if (!files?.length) return;
        const target = stateRef.current;
        const projectId = target?.shoot.id;
        if (!target || !projectId) return;
        const missing = target.frames.filter((frame) =>
          !frame.removedAt && frame.sourceKind === 'file' && !provider.current!.hasBlob(frame.stableKey)
        );
        const recoveredIds: string[] = [];
        let wrongBytes = 0;
        let legacyWithoutHash = 0;
        let temporarilyHeld = 0;
        for (const file of files) {
          if (stateRef.current?.shoot.id !== projectId) return;
          const key = getLocalFileKey(file);
          const candidates = missing.filter((frame) => frame.stableKey === key);
          if (!candidates.length || provider.current!.hasBlob(key)) continue;
          // File name, size and mtime only identify which catalogue entry to check.
          // The original's saved full-content fingerprint MUST match before registration or storage.
          const digests = [...new Set(candidates.map((frame) => frame.originalSha256))];
          if (digests.length !== 1 || typeof digests[0] !== 'string') {
            legacyWithoutHash += candidates.length;
            continue;
          }
          const actual = await hashOriginalBytes(file);
          if (stateRef.current?.shoot.id !== projectId) return;
          if (!isSameOriginalBytes(digests[0], actual)) {
            wrongBytes += candidates.length;
            continue;
          }
          let stored = false;
          try { stored = await catalogue.current!.saveLocalFileBlob(key, file); }
          catch { /* A quota failure may still allow using the verified file in this session. */ }
          if (stateRef.current?.shoot.id !== projectId) return;
          provider.current!.registerBlob(key, file);
          recoveredIds.push(...candidates.map((frame) => frame.id));
          if (!stored) temporarilyHeld += candidates.length;
        }
        if (!recoveredIds.length) {
          if (wrongBytes) setNotice('Refused the selected file: its contents do not match the original, even though the filename and size may match. Nothing was replaced.');
          else if (legacyWithoutHash) setNotice('This older project has no recorded original fingerprint, so InFlight cannot safely reconnect it. Import the file as a new photo instead; nothing was replaced.');
          else setNotice('Those files did not match a missing original in this project.');
          return;
        }
        refreshRecovered(target, recoveredIds);
        const stillMissing = missing.filter((frame) => !provider.current!.hasBlob(frame.stableKey)).length;
        setNotice([
          `Reconnected ${recoveredIds.length} photo${recoveredIds.length === 1 ? '' : 's'} using matching original bytes.`,
          temporarilyHeld ? `${temporarilyHeld} original${temporarilyHeld === 1 ? ' is' : 's are'} available this session only: device storage could not save ${temporarilyHeld === 1 ? 'it' : 'them'}.` : '',
          wrongBytes ? `${wrongBytes} mismatched file${wrongBytes === 1 ? ' was' : 's were'} refused.` : '',
          legacyWithoutHash ? `${legacyWithoutHash} legacy original${legacyWithoutHash === 1 ? ' has' : 's have'} no fingerprint and cannot be verified.` : '',
          stillMissing ? `${stillMissing} more original${stillMissing === 1 ? ' still needs' : 's still need'} reconnecting.` : '',
        ].filter(Boolean).join(' '));
      } catch {
        setNotice('InFlight could not verify those files. Nothing was replaced.');
      } finally {
        relinking.current = false;
      }
    })();
  }, [pumpThumbnails, activeId, mutate]);

  const backToProjects = useCallback(async () => {
    const leaving = stateRef.current?.shoot.id ?? null;
    // Photos an import finishes from now on go to the saved project, not this screen; photos it already added are
    // rendered into the state before it is saved, so none is left behind in a pending update.
    leavingProject.current = leaving;
    flushSync(() => undefined);
    const current = stateRef.current;
    if (current) {
      // Only through the guard: it saves one project's states in order, so neither an older autosave still retrying
      // nor this save can land after photos the import writes to the closed project.
      saveGuard.current!.submit(current.shoot.id, current);
      if (!await saveGuard.current!.whenStored(current.shoot.id)) {
        // A failed final save must not discard edits that only exist in memory. The guard keeps retrying it.
        leavingProject.current = null;
        setNotice('This project could not be saved. You are still in the editor with your changes. Check device storage and try again.');
        return;
      }
    }
    setState(null); setScreen('hub'); setSelected([]);
    if (leavingProject.current === leaving) leavingProject.current = null;
    await loadHub();
  }, [loadHub]);

  const collageExportRunning = useRef(false);
  const real: Partial<WorkspaceActions> = {
    exportCollage: async (request) => {
      const current = stateRef.current;
      if (!current) throw new Error('Open a collage before exporting its pages.');
      if (collageExportRunning.current) throw new Error('A collage export is already running.');
      collageExportRunning.current = true;
      // The same document, photo edit recipes and page settings are retained
      // throughout the queued job; later edits cannot silently alter the output.
      const source = structuredClone(current);
      const submitted = structuredClone(request);
      const sourceProjectId = current.shoot.id;
      const requestGeneration = openRequest.current;
      try {
        const ticket = await engineScheduler.submit({
          title: 'Exporting collage', kind: 'collage', resource: 'gpu', priority: 2,
          pauseable: false, items: [{ id: sourceProjectId, label: 'Collage pages and destination' }],
          snapshot: { projectId: sourceProjectId, request: submitted },
          itemId: item => item.id, itemLabel: item => item.label,
          runItem: async (_, __, ctx) => {
            ctx.stage('Rendering all selected pages at print or social resolution');
            const result = await exportCollage(source, provider.current!, submitted, ctx.signal, (done, total) => {
              if (openRequest.current !== requestGeneration || stateRef.current?.shoot.id !== sourceProjectId)
                throw new Error('The project changed during collage export. Nothing was downloaded.');
              ctx.reportProgress(done, total, `${done} of ${total} pages rendered`);
            });
            ctx.checkCancelled();
            if (openRequest.current !== requestGeneration || stateRef.current?.shoot.id !== sourceProjectId)
              throw new Error('The project changed during collage export. Nothing was downloaded.');
            ctx.stage('Confirming the native collage save');
            if (!await saveExportFile(result.blob, result.name, ctx.signal))
              throw new DOMException('The collage save was cancelled.', 'AbortError');
            ctx.acknowledgeCommitted();
            ctx.commitIfCurrent(() => setNotice('Collage export prepared. Your originals are unchanged.'));
          },
        });
        const outcome = await ticket.finished;
        if (outcome === 'failed') throw new Error('Collage export failed. Open Tasks to view the error.');
        if (outcome === 'cancelled') throw new Error('Collage export cancelled. Previously delivered files remain unchanged.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Collage export failed.';
        setNotice(message);
        throw new Error(message);
      } finally { collageExportRunning.current = false; }
    },
    addEditGroup: (photoId) => {
      const id = `group-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 24)}`;
      const frame = stateRef.current?.frames.find((item) => item.id === photoId);
      if (!frame || !addSavedEditGroup(frame, id)) { setNotice('Could not add another edit group.'); return; }
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
        frames: current.frames.map((item) => item.id === photoId ? addSavedEditGroup(item, id) ?? item : item) }));
    },
    setActiveGroup: (photoId, groupId) => {
      const frame = stateRef.current?.frames.find((item) => item.id === photoId);
      if (!frame || !selectSavedEditGroup(frame, groupId)) { setNotice('That edit group is unavailable.'); return; }
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
        frames: current.frames.map((item) => item.id === photoId ? selectSavedEditGroup(item, groupId) ?? item : item) }));
    },
    renameEditGroup: (photoId, groupId, name) => {
      const frame = stateRef.current?.frames.find((item) => item.id === photoId);
      if (!frame || !renameSavedEditGroup(frame, groupId, name)) { setNotice('Choose a group name between 1 and 80 characters.'); return; }
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
        frames: current.frames.map((item) => item.id === photoId ? renameSavedEditGroup(item, groupId, name) ?? item : item) }));
    },
    reconnectOriginal: () => reconnectOriginal(),
    developFullSize: (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      if (!frame || !fullDevelopPossible(frame, canDevelopRaw(), true)) {
        setNotice('Only a RAW photo can be developed at full size, on a device with InFlight’s RAW decoder.');
        return;
      }
      const key = frame.stableKey;
      const sourceProvider = provider.current!;
      if (fullDevelopRunning.current.has(key)) return;
      fullDevelopRunning.current.add(key);
      setFullDeveloping((current) => ({ ...current, [key]: true }));
      const target = structuredClone(frame);
      void (async () => {
        try {
          const ticket = await engineScheduler.submit({
            title: 'Developing full size from RAW', kind: 'raw', resource: 'cpu', priority: 9,
            pauseable: false, items: [{ id: target.id, name: target.filename }],
            snapshot: { frameId: target.id, stableKey: key },
            itemId: (item) => item.id, itemLabel: (item) => item.name,
            runItem: async (_, __, ctx) => {
              ctx.stage('Developing the sensor data at full size');
              await developFullSizeOf(target, sourceProvider);
              ctx.checkCancelled();
            },
          });
          const result = await ticket.finished;
          if (result === 'failed') setNotice(`${target.filename} could not be developed at full size. Open Tasks for the reason. Your original is unchanged.`);
        } catch (reason) {
          setNotice(reason instanceof Error ? reason.message : 'Could not start the full-size develop.');
        } finally {
          fullDevelopRunning.current.delete(key);
          setFullDeveloping((current) => { const { [key]: _done, ...rest } = current; return rest; });
        }
      })();
    },
    focusStackPhotos: (photoIds) => {
      const source = stateRef.current;
      if (!source) return;
      if (!can('focusStack') && !focusStackPreviewOn()) return;
      const selection = stackSelection(source.frames, photoIds);
      if (!selection.ok) { setNotice(selection.message); return; }
      const frames = selection.frames.map((frame) => structuredClone(frame));
      const sourceProvider = provider.current!;
      const projectKey = source.shoot.id;
      const taken = new Set(source.frames.map((frame) => frame.filename.toLowerCase()));
      const name = stackedFilename(frames[0].filename, frames.length, taken);
      void (async () => {
        let made: { file: File; recipe: FocusStackRecipe; notice: string } | null = null;
        let refusal: string | null = null;
        try {
          const ticket = await engineScheduler.submit({
            title: stackText.task(frames.length), kind: 'other', resource: 'cpu', priority: 12,
            pauseable: false, items: [{ id: `stack-${frames.map((frame) => frame.id).join('+')}`, name }],
            snapshot: { projectKey, frameIds: frames.map((frame) => frame.id) },
            itemId: (item) => item.id, itemLabel: (item) => item.name,
            runItem: async (_, __, ctx) => {
              ctx.stage(stackText.reading);
              // Full-size pixels only: a verified original, or a RAW's full-size develop from its sensor data. Never a
              // review preview or the camera's small embedded JPEG, and never silently smaller.
              const images: HTMLImageElement[] = [];
              let picture: FocusStackRecipe['sourcePicture'] = 'original';
              for (const frame of frames) {
                ctx.checkCancelled();
                if (fullResolutionRasterFormat(frame.filename)) {
                  images.push(await loadVerifiedRasterOriginalForExport(frame, sourceProvider, ctx.signal));
                } else if (isRawPreviewFile(frame.filename)) {
                  const loaded = await loadExportSource(frame, sourceProvider);
                  if (!sourceProvider.isDeveloped(frame.stableKey) || sourceProvider.isOfflineFallback(frame.stableKey)) {
                    refusal = stackText.rawNotDeveloped(frame.filename);
                    throw new Error(refusal);
                  }
                  images.push(loaded);
                  picture = 'raw-develop';
                } else {
                  refusal = stackText.unsupported(frame.filename);
                  throw new Error(refusal);
                }
              }
              const { naturalWidth: width, naturalHeight: height } = images[0];
              const limit = maxCanvasPixels({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
              if (width * height > limit) { refusal = stackText.tooLarge; throw new Error(refusal); }
              // In a worker, so the editor keeps responding; on this thread (smaller bands) only where a worker cannot run.
              const { result, onMainThread } = await stackFocusOffThread(images, {
                signal: ctx.signal, maxWorkingBytes: 192 * 1024 * 1024,
                hereSources: () => images.map((image) => imageStackSource(image)),
                onProgress: (done, total, stage) => { ctx.stage(stackText[stage]); ctx.reportProgress(done, total); },
              });
              if (!result.ok) { refusal = refusalText(result); throw new Error(refusal); }
              ctx.stage(stackText.saving);
              const blob = await encodePng16(rgbaToRgb16(result));
              ctx.checkCancelled();
              // Read the written header back: a 16-bit RGB PNG of exactly the stack's size, or nothing is added.
              const proof = provePng(new Uint8Array(await blob.arrayBuffer()));
              if (proof.bitDepth !== 16 || proof.colourType !== 2 || proof.width !== width || proof.height !== height) throw new Error(stackText.failed);
              const file = new File([blob], name, { type: 'image/png', lastModified: Date.now() });
              const recipe = focusStackRecipe(result, frames.map((frame) => ({ frameId: frame.id, stableKey: frame.stableKey, filename: frame.filename, ...(frame.originalSha256 ? { originalSha256: frame.originalSha256 } : {}) })), picture, Date.now());
              ctx.commitIfCurrent(() => { made = { file, recipe, notice: stackDoneNotice(name, result, frames.length) + (onMainThread ? ` ${stackText.mainThread}` : '') }; });
            },
          });
          const outcome = await ticket.finished;
          if (outcome === 'cancelled') { setNotice(stackText.cancelled); return; }
          if (outcome === 'failed' || !made) { setNotice(refusal ?? stackText.failed); return; }
          const done = made as { file: File; recipe: FocusStackRecipe; notice: string };
          const key = pickedKey(pickedFromFile(done.file));
          if (stateRef.current?.shoot.id !== projectKey) { setNotice(stackText.failed); return; }
          // One import at a time: wait for one already running rather than lose the stack.
          while (importController.current) await new Promise((resolve) => setTimeout(resolve, 500));
          if (stateRef.current?.shoot.id !== projectKey) { setNotice(stackText.failed); return; }
          await importPhotos([done.file], (picked) => (picked === key ? { focusStack: done.recipe } : undefined));
          setNotice(done.notice);
        } catch (reason) {
          setNotice(refusal ?? (reason instanceof Error ? reason.message : stackText.failed));
        }
      })();
    },
    stitchPanorama: (photoIds) => {
      const source = stateRef.current;
      if (!source) return;
      if (!can('panorama') && !panoramaPreviewOn()) return;
      const selection = panoSelection(source.frames, photoIds);
      if (!selection.ok) { setNotice(selection.message); return; }
      const frames = selection.frames.map((frame) => structuredClone(frame));
      const sourceProvider = provider.current!;
      const projectKey = source.shoot.id;
      const taken = new Set(source.frames.map((frame) => frame.filename.toLowerCase()));
      const name = panoFilename(frames[0].filename, frames.length, taken);
      void (async () => {
        let made: { file: File; recipe: PanoramaRecipe; notice: string } | null = null;
        let refusal: string | null = null;
        try {
          const ticket = await engineScheduler.submit({
            title: panoText.task(frames.length), kind: 'other', resource: 'cpu', priority: 12,
            pauseable: false, items: [{ id: `pano-${frames.map((frame) => frame.id).join('+')}`, name }],
            snapshot: { projectKey, frameIds: frames.map((frame) => frame.id) },
            itemId: (item) => item.id, itemLabel: (item) => item.name,
            runItem: async (_, __, ctx) => {
              ctx.stage(panoText.reading);
              // Full-size pixels only: a verified original, or a RAW's full-size develop from its sensor data. Never a
              // review preview or the camera's small embedded JPEG, and never silently smaller.
              const images: HTMLImageElement[] = [];
              let picture: PanoramaRecipe['sourcePicture'] = 'original';
              for (const frame of frames) {
                ctx.checkCancelled();
                if (fullResolutionRasterFormat(frame.filename)) {
                  images.push(await loadVerifiedRasterOriginalForExport(frame, sourceProvider, ctx.signal));
                } else if (isRawPreviewFile(frame.filename)) {
                  const loaded = await loadExportSource(frame, sourceProvider);
                  if (!sourceProvider.isDeveloped(frame.stableKey) || sourceProvider.isOfflineFallback(frame.stableKey)) {
                    refusal = panoText.rawNotDeveloped(frame.filename);
                    throw new Error(refusal);
                  }
                  images.push(loaded);
                  picture = 'raw-develop';
                } else {
                  refusal = panoText.unsupported(frame.filename);
                  throw new Error(refusal);
                }
              }
              const { naturalWidth: width, naturalHeight: height } = images[0];
              const limit = maxCanvasPixels({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
              // Every frame is held at full size while it stitches: refuse rather than shrink when that is too much.
              if (width * height * images.length > Math.max(limit, 120_000_000) * 3) { refusal = panoText.tooLarge; throw new Error(refusal); }
              // The camera's 35 mm equivalent focal length when every frame records the same one; otherwise it is worked out.
              const focals = frames.map((frame) => frame.exif?.focalLength35mm);
              const sameFocal = focals.every((value) => value && focals[0] && Math.abs(value - focals[0]) <= focals[0] * 0.02);
              const focalPx = sameFocal ? focalPxFrom35mm(focals[0], width, height) : null;
              // In a worker, so the editor keeps responding; on this thread only where a worker cannot run.
              const { result, onMainThread } = await stitchPanoramaOffThread(images, {
                signal: ctx.signal, focalPx, maxOutputPixels: limit,
                hereSources: () => images.map((image) => imagePanoSource(image)),
                onProgress: (done, total, stage) => { ctx.stage(panoText[stage]); ctx.reportProgress(done, total); },
              });
              if (!result.ok) { refusal = panoRefusalText(result); throw new Error(refusal); }
              ctx.stage(panoText.saving);
              const blob = await encodePng16({ width: result.width, height: result.height, data: result.data });
              ctx.checkCancelled();
              // Read the written header back: a 16-bit RGB PNG of exactly the panorama's size, or nothing is added.
              const proof = provePng(new Uint8Array(await blob.arrayBuffer()));
              if (proof.bitDepth !== 16 || proof.colourType !== 2 || proof.width !== result.width || proof.height !== result.height) throw new Error(panoText.failed);
              const file = new File([blob], name, { type: 'image/png', lastModified: Date.now() });
              const recipe = panoramaRecipe(result, frames.map((frame) => ({ frameId: frame.id, stableKey: frame.stableKey, filename: frame.filename, ...(frame.originalSha256 ? { originalSha256: frame.originalSha256 } : {}) })), picture, Date.now());
              ctx.commitIfCurrent(() => { made = { file, recipe, notice: panoDoneNotice(name, result, frames.length) + (onMainThread ? ` ${panoText.mainThread}` : '') }; });
            },
          });
          const outcome = await ticket.finished;
          if (outcome === 'cancelled') { setNotice(panoText.cancelled); return; }
          if (outcome === 'failed' || !made) { setNotice(refusal ?? panoText.failed); return; }
          const done = made as { file: File; recipe: PanoramaRecipe; notice: string };
          const key = pickedKey(pickedFromFile(done.file));
          if (stateRef.current?.shoot.id !== projectKey) { setNotice(panoText.failed); return; }
          // One import at a time: wait for one already running rather than lose the panorama.
          while (importController.current) await new Promise((resolve) => setTimeout(resolve, 500));
          if (stateRef.current?.shoot.id !== projectKey) { setNotice(panoText.failed); return; }
          await importPhotos([done.file], (picked) => (picked === key ? { panorama: done.recipe } : undefined));
          setNotice(done.notice);
        } catch (reason) {
          setNotice(refusal ?? (reason instanceof Error ? reason.message : panoText.failed));
        }
      })();
    },
    hdrMergePhotos: (photoIds) => {
      const source = stateRef.current;
      if (!source) return;
      if (!can('hdrMerge') && !hdrPreviewOn()) return;
      const selection = hdrSelection(source.frames, photoIds);
      if (!selection.ok) { setNotice(selection.message); return; }
      const frames = selection.frames.map((frame) => structuredClone(frame));
      const sourceProvider = provider.current!;
      const projectKey = source.shoot.id;
      const taken = new Set(source.frames.map((frame) => frame.filename.toLowerCase()));
      const name = hdrFilename(frames[0].filename, frames.length, taken);
      void (async () => {
        let made: { file: File; recipe: HdrMergeRecipe; notice: string } | null = null;
        let refusal: string | null = null;
        const refuse = (message: string): never => { refusal = message; throw new Error(message); };
        try {
          const ticket = await engineScheduler.submit({
            title: hdrText.task(frames.length), kind: 'other', resource: 'cpu', priority: 12,
            pauseable: false, items: [{ id: `hdr-${frames.map((frame) => frame.id).join('+')}`, name }],
            snapshot: { projectKey, frameIds: frames.map((frame) => frame.id) },
            itemId: (item) => item.id, itemLabel: (item) => item.name,
            runItem: async (_, __, ctx) => {
              ctx.stage(hdrText.reading);
              // Full-size pixels only: a verified raster original, or a RAW's full-size 16-bit develop from its sensor
              // data. Never a review preview or the camera's small embedded JPEG, and never silently smaller.
              const inputs: HdrFrameInput[] = [];
              const here: Array<() => import('../../core/hdrMerge').HdrSource> = [];
              let raster = 0, raw = 0;
              const limit = maxCanvasPixels({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
              let bytes = 0;
              for (const frame of frames) {
                ctx.checkCancelled();
                if (fullResolutionRasterFormat(frame.filename)) {
                  const image = await loadVerifiedRasterOriginalForExport(frame, sourceProvider, ctx.signal);
                  const { naturalWidth: w, naturalHeight: h } = image;
                  if (w * h > limit) refuse(hdrText.tooLarge);
                  bytes += w * h * 4;
                  inputs.push({ kind: 'picture', image });
                  here.push(() => canvasSource(image, w, h, (cw, ch) => {
                    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
                    return canvas.getContext('2d', { willReadFrequently: true });
                  }));
                  raster++;
                } else if (isRawPreviewFile(frame.filename) && canDevelopRaw()) {
                  const original = await sourceProvider.ensureOriginal(frame.stableKey, 'selected');
                  if (!original) refuse(hdrText.rawNotDeveloped(frame.filename));
                  const shown = await loadExportSource(frame, sourceProvider);
                  ctx.checkCancelled();
                  const picture = await renderRaw16(original!, frame.filename, shown, DEFAULT_EDIT, undefined, { originalSha256: frame.originalSha256, signal: ctx.signal })
                    .catch(() => refuse(hdrText.rawNotDeveloped(frame.filename)));
                  bytes += picture.width * picture.height * 6;
                  inputs.push({ kind: 'rgb16', width: picture.width, height: picture.height, data: picture.data });
                  here.push(() => rgb16Source(picture.width, picture.height, picture.data));
                  raw++;
                } else {
                  refuse(isRawPreviewFile(frame.filename) ? hdrText.rawNotDeveloped(frame.filename) : hdrText.unsupported(frame.filename));
                }
                // Every frame is held once here and once in the worker; stay well inside what the device can hold.
                if (bytes * 2 > Math.min(limit * 24, 3 * 1024 ** 3)) refuse(hdrText.tooLarge);
              }
              const { result, onMainThread } = await mergeHdrOffThread(inputs, {
                signal: ctx.signal, maxWorkingBytes: 192 * 1024 * 1024,
                hereSources: () => here.map((make) => make()),
                onProgress: (done, total, stage) => { ctx.stage(hdrText[stage]); ctx.reportProgress(done, total); },
              });
              if (!result.ok) refuse(hdrRefusalText(result as import('../../core/hdrMerge').HdrRefusal));
              const merged = result as import('../../core/hdrMerge').HdrSuccess;
              ctx.stage(hdrText.saving);
              const blob = await encodePng16({ width: merged.width, height: merged.height, data: merged.data });
              ctx.checkCancelled();
              // Read the written header back: a 16-bit RGB PNG of exactly the merge's size, or nothing is added.
              const proof = provePng(new Uint8Array(await blob.arrayBuffer()));
              if (proof.bitDepth !== 16 || proof.colourType !== 2 || proof.width !== merged.width || proof.height !== merged.height) refuse(hdrText.failed);
              const file = new File([blob], name, { type: 'image/png', lastModified: Date.now() });
              const recipe = hdrMergeRecipe(merged, frames.map((frame) => ({ frameId: frame.id, stableKey: frame.stableKey, filename: frame.filename, ...(frame.originalSha256 ? { originalSha256: frame.originalSha256 } : {}) })),
                raw && raster ? 'mixed' : raw ? 'raw-develop-16' : 'original', Date.now());
              ctx.commitIfCurrent(() => { made = { file, recipe, notice: hdrDoneNotice(name, merged, frames.length) + (onMainThread ? ` ${hdrText.mainThread}` : '') }; });
            },
          });
          const outcome = await ticket.finished;
          if (outcome === 'cancelled') { setNotice(hdrText.cancelled); return; }
          if (outcome === 'failed' || !made) { setNotice(refusal ?? hdrText.failed); return; }
          const done = made as { file: File; recipe: HdrMergeRecipe; notice: string };
          const key = pickedKey(pickedFromFile(done.file));
          if (stateRef.current?.shoot.id !== projectKey) { setNotice(hdrText.failed); return; }
          // One import at a time: wait for one already running rather than lose the merge.
          while (importController.current) await new Promise((resolve) => setTimeout(resolve, 500));
          if (stateRef.current?.shoot.id !== projectKey) { setNotice(hdrText.failed); return; }
          await importPhotos([done.file], (picked) => (picked === key ? { hdrMerge: done.recipe } : undefined));
          setNotice(done.notice);
        } catch (reason) {
          setNotice(refusal ?? (reason instanceof Error ? reason.message : hdrText.failed));
        }
      })();
    },
    editInOtherApp: (photoId, app) => externalEdits.editInOtherApp(photoId, app),
    stopExternalEdit: (photoId) => externalEdits.stopExternalEdit(photoId),
    saveDngCopy: (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      if (!frame || !dngCopyOffered(frame, canExportRawMaster())) {
        setNotice('A DNG copy is made only for Nikon High Efficiency NEFs, in the desktop app. Your original is unchanged.');
        return;
      }
      const sourceProvider = provider.current!;
      const target = structuredClone(frame);
      void (async () => {
        try {
          const ticket = await engineScheduler.submit({
            title: 'Saving a lossless DNG copy', kind: 'raw', resource: 'cpu', priority: 10,
            pauseable: false, items: [{ id: target.id, name: target.filename }],
            snapshot: { frameId: target.id, originalSha256: target.originalSha256 },
            itemId: (item) => item.id, itemLabel: (item) => item.name,
            runItem: async (_, __, ctx) => {
              ctx.stage('Reading the sensor data into a DNG');
              const file = await buildDngCopyFile(target, sourceProvider, ctx.signal);
              ctx.checkCancelled();
              ctx.stage('Saving the DNG copy');
              if (!await saveExportFile(file, file.name, ctx.signal)) throw new DOMException('Save cancelled.', 'AbortError');
              ctx.acknowledgeCommitted();
              ctx.commitIfCurrent(() => setNotice(`Saved ${file.name}. Your original NEF is unchanged.`));
            },
          });
          const result = await ticket.finished;
          if (result === 'failed') setNotice('The DNG copy failed. Open Tasks for the reason. Your original is unchanged.');
          else if (result === 'cancelled') setNotice('DNG copy cancelled.');
        } catch (reason) {
          setNotice(reason instanceof Error ? reason.message : 'Could not start the DNG copy.');
        }
      })();
    },
    openProject: (id) => { void openProject(id); },
    createProject: (name, kind = 'photography', mode, cloudEdits) => {
      const empty = createEmptyProject(`project-${newId()}`, name.trim() || 'Untitled project');
      const withCloud = cloudEdits && cloudEdits !== 'none' && cloudRecipeOn ? { ...empty, shoot: { ...empty.shoot, cloudEdits } } : empty;
      const withMode = mode ? { ...withCloud, shoot: { ...withCloud.shoot, assistMode: mode } } : withCloud;
      const created = kind === 'collage' ? { ...withMode, shoot: { ...withMode.shoot, collage: createCollage() } }
        : kind === 'tethered' ? { ...withMode, shoot: { ...withMode.shoot, projectType: 'tethered' as const } } : withMode;
      void catalogue.current!.saveProject(created).then(() => enterProject(created), () => setNotice('InFlight could not create the project.'));
    },
    createCollageFromSelection: (photoIds) => {
      const source = stateRef.current;
      if (!source) return;
      const chosen = new Set(photoIds);
      const selectedFrames = source.frames.filter((frame) => chosen.has(frame.id) && frame.removedAt == null);
      if (!selectedFrames.length) { setNotice('Select at least one photograph to make a collage.'); return; }
      if (selectedFrames.length > MAX_COLLAGE_SELECTION) { setNotice(`Choose up to ${MAX_COLLAGE_SELECTION} photographs per collage.`); return; }
      // A new project references the same verified original keys but has independent saved recipes.
      // Keep source frames and edits untouched; do not move or delete source photographs.
      const projectId = `project-${newId()}`;
      const idMap = new Map(selectedFrames.map((frame) => [frame.id, `${projectId}-${frame.id}`]));
      const frames = selectedFrames.map((frame, index) => ({
        ...frame, id: idMap.get(frame.id)!, sequenceIndex: index + 1,
        virtualCopy: frame.virtualCopy && idMap.has(frame.virtualCopy.originalFrameId)
          ? { ...frame.virtualCopy, originalFrameId: idMap.get(frame.virtualCopy.originalFrameId)! } : undefined,
      }));
      const blank = createEmptyProject(projectId, `Collage from ${source.shoot.title}`);
      const created = {
        ...blank, frames, selectedFrameId: frames[0].id,
        shoot: { ...blank.shoot, totalFrames: frames.length,
          collage: createCollage(frames.map((frame) => frame.id)) },
      };
      void catalogue.current!.saveProject(created)
        .then(() => openProject(created.shoot.id))
        .catch(() => setNotice('InFlight could not save this collage. The source project is unchanged.'));
    },
    browseCollageProjectPhotos: async (sourceProjectId) => {
      const source = await catalogue.current!.loadProject(sourceProjectId);
      if (!source) throw new Error('Could not open the source project.');
      return source.frames.filter((frame) => frame.removedAt == null)
        .map((frame) => ({ id: frame.id, filename: frame.filename }));
    },
    addCollageProjectPhotos: async (sourceProjectId, photoIds) => {
      const target = stateRef.current;
      if (!target?.shoot.collage || sourceProjectId === target.shoot.id) return;
      const source = await catalogue.current!.loadProject(sourceProjectId);
      if (!source) throw new Error('Could not open the source project.');
      const chosen = new Set(photoIds);
      const already = new Set(target.frames.filter((frame) => frame.removedAt == null).map((frame) => frame.stableKey));
      const incoming = source.frames.filter((frame) => frame.removedAt == null && chosen.has(frame.id) && !already.has(frame.stableKey));
      if (!incoming.length) throw new Error('Those photographs are already in the collage, or could not be found.');
      const currentId = target.shoot.id;
      const idMap = new Map(incoming.map((frame) => [frame.id, `${currentId}-${newId()}`]));
      const frames = incoming.map((frame, i) => ({
        ...frame, id: idMap.get(frame.id)!, sequenceIndex: target.frames.length + i + 1,
        virtualCopy: frame.virtualCopy && idMap.has(frame.virtualCopy.originalFrameId)
          ? { ...frame.virtualCopy, originalFrameId: idMap.get(frame.virtualCopy.originalFrameId)! } : undefined,
      }));
      if (stateRef.current?.shoot.id !== currentId) return;
      await rehydrateLocalFramesFromStore(frames, provider.current!, catalogue.current!, { checkPaths: false });
      // Merge with the latest project. An edit, import or page change can complete during either read.
      mutate((current) => {
        if (current.shoot.id !== currentId) return current;
        const present = new Set(current.frames.filter(frame => frame.removedAt == null).map(frame => frame.stableKey));
        const added = frames.filter(frame => !present.has(frame.stableKey)).map((frame, i) =>
          ({ ...frame, sequenceIndex: current.frames.length + i + 1 }));
        if (!added.length) return current;
        const combined = [...current.frames, ...added];
        return { ...current, frames: combined, shoot: { ...current.shoot, totalFrames: combined.length, lastUpdatedAt: Date.now() } };
      });
    },
    updateCollage: (document) => {
      if (!readCollage(document)) { setNotice('That collage layout could not be saved.'); return; }
      mutate((current) => current.shoot.collage ? {
        ...current, shoot: { ...current.shoot, collage: document, lastUpdatedAt: Date.now() },
      } : current);
    },
    eraseDeviceData: () => {
      void (async () => {
        const result = await eraseDeviceData({
          clearCatalogue: () => catalogue.current!.clearAll(),
          storages: [window.localStorage, window.sessionStorage],
        });
        if (result.problems.length) { setNotice(`Some data could not be erased: ${result.problems.join(' ')}`); return; }
        window.location.reload();
      })().catch(() => setNotice('InFlight could not erase this device. Nothing else was changed.'));
    },
    createProjectFromFolder: () => {
      void pickFolderPhotos(setNotice).then(async (chosen) => {
        if (!chosen) return;
        const created = createEmptyProject(`project-${newId()}`, chosen.name?.trim() || 'Untitled project');
        try { await catalogue.current!.saveProject(created); } catch { setNotice('InFlight could not create the project.'); return; }
        enterProject(created);
        // The editor state lands on the next render; wait for it before adding the photos.
        for (let wait = 0; wait < 40 && stateRef.current?.shoot.id !== created.shoot.id; wait += 1) await new Promise((resolve) => setTimeout(resolve, 50));
        void importPhotos(chosen.picks);
      });
    },
    renameProject: (id, name) => {
      const clean = name.trim();
      if (!clean) return;
      void (async () => {
        const store = catalogue.current!;
        const found = await store.loadProject(id);
        if (!found) { setNotice('That project could not be found.'); return; }
        await store.saveProject({ ...found, shoot: { ...found.shoot, title: clean } });
        await loadHub();
      })().catch(() => setNotice('InFlight could not rename the project.'));
    },
    archiveProject: (id, archived) => {
      void (async () => {
        const store = catalogue.current!;
        const found = await store.loadProject(id);
        if (!found) { setNotice('That project could not be found.'); return; }
        await store.saveProject(setArchived(found, archived ? Date.now() : undefined));
        await loadHub();
      })().catch(() => setNotice('InFlight could not update the project.'));
    },
    // Delete is reversible for 30 days: the project moves to Recently deleted and nothing is removed yet.
    deleteProject: (id) => { setProjectTrashed(id, Date.now()); },
    restoreDeletedProject: (id) => { setProjectTrashed(id, undefined); },
    // Removing for good is offered only from Recently deleted, after its own confirmation.
    deleteProjectForever: (id) => {
      void catalogue.current!.deleteProject(id).then(() => { forgetLaunchProject(id); return loadHub(); }, () => setNotice('InFlight could not delete the project. Your original photos are unchanged.'));
    },
    // A copy is a Tasks job: it waits for a free slot, shows while it runs and can be cancelled before it saves.
    duplicateProject: (id) => {
      void (async () => {
        const store = catalogue.current!;
        const found = await store.loadProject(id);
        if (!found) { setNotice('That project could not be found.'); return; }
        const title = V2_STRINGS.hubMore.copyName(found.shoot.title);
        const ticket = await engineScheduler.submit({
          title: V2_STRINGS.hubMore.duplicating(found.shoot.title),
          kind: 'other', resource: 'io', pauseable: false, snapshot: undefined,
          items: [id], itemId: (item) => item, itemLabel: () => found.shoot.title,
          runItem: async (_item, _snapshot, ctx) => {
            // Read again inside the task, so the copy has every change made while it waited its turn.
            const latest = await store.loadProject(id);
            ctx.checkCancelled();
            if (!latest) throw new Error('That project could not be found.');
            await store.saveProject(duplicateProject(latest, `project-${newId()}`, title, Date.now()));
          },
        });
        if (await ticket.finished === 'done') await loadHub();
      })().catch(() => setNotice('InFlight could not update the project.'));
    },
    backToProjects: () => { void backToProjects(); },
    setHubState: (next) => setHubState(next),
    selectPhoto: (id, modifiers) => {
      const list = (stateRef.current?.frames ?? []).filter((frame) => !frame.removedAt && !pairsRef.current.rawOf.has(frame.id)).map((frame) => frame.id);
      if (modifiers?.shift && activeId) {
        // A Shift range runs through the photos on screen: a filter such as Flagged must not pull in hidden photos.
        const shown = modifiers.order ? modifiers.order.filter((entry) => list.includes(entry)) : list;
        const a = shown.indexOf(activeId), b = shown.indexOf(id);
        if (a >= 0 && b >= 0) setSelected(shown.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else if (modifiers?.ctrl) {
        setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
      } else setSelected([id]);
      mutate((current) => ({ ...current, selectedFrameId: id }));
    },
    // With a filter on (Flagged, a rating, a search), Select all selects the photos shown, never the hidden ones, so an
    // edit or export of "all" reaches only the photos the photographer can see.
    selectAllPhotos: (photoIds) => setSelected((stateRef.current?.frames ?? [])
      .filter((frame) => !frame.removedAt && !pairsRef.current.rawOf.has(frame.id) && (!photoIds || photoIds.includes(frame.id)))
      .map((frame) => frame.id)),
    clearSelection: () => setSelected(activeId ? [activeId] : []),
    setDecision: (ids, decision) => decide(ids, decision),
    removePhotos: (ids) => removePhotos(ids),
    // A move is a Tasks job. The target is saved first, so a failure part-way leaves the photos in both projects,
    // never in neither. Only then are they taken out of this project.
    movePhotos: (photoIds, targetId) => {
      const source = stateRef.current;
      if (!source || targetId === source.shoot.id) return;
      const ids = withPartners(photoIds, pairsRef.current);
      void (async () => {
        const store = catalogue.current!;
        const named = await store.loadProject(targetId);
        if (!named) { setNotice('That project could not be found.'); return; }
        const targetName = named.shoot.title;
        const ticket = await engineScheduler.submit({
          title: V2_STRINGS.filmstripLabels.moving(targetName),
          kind: 'other', resource: 'io', pauseable: false, snapshot: undefined,
          items: [targetId], itemId: (item) => item, itemLabel: () => targetName,
          runItem: async (_item, _snapshot, ctx) => {
            const target = await store.loadProject(targetId);
            if (!target) throw new Error('That project could not be found.');
            const from = stateRef.current?.shoot.id === source.shoot.id ? stateRef.current : source;
            const importId = `move-${newId()}`;
            const result = moveFrames(from, target, ids, importId);
            ctx.checkCancelled();
            if (result.moved) {
              await store.saveProject(result.target);
              ctx.acknowledgeCommitted();
              if (stateRef.current?.shoot.id === source.shoot.id) {
                mutate((current) => moveFrames(current, target, ids, importId).source);
              } else {
                const saved = await store.loadProject(source.shoot.id);
                if (saved) await store.saveProject(moveFrames(saved, target, ids, importId).source);
              }
            }
            const parts = [result.moved ? V2_STRINGS.filmstripLabels.moved(result.moved, target.shoot.title) : '',
              result.skipped ? V2_STRINGS.filmstripLabels.moveSkipped(result.skipped) : ''].filter(Boolean);
            if (parts.length) setNotice(parts.join(' '));
          },
        });
        if (await ticket.finished === 'done') setSelected([]);
      })().catch(() => setNotice('InFlight could not update the project.'));
    },
    setRemovedOpen: (open) => setRemovedOpen(open),
    restorePhotos: (ids) => {
      mutate((current) => restoreRemoved(current, withPartners(ids, rawJpegPairs(current.frames.map((frame) => ({ ...frame, removedAt: undefined }))))));
    },
    toggleFlag: (ids) => mutate((current) => ids.reduce((next, id) => {
      const frame = next.frames.find((candidate) => candidate.id === id);
      if (!frame) return next;
      // The shown photo's flag decides; its paired JPEG follows it.
      const target = frame.decision === 'keep' ? 'unreviewed' : 'keep';
      return withPartners([id], pairsRef.current).reduce((acc, member) => applyDecisionWithHistory(acc, member, target, { allowAdvance: false }), next);
    }, current)),
    correctVehicle: (photoId, choice, wholeBurst) => {
      const before = stateRef.current?.frames ?? [];
      const after = correctVehicle(before, photoId, choice, wholeBurst, VEHICLE_LABELS);
      if (after === before) return;
      const changed = after.filter((frame, index) => frame !== before[index]).length;
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: Date.now() }, frames: syncAllVehicleTags(correctVehicle(current.frames, photoId, choice, wholeBurst, VEHICLE_LABELS), VEHICLE_LABELS) }));
      setNotice(vehicleText.correct.saved(changed));
    },
    removePhotoTag: (photoId, tagId) => mutate((current) => ({
      ...current,
      shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
      frames: current.frames.map((frame) => (frame.id === photoId && !frame.removedAt ? declinePhotoTag(frame, tagId) : frame)),
    })),
    setSpeciesArea: (area: SpeciesArea) => {
      // Any choice answers "Where were these taken?" for this project, Home included, so it is not asked again.
      const home = homeRef.current;
      const before = regionIdsForArea(stateRef.current?.settings?.speciesArea, home).join(',');
      const moved = before !== regionIdsForArea(area, home).join(',');
      mutate((current) => {
        const { speciesAreaPrompt: _asked, ...settings } = current.settings ?? LEGACY_SETTINGS;
        if (sameArea(current.settings?.speciesArea, area) && current.settings?.speciesArea && !_asked) return current;
        // When the regions change, photos that only carry the app's own name are looked at again with the new place's
        // names; the person's own names, kept names and removed names stay as they are.
        const frames = moved ? reopenForNewArea(current.frames).frames : current.frames;
        return { ...current, shoot: { ...current.shoot, lastUpdatedAt: Date.now() }, frames, settings: { ...settings, speciesArea: area } };
      });
      if (moved) setNotice(speciesAreaText.changed(areaWords(area, home)));
    },
    lookAgainAtSpecies: (photoId) => {
      mutate((current) => ({
        ...current,
        shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
        frames: current.frames.map((frame) => {
          if (frame.id !== photoId || frame.removedAt) return frame;
          const next = lookAgain(frame);
          return next ? { ...frame, ...next } : frame;
        }),
      }));
    },
    correctSpeciesName: (photoId, proposedName) => {
      const name = proposedName.trim().slice(0, 120);
      if (!name) return;
      mutate((current) => ({
        ...current,
        shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
        frames: current.frames.map((frame) => {
          if (frame.id !== photoId || frame.removedAt) return frame;
          // A correction is the photographer's own label, not an unverified model suggestion.
          // Keep separate tags/evidence, but remove the former automatic name from primary display.
          const autoNames = new Set(frame.autoTags ?? []);
          const manualTags = (frame.tags ?? []).filter((tag) => !autoNames.has(tag));
          return {
            ...frame,
            subjectNames: [name],
            tags: [name, ...manualTags.filter((tag) => tag !== name)],
            autoTags: [],
            speciesChecked: true,
            subjectDisputed: false,
            speciesArea: undefined,
          };
        }),
      }));
      setNotice('Species name saved to this project.');
    },
    setRating: (given, rating) => mutate((current) => {
      const ids = withPartners(given, pairsRef.current);
      return {
      ...current,
      frames: current.frames.map((frame) => (ids.includes(frame.id) ? { ...frame, rating } : frame)),
      shoot: { ...current.shoot, lastUpdatedAt: Date.now() },
    };
    }),
    importPhotos: () => { void importPhotos(); },
    thumbnailsOnScreen,
    importFolder: () => { void pickFolderPhotos(setNotice).then((chosen) => { if (chosen) void importPhotos(chosen.picks); }); },
    watchFolder: () => {
      if (!canWatchFolder()) { setNotice(V2_STRINGS.liveShoot.notHere); return; }
      // The picker opens straight from the person's click; nothing in the folder is moved or written.
      void chooseHotFolder().then((source) => { if (source) startLiveFolder(source); });
    },
    stopWatchingFolder: () => stopLiveFolder(),
    // Wi-Fi cameras (FTP transfer): receive into a chosen folder on this computer and watch it like any hot folder.
    ...(canOpenShootRoom() ? {
      openShootRoom: () => { const title = stateRef.current?.shoot.title; if (title !== undefined) void shootRoom.open(title); },
      closeShootRoom: () => shootRoom.close(),
    } : {}),
    ...(canReceiveFromCamera() ? {
      receiveFromCamera: () => {
        void startFtpInbox().then((inbox) => { if (inbox) startLiveFolder(desktopHotFolder(inbox.folder), inbox); })
          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      },
    } : {}),
    // USB tether (desktop app, preview): the camera's own PTP link saves each new frame into a chosen folder, which is
    // then watched like any hot folder, so USB frames join the same live pipeline as Wi-Fi and tether-app frames.
    ...(canTetherUsb() && workflowPreviewOn('usbTether') ? {
      tetherCamera: () => {
        void startUsbTether((status) => {
          setLiveFolder((current) => (current ? { ...current, tether: { camera: status.camera, fetching: status.fetching?.name ?? null } } : current));
        }).then((tether) => {
          if (tether === 'noCamera') { setNotice(V2_STRINGS.liveShoot.usbNoCamera); return; }
          if (!tether) return;
          startLiveFolder(desktopHotFolder(tether.folder));
          usbTether.current = tether;
          setLiveFolder((current) => (current ? { ...current, tether: { camera: tether.camera, fetching: null } } : current));
          void tether.ended.then((reason) => {
            if (usbTether.current !== tether) return;
            usbTether.current = null;
            setLiveFolder((current) => { if (!current) return current; const { tether: _ended, ...rest } = current; return rest; });
            if (reason) setNotice(V2_STRINGS.liveShoot.usbEnded(tether.camera, reason));
          });
        }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      },
    } : {}),
    importDroppedPhotos: (files) => { if (files.length) void importPhotos(files); },
    backUpProjectNow: () => {
      const current = stateRef.current;
      if (!current) return;
      void backUpProjectNow(current).then((result) => setNotice(backupStatusText(result)));
    },
    saveProjectBackupFile: () => {
      const current = stateRef.current;
      if (!current) return;
      void saveProjectBackupFile(current).then(
        (result) => { if (result !== 'cancelled') setNotice(result === 'saved' ? V2_STRINGS.backup.fileSaved : V2_STRINGS.backup.fileDownloaded); },
        () => setNotice(V2_STRINGS.backup.fileFailed),
      );
    },
    restoreProjectBackup: (file) => {
      void file.text().then((contents) => {
        // Always a new project id, so restoring can never overwrite the project the backup came from.
        const restored = restoreProjectBackup(contents, `project-${newId()}`);
        return catalogue.current!.saveProject(restored)
          .then(() => openProject(restored.shoot.id))
          .then(() => setNotice(V2_STRINGS.backup.restored(restored.shoot.title)));
      }).catch(() => setNotice(V2_STRINGS.backup.restoreFailed));
    },
    saveXmpSidecars: (photoIds) => {
      const frames = xmpScope(stateRef.current?.frames ?? [], photoIds);
      void saveSidecars(frames).then((message) => { if (message) setNotice(message); });
    },
    readXmpSidecars: (files, photoIds) => {
      const before = stateRef.current;
      if (!before) return;
      // Every file is parsed and matched before any photo changes; a project change meanwhile cancels it.
      void planXmpImports(files, xmpScope(before.frames, photoIds), xmpScope(before.frames, [])).then((planned) => {
        const now = stateRef.current;
        if (!now || now.shoot.id !== before.shoot.id || now.shoot.lastUpdatedAt !== before.shoot.lastUpdatedAt) {
          setNotice(sidecarFailureText(null));
          return;
        }
        const { patches, kept } = sidecarEdits(now, planned);
        mutate((current) => applySidecarImports(current, planned));
        // Lightroom's basic sliders go into photos not yet edited here, each as its own Undo step.
        if (patches.size) editFrames([...patches.keys()], (frame) => applyRecipePatch(frame.edit, patches.get(frame.id) ?? {}).edit);
        setNotice([V2_STRINGS.xmp.read(planned.length), patches.size ? V2_STRINGS.xmp.editsRead(patches.size) : '',
          kept ? V2_STRINGS.xmp.editsKept(kept) : ''].filter(Boolean).join(' '));
      }, (error) => setNotice(sidecarFailureText(error)));
    },
    readLightroomCatalogue: (file) => {
      const before = stateRef.current;
      if (!before) return;
      const words = V2_STRINGS.lightroom;
      setNotice(words.reading);
      // The catalogue is read whole and matched before any photo changes; a project change meanwhile cancels it.
      void readLightroomCatalogue(file).then((photos) => {
        const now = stateRef.current;
        if (!now || now.shoot.id !== before.shoot.id || now.shoot.lastUpdatedAt !== before.shoot.lastUpdatedAt) {
          setNotice(words.failed.changed);
          return;
        }
        const plan = planLightroomImport(photos, now.frames);
        const toAdd = catalogueOnlyPhotos(photos, now.frames);
        // Photos the project does not have yet are offered next: the person chooses the folder they are in.
        lightroomPending.current = toAdd.length ? { projectId: now.shoot.id, photos, toAdd } : null;
        setLightroomOffer(toAdd.length ? { missing: toAdd.length, folder: commonFolder(toAdd) } : null);
        if (!plan.matches.length) {
          if (!toAdd.length) setNotice(words.failed.none);
          else setNotice(null);
          return;
        }
        const catalogued = photos.length - plan.virtualCopies;
        const { state: applied, result } = applyLightroomImport(now, plan, Date.now());
        // Applied only to the exact state that was matched; anything newer keeps the person's change instead.
        mutate((current) => (current === now ? applied : current));
        setNotice(lightroomNotice(words, { ...plan, unmatched: plan.unmatched - toAdd.length }, catalogued, result));
      }, (error) => setNotice(words.failed[error instanceof CatalogueReadError ? error.reason : 'unreadable']));
    },
    exportOpenFormats: () => {
      const current = stateRef.current;
      if (!current) return;
      const words = V2_STRINGS.openExport;
      void saveCatalogueExport(current).then((outcome) => {
        if (outcome !== 'cancelled') setNotice(outcome === 'saved' ? words.saved : outcome === 'nothing' ? words.nothing : words.failed);
      });
    },
    startQuickStart: () => {
      const words = V2_STRINGS.quickStart;
      // The picker opens straight from the person's click; everything after it runs on this device.
      void pickFiles().then(async (picks) => {
        if (!picks?.length) return;
        const created = createEmptyProject(`project-${newId()}`, words.projectName);
        try { await catalogue.current!.saveProject(created); }
        catch { setNotice(V2_STRINGS.quickStart.failed); return; }
        enterProject(created);
        setQuickStart({ projectId: created.shoot.id, photoId: null, phase: 'working' });
        for (let wait = 0; stateRef.current?.shoot.id !== created.shoot.id && wait < 100; wait++) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (stateRef.current?.shoot.id !== created.shoot.id) return;
        await importPhotos(picks);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const now = stateRef.current;
        const first = now?.shoot.id === created.shoot.id ? now.frames.find((frame) => frame.removedAt == null) : undefined;
        if (!first) { setQuickStart(null); return; }
        setQuickStart({ projectId: created.shoot.id, photoId: first.id, phase: 'working' });
        setAutoRequest((last) => ({ photoId: first.id, sequence: (last?.sequence ?? 0) + 1 }));
      });
    },
    dismissQuickStart: () => setQuickStart(null),
    dismissLightroomOffer: () => { lightroomPending.current = null; setLightroomOffer(null); },
    chooseLightroomFolder: () => {
      const pending = lightroomPending.current;
      const words = V2_STRINGS.lightroom;
      if (!pending) return;
      // Picked from the person's click, so the browser allows the folder picker.
      void pickFolderFiles().then(async (files) => {
        if (!files?.length) return;
        const { found, missing } = catalogueFilesInFolder(pending.toAdd, files);
        if (!found.length) { setNotice(words.noneInFolder); return; }
        lightroomPending.current = null;
        setLightroomOffer(null);
        const before = new Set((stateRef.current?.frames ?? []).map((frame) => frame.id));
        await importPhotos(found);
        await new Promise((resolve) => setTimeout(resolve, 0)); // let the last added photos reach stateRef
        const now = stateRef.current;
        if (!now || now.shoot.id !== pending.projectId) return;
        const added = now.frames.filter((frame) => !before.has(frame.id)).length;
        const plan = planLightroomImport(pending.photos, now.frames);
        const { state: applied, result } = applyLightroomImport(now, plan, Date.now());
        mutate((current) => (current === now ? applied : current));
        const catalogued = pending.photos.length - plan.virtualCopies;
        const parts = [lightroomNotice(words, { ...plan, unmatched: 0 }, catalogued, result)];
        if (missing) parts.push(words.notInFolder(missing));
        if (added < found.length) parts.push(words.notAdded(found.length - added));
        setNotice(parts.join(' '));
      });
    },
    runAutoCull: () => { void runAutoCull(); },
    addMaskLayer: (photoId, type) => { void addMask(photoId, type); },
    toggleMaskLayer: (photoId, maskId) => editMasks(photoId, (masks) => toggleMask(masks, maskId)),
    removeMaskLayer: (photoId, maskId) => editMasks(photoId, (masks) => removeMask(masks, maskId)),
    setMaskEdit: (photoId, maskId, key, value) => editMasks(photoId, (masks) => setMaskEdit(masks, maskId, key, value)),
    setMaskFeather: (photoId, maskId, percent) => editMasks(photoId, (masks) => setMaskFeather(masks, maskId, percent)),
    setMaskGeometry: (photoId, maskId, field, value) => editMasks(photoId, (masks) => setMaskGeometry(masks, maskId, field, value)),
    setMaskParts: (photoId, maskId, parts) => editMasks(photoId, masks => setMaskParts(masks, maskId, parts)),
    // As in the owner's design: starting an export closes the dialog; progress and the result continue in Tasks.
    runExport: (request) => {
      stub.actions.setExportOpen(false);
      // One step: the kit goes on each photo (its own Undo step) and the export reads the photos with it on.
      const kit = brandKitsOn && request.brandKitId ? brandKits.find((entry) => entry.id === request.brandKitId) : undefined;
      if (kit && stateRef.current && !request.rawMaster) {
        const at = Date.now();
        const result = applyBrandKitToProject(stateRef.current, kit, request.photoIds, at);
        if (result.changed) {
          stateRef.current = result.state;
          mutate((current) => applyBrandKitToProject(current, kit, request.photoIds, at).state);
        }
      }
      void runExportAction(request);
    },
    applyAssistSuggestion: applyAuto,
    ...(editStyleOn ? { resetEditStyle: forgetEditStyle } : {}),
    requestLocalAuto: (photoId) => setAutoRequest((last) => ({ photoId, sequence: (last?.sequence ?? 0) + 1 })),
    autoEdit: (photoId) => {
      // Answered at once: the status line says it is looking, then what it did.
      autoApplyWanted.current.add(photoId);
      sayAuto(photoId, 'working', engineText.workspace.checkStage);
      setAutoRequest((last) => ({ photoId, sequence: (last?.sequence ?? 0) + 1 }));
    },
    ...(cullRulesOn ? { rankCulling, applyCullRules: applyCullRulesFor } : {}),
    ...(cloudRecipeOn ? {
      prepareCloudRecipe: prepareCloudRecipeFor,
      sendCloudRecipe: (photoId: string, choice: 'send' | 'alternative') => sendCloudRecipeFor(photoId, choice),
      setCloudEdits: (choice: CloudEditsChoice) => { if (stateRef.current) mutate((current) => ({ ...current, shoot: { ...current.shoot, cloudEdits: choice } })); },
      runCloudEdits: runCloudEditsFor,
      setCloudRecipeFullFile: (on: boolean) => saveFullFileConsent(on).on,
      cloudRecipeFullFileOn: () => readFullFileConsent().on,
      cloudConsent: () => readCloudConsent().answer,
      setCloudConsent: (answer: 'yes' | 'no' | 'ask') => { saveCloudConsent(answer); return readCloudConsent().answer; },
      setCloudUsageHint: (usage: CloudUsage | undefined) => { setCloudUsageHint(usage); },
    } : {}),
    applyAllAssistSuggestions: (photoId) => applyAuto(photoId),
    sharedEditOf: (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      return frame?.edit ? JSON.parse(JSON.stringify(frame.edit)) as Record<string, unknown> : null;
    },
    sharedMarksOf: (photoId) => marksOf(stateRef.current?.frames.find((frame) => frame.id === photoId) ?? {}),
    applySharedMarks: (photoId, marks) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      if (!frame) return;
      if (frame.decision !== marks.decision) decide([photoId], marks.decision);
      if ((frame.rating ?? 0) !== marks.rating) {
        const ids = withPartners([photoId], pairsRef.current);
        mutate((current) => ({ ...current, frames: current.frames.map((f) => (ids.includes(f.id) ? { ...f, rating: marks.rating } : f)), shoot: { ...current.shoot, lastUpdatedAt: Date.now() } }));
      }
    },
    sharedPhotoExists: (photoId) => Boolean(stateRef.current?.frames.some((frame) => frame.id === photoId && frame.removedAt == null)),
    applySharedEdit: (photoId, edit) => {
      const safe = readSharedEdit(edit);
      if (safe === false) { setNotice('The shared edit for this photo could not be read, so nothing was changed.'); return; }
      editFrames([photoId], () => safe ?? undefined);
    },
    keepBothShared: (photoId, theirs) => {
      const safe = readSharedEdit(theirs);
      const current = stateRef.current;
      const source = current?.frames.find((frame) => frame.id === photoId && frame.removedAt == null);
      if (safe === false || !current || !source) { setNotice('The shared edit for this photo could not be read, so nothing was changed.'); return null; }
      // Mine becomes a virtual copy beside the photo; the photo itself takes the shared edit. Both stay, nothing is lost.
      const copy = createVirtualCopy(source, current.frames, `vc-${newId()}`);
      mutate((state) => {
        const index = state.frames.findIndex((frame) => frame.id === photoId);
        const frames = [...state.frames];
        frames.splice(index + 1, 0, copy);
        return { ...state, frames };
      });
      editFrames([photoId], () => safe ?? undefined);
      return copy.id;
    },
    importCloudPreviews: async (items) => {
      for (const item of items) cloudImports.current.set(pickedKey(pickedFromFile(item.file)), { projectId: item.projectId, photoKey: item.photoKey });
      try { await importPhotos(items.map((item) => item.file)); }
      finally { for (const item of items) cloudImports.current.delete(pickedKey(pickedFromFile(item.file))); }
    },
    attachCloudOriginal: async (photoId, original, sha256) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      if (!frame?.cloudPhoto || !provider.current || !catalogue.current || !/^[0-9a-f]{64}$/.test(sha256)) return false;
      const key = getLocalFileKey(original);
      try { await catalogue.current.saveLocalFileBlob(key, original); } catch { /* still usable this session */ }
      provider.current.registerBlob(key, original);
      const next: PhotoFrame = { ...frame, stableKey: key, filename: original.name, originalSha256: sha256, cloudPhoto: { ...frame.cloudPhoto, hasOriginal: true } };
      mutate((current) => ({ ...current, frames: current.frames.map((item) => (item.id === photoId ? { ...item, stableKey: next.stableKey, filename: next.filename, originalSha256: sha256, cloudPhoto: next.cloudPhoto } : item)) }));
      setUrls((current) => { const updated = { ...current }; delete updated[photoId]; return updated; });
      thumbs.current.requested.delete(photoId);
      thumbs.current.queue.push(next); pumpThumbnails();
      provider.current.getFullPreviewUrl(next, 'selected').then(
        (preview) => setUrls((current) => ({ ...current, [photoId]: { ...current[photoId], preview } })),
        () => { /* the thumbnail reload reports failures; the preview stays */ },
      );
      return true;
    },
    readVerifiedOriginal: async (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      if (!frame || frame.isDemo || frame.cloudPhoto || !provider.current) return null;
      const bytes = await provider.current.ensureOriginal(frame.stableKey, 'selected');
      if (!bytes) return null;
      try { return await verifyExactOriginalCopy(bytes, frame.originalSha256); } catch { return null; }
    },
    previewEnlargement: async (photoId, sizeId) => {
      const current = stateRef.current;
      if (!current || !provider.current) return { ok: false, message: engineText.workspace.exportStopped };
      const request = enlargementPreviewRequest(photoId, sizeId);
      const plan = planExport(request, current.frames, createDefaultSizes());
      if ('error' in plan) return { ok: false, message: plan.error };
      const job = plan.jobs[0];
      const variant = job?.variants[0];
      const frame = current.frames.find((candidate) => candidate.id === photoId);
      if (!job || !variant || !frame) return { ok: false, message: engineText.workspace.exportStopped };
      const snapshot = structuredClone(frame);
      const env = structuredClone(exportEnv.current);
      const sourceProvider = provider.current;
      let rendered: File | null = null;
      let failure = '';
      // Queued with exports on the same resource, so a preview never renders alongside a full-size export.
      const ticket = await engineScheduler.submit({
        title: engineText.workspace.enlargementTask, kind: 'export', location: 'local', resource: 'gpu', priority: 5, pauseable: false,
        items: [{ id: snapshot.id, name: snapshot.filename }], snapshot: { frameId: snapshot.id },
        itemId: (item) => item.id, itemLabel: (item) => item.name,
        runItem: async (_, __, ctx) => {
          try {
            const files = await renderExportJob({ frame: snapshot, job, variant, request, provider: sourceProvider,
              buildOverlay: (target, submitted) => buildOverlayDraw(target, submitted, env), started: new Date(), signal: ctx.signal,
              stage: (message) => ctx.stage(message), checkCancelled: () => ctx.checkCancelled() });
            rendered = files[0] ?? null;
          } catch (reason) {
            failure = reason instanceof Error ? reason.message : String(reason);
            throw reason;
          }
        },
      });
      const outcome = await ticket.finished;
      const file = rendered as File | null;
      if (outcome !== 'done' || !file) return { ok: false, message: failure || engineText.workspace.exportStopped };
      const bitmap = await createImageBitmap(file);
      const result: EnlargementPreviewResult = { ok: true, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height, name: file.name };
      bitmap.close();
      return result;
    },
    renderGalleryPreview: async (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId && candidate.removedAt == null);
      return frame && provider.current ? renderGalleryPreview(frame, provider.current) : null;
    },
    dismissAssistSuggestion: (photoId, suggestionId) => setAssists((current) => (current[photoId]
      ? { ...current, [photoId]: { ...current[photoId], dismissed: [...current[photoId].dismissed, suggestionId] } } : current)),
    runDeepVisionReview: (photoId) => runDeepVisionReviewAction(photoId),
    agreeAiSecondOpinion: agreeAiOpinion,
    askAiSecondOpinion: askAiOpinion,
    cancelAiSecondOpinion: cancelAiOpinion,
    applyAiSecondOpinion: applyAiOpinion,
    dismissAiSecondOpinion: () => setAiOpinion(null),
    applyAssistantSuggestions: applyProposal,
    dismissAssistantSuggestions: (name: string) => { closeProposal(name); },
    saveOverlayTemplate: (photoId, name) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      if (!frame) return;
      const next = addTemplate(templates, name, readOverlay(frame.overlay), `tpl-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)}`, Date.now());
      if (!next) { setNotice(name.trim() ? 'You have saved the most templates you can. Delete one first.' : 'Give the template a name first.'); return; }
      updateTemplates(next);
      setNotice(`Saved the template "${next[next.length - 1].name}" on this device.`);
    },
    applyOverlayTemplate: (templateId, photoIds) => {
      const template = templates.find((entry) => entry.id === templateId);
      if (!template || !photoIds.length) return;
      const at = Date.now();
      const preview = stateRef.current ? applyOverlayTemplateToProject(stateRef.current, template, photoIds, at) : null;
      if (!preview || !preview.changed) { setNotice('That overlay template is already applied to the selected photographs.'); return; }
      mutate((current) => applyOverlayTemplateToProject(current, template, photoIds, at).state);
      setNotice(`Applied "${template.name}" to ${preview.changed} photograph${preview.changed === 1 ? '' : 's'}. Each has an Undo checkpoint in its own History.`);
    },
    ...(brandKitsOn ? {
      saveBrandKit: (photoId: string, name: string) => {
        const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
        if (!frame) return false;
        const next = addBrandKit(brandKits, name, overlayForKit(readOverlay(frame.overlay), watermarkLibrary.map((preset) => preset.id)), `kit-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)}`, Date.now());
        return updateBrandKits(next, typeof next === 'string' ? '' : `Saved the brand kit "${next[next.length - 1].name}" on this device.`);
      },
      editBrandKit: (kitId: string, change: { name?: string; fromPhotoId?: string }) => {
        const frame = change.fromPhotoId ? stateRef.current?.frames.find((candidate) => candidate.id === change.fromPhotoId) : undefined;
        if (change.fromPhotoId && !frame) return false;
        const next = editBrandKit(brandKits, kitId, { name: change.name, overlay: frame ? overlayForKit(readOverlay(frame.overlay), watermarkLibrary.map((preset) => preset.id)) : undefined }, Date.now());
        return updateBrandKits(next, frame ? 'The brand kit now has this photo\'s logo, colours and text style.' : 'Renamed the brand kit.');
      },
      deleteBrandKit: (kitId: string) => { updateBrandKits(deleteBrandKit(brandKits, kitId), 'Deleted the brand kit. Photos it was put on keep their look.'); },
    } : {}),
    renameOverlayTemplate: (templateId, name) => updateTemplates(renameTemplate(templates, templateId, name)),
    deleteOverlayTemplate: (templateId) => updateTemplates(deleteTemplate(templates, templateId)),
    toggleSizeEnabled: (photoId, sizeId) => changeFormats(photoId, (raw) => toggleFormat(raw, sizeId, createDefaultSizes().find((size) => size.id === sizeId)?.enabled ?? true)),
    toggleSizeLinked,
    updateVideoZoom,
    toggleSplitFrames,
    setSplitFrameCount,
    setSplitPanOffset,
    setOriginalOutputSize: (photoId, width, height) => {
      if (!validCustomSize(width, height)) { setNotice('Use whole pixels between 1 and 20,000 for the Original output canvas.'); return; }
      changeFormats(photoId, (raw) => setOriginalOutputSize(raw, width, height));
    },
    resetOriginalOutputSize: (photoId) => {
      changeFormats(photoId, resetOriginalOutputSize);
    },
    addCustomSize: (photoId, label, width, height) => {
      if (!validCustomSize(width, height)) { setNotice('That size is not usable. Use whole pixels, from 1 to 20,000.'); return; }
      const id = `custom-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10)}`;
      if (!changeFormats(photoId, (raw) => addFormat(raw, label, width, height, id))) { setNotice('This photo already has the most formats it can hold.'); return; }
      stub.actions.setActiveSize(id);
    },
    duplicateSize: (photoId, sizeId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      const source = liveFormatsOf(frame).find((size) => size.id === sizeId);
      if (!frame || !source) return;
      const id = `custom-${newId().replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10)}`;
      if (!changeFormats(photoId, (raw) => addFormat(raw, `${source.label} copy`, source.width, source.height, id), (crops) => { const own = readCrops(crops)[sizeId]; return own ? { ...readCrops(crops), [id]: own } : readCrops(crops); })) { setNotice('This photo already has the most formats it can hold.'); return; }
      stub.actions.setActiveSize(id);
    },
    removeSize: (photoId, sizeId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      const remaining = liveFormatsOf(frame).filter((size) => size.kind === 'photo' && size.enabled && size.id !== sizeId);
      if (!remaining.length) { setNotice('A photo needs at least one format.'); return; }
      changeFormats(photoId, (raw) => removeFormat(raw, sizeId), (crops) => { const next = { ...readCrops(crops) }; if (sizeId.startsWith('custom-')) delete next[sizeId]; return next; });
      if (stub.store.activeSizeId === sizeId) stub.actions.setActiveSize(remaining[0].id);
    },
    updateSizeCrop: (photoId, sizeId, patch) => {
      const selectedSizes = stub.store.selectedSizeIds;
      changeCrops(photoId, selectedSizes.length > 1 && selectedSizes.includes(sizeId) ? selectedSizes : [sizeId], (crop) => patchCrop(crop, patch));
    },
    moveSizeArtboard: (photoId, sizeId, boardX, boardY) => mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === photoId ? { ...frame, boardPositions: moveArtboard(frame.boardPositions, sizeId, boardX, boardY) } : frame)) })),
    resetArtboardPositions: (photoId) => mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === photoId ? { ...frame, boardPositions: undefined } : frame)) })),
    resetSizeCrop: (photoId, sizeId) => changeCrops(photoId, [sizeId], () => ({ ...DEFAULT_CROP })),
    flipSelectedSizes: (photoId, axis) => changeCrops(photoId, stub.store.selectedSizeIds, (crop) => flipCrop(crop, axis)),
    rotateSelectedSizes: (photoId) => changeCrops(photoId, stub.store.selectedSizeIds, (crop) => rotateCrop(crop)),
    updateOverlay: (photoId, patch) => changeOverlay(photoId, (overlay) => patchOverlay(overlay, patch)),
    alignOverlaysCleanly: (photoId, layout) => changeOverlay(photoId, (overlay) => alignOverlays(overlay, layout)),
    moveOverlayRow: (photoId, rowId, direction) => changeOverlay(photoId, (overlay) => moveRow(overlay, rowId, direction)),
    addOverlayRow: (photoId) => changeOverlay(photoId, (overlay) => addRow(overlay, `row-${newId().slice(0, 8)}`)),
    updateOverlayRow: (photoId, rowId, patch) => changeOverlay(photoId, (overlay) => updateRow(overlay, rowId, patch)),
    removeOverlayRow: (photoId, rowId) => changeOverlay(photoId, (overlay) => removeRow(overlay, rowId)),
    detectColourEdges: async (photoId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      if (!frame || !provider.current) return 'unclear';
      // Measured on the unedited framed picture at a bounded size, then stored, so preview and export use the same numbers.
      // A RAW uses its screen-size sensor develop (analysisPicture.ts), not a full 45 MP develop.
      const image = await boundedSource(frame, provider.current);
      const framing = frame.framing ?? DEFAULT_FRAMING;
      const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
      const canvas = document.createElement('canvas');
      drawFramedPhoto(image, canvas, framing, { scale: Math.min(1, 2400 / Math.max(width, height)) });
      const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
      const [cx, cy] = canvasLensCentre(canvas.width, canvas.height, { aspect: canvas.height / canvas.width, view: { x: 0, y: 0, w: 1, h: 1 }, lensCentre: lensCentre(image.naturalWidth, image.naturalHeight, framing) });
      const found = detectLateralCa(pixels, canvas.width, canvas.height, 4, cx, cy);
      canvas.width = 0; canvas.height = 0;
      if (!found) return 'unclear';
      applyPatch([photoId], { caRed: Math.round(found.red * 100), caBlue: Math.round(found.blue * 100) });
      return found.red === 0 && found.blue === 0 ? 'clean' : 'corrected';
    },
    applyLensProfile: async (photoId, download) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      if (!frame) return 'failed';
      let db;
      try { db = await lensDatabase(download); } catch { return 'failed'; }
      if (!db) return 'needs-download';
      const found = resolveLensProfile(db, frame.exif ?? {});
      if (found.kind !== 'found') return found.kind;
      applyPatch([photoId], { lensProfile: found.profile });
      return 'applied';
    },
    addHealSpot: async (photoId, at, size) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      if (!frame || !provider.current) return { result: 'unreadable' };
      if (!canAddHealSpot(frame.edit?.heal)) return { result: 'full' };
      const r = sizeToRadius(size);
      const sources = await healSourcesFor(frame, provider.current, at, r).catch(() => null);
      if (!sources) return { result: 'unreadable' };
      if (!sources.length) return { result: 'no-source' };
      const spotId = `heal-${newId().slice(0, 8)}`;
      // Only this photo: a spot belongs to the dust or twig on the picture it was placed on.
      editFrames([photoId], (current) => ({ ...(current.edit ?? DEFAULT_EDIT), heal: addSpot(current.edit?.heal, spotId, at, r, sources[0]) }));
      return { result: 'added', spotId };
    },
    updateHealSpot: (photoId, spotId, change) => editFrames([photoId], (frame) => ({ ...(frame.edit ?? DEFAULT_EDIT), heal: changeSpot(frame.edit?.heal, spotId, change) })),
    nextHealSource: async (photoId, spotId) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      const spot = frame?.edit?.heal?.find((candidate) => candidate.id === spotId);
      if (!frame || !spot || !provider.current) return false;
      const sources = await healSourcesFor(frame, provider.current, spot, spot.r, spotId).catch(() => null);
      const next = sources ? nextHealSource(spot, sources, spot.r) : null;
      if (!next) return false;
      editFrames([photoId], (current) => ({ ...(current.edit ?? DEFAULT_EDIT), heal: changeSpot(current.edit?.heal, spotId, { source: next }) }));
      return true;
    },
    removeHealSpot: (photoId, spotId) => editFrames([photoId], (frame) => ({ ...(frame.edit ?? DEFAULT_EDIT), heal: removeSpot(frame.edit?.heal, spotId) })),
    clearHealSpots: (photoId) => editFrames([photoId], (frame) => ({ ...(frame.edit ?? DEFAULT_EDIT), heal: undefined })),
    neutralWhiteBalance: async (photoId, at) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      if (!frame || !provider.current) return 'unreadable';
      // Measured on the unedited framed picture (what the canvas shows, before the edit), at a bounded size.
      const image = await boundedSource(frame, provider.current);
      const framing = frame.framing ?? DEFAULT_FRAMING;
      const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
      const canvas = document.createElement('canvas');
      drawFramedPhoto(image, canvas, framing, { scale: Math.min(1, 1200 / Math.max(width, height)) });
      const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
      const sample = at
        ? samplePatch(pixels, canvas.width, canvas.height, at.x * (canvas.width - 1), at.y * (canvas.height - 1), Math.max(2, Math.round(Math.max(canvas.width, canvas.height) * 0.004)))
        : estimateIlluminant(pixels, canvas.width, canvas.height);
      canvas.width = 0; canvas.height = 0;
      if (!sample) return 'unreadable';
      const balance = neutralBalance(sample, frame.asShotWhite?.kelvin);
      // Only this photo: Auto is measured per picture, and a picked spot belongs to the picture it was picked on.
      applyPatch([photoId], { temperature: balance.warmth * 50, tint: balance.tint * 50, whiteBalance: balance.whiteBalance });
      return balance.limited ? 'limited' : 'set';
    },
    addImageLayer: async (photoId) => {
      const picked = await pickImageFile();
      if (!picked) return;
      try {
        const assetId = await saveLayerAsset(picked);
        const image = await createImageBitmap(picked);
        const aspect = image.height / image.width;
        image.close();
        addLayerTo(photoId, assetId, picked.name.replace(/\.[^.]+$/, ''), aspect);
      } catch (error) { setNotice(error instanceof Error ? error.message : 'That image could not be added as a layer.'); }
    },
    addPhotoLayer: async (photoId, sourcePhotoId) => {
      const source = stateRef.current?.frames.find((candidate) => candidate.id === sourcePhotoId);
      if (!source || !provider.current) return;
      try {
        // A copy of the other photo as it looks now (framing, edit and its own layers), kept on this device. Its original is only read.
        const image = await loadExportSource(source, provider.current);
        const framing = source.framing ?? DEFAULT_FRAMING;
        const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
        const scale = Math.min(1, LAYER_COPY_EDGE / Math.max(width, height));
        const canvas = document.createElement('canvas');
        drawFramedPhoto(image, canvas, framing, { scale });
        await applyCanvasExportEdit(canvas, source.edit ?? DEFAULT_EDIT, undefined, Math.max(width, height) * scale, { aspect: height / width, view: { x: 0, y: 0, w: 1, h: 1 }, lensCentre: lensCentre(image.naturalWidth, image.naturalHeight, framing) });
        await applyFrameLayers(canvas, source.overlay, true, source.edit?.masks);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
        if (!blob) throw new Error('InFlight could not copy that photo.');
        const assetId = await saveLayerAsset(blob);
        addLayerTo(photoId, assetId, source.filename, canvas.height / canvas.width, 1);
        canvas.width = 0; canvas.height = 0;
      } catch (error) { setNotice(error instanceof Error ? error.message : 'That photo could not be added as a layer.'); }
    },
    updateLayer: (photoId, layerId, patch) => changeOverlay(photoId, (overlay) => updateLayer(overlay, layerId, patch)),
    removeLayer: (photoId, layerId) => changeOverlay(photoId, (overlay) => removeLayer(overlay, layerId)),
    moveLayer: (photoId, layerId, direction) => changeOverlay(photoId, (overlay) => moveLayer(overlay, layerId, direction)),
    addCustomFont: (fontName) => {
      const name = fontName.trim();
      if (!name) return;
      if (!hasDeviceFont(name)) { setNotice(`"${name}" is not installed on this device, so it was not added.`); return; }
      setDeviceFonts((current) => { const next = [...new Set([...current, name])]; saveDeviceFonts(next); return next; });
    },
    updateSettings: (patch) => setSavedUi((current) => { const next: SavedUi = { ...current, settings: { ...current.settings, ...patch } }; saveUi(next); return next; }),
    // Inside a project this changes that project's mode only (saved with it); Settings changes the default for new ones.
    setAssistMode: (mode) => {
      if (stateRef.current) { mutate((current) => ({ ...current, shoot: { ...current.shoot, assistMode: mode } })); return; }
      setSavedUi((current) => { const next: SavedUi = { ...current, settings: { ...current.settings, defaultAssistMode: mode } }; saveUi(next); return next; });
    },
    importWatermarkImage: async (usage) => {
      const picked = await pickImageFile();
      if (!picked) return null;
      try {
        const entry = await importWatermark(picked, picked.name.replace(/\.[^.]+$/, ''), `wm-${newId().slice(0, 8)}`, usage);
        updateWatermarks((current) => [...current, entry]);
        return entry.id;
      } catch (error) { setNotice(error instanceof Error ? error.message : 'That image could not be added.'); return null; }
    },
    cutOutWatermark: async (presetId, slot, tolerance, commit) => {
      const entry = watermarkStoreRef.current.find((candidate) => candidate.id === presetId);
      if (!entry) return null;
      const result = await cutOut(entry, slot, tolerance, commit).catch(() => null);
      if (!result) return null;
      if (commit && !result.tooMuch) {
        let applied = false;
        updateWatermarks((current) => {
          const next = replaceWatermarkIfUnchanged(current, entry, result.entry);
          applied = next !== current;
          return next;
        });
        if (!applied) { setNotice('The watermark changed while this edit was processing. Please try again.'); return null; }
      }
      if (result.tooMuch) setNotice('The background is not one flat colour, so it was left as it is. Try a plain background.');
      return { url: result.url, tooMuch: result.tooMuch };
    },
    makeWatermarkVariant: async (presetId, slot) => {
      const entry = watermarkStoreRef.current.find((candidate) => candidate.id === presetId);
      const next = entry ? await makeVariant(entry, slot).catch(() => null) : null;
      if (next && entry) {
        let applied = false;
        updateWatermarks((current) => {
          const replacement = replaceWatermarkIfUnchanged(current, entry, next);
          applied = replacement !== current;
          return replacement;
        });
        if (!applied) setNotice('The watermark changed while this edit was processing. Please try again.');
      }
      else setNotice('That version could not be made.');
    },
    deleteWatermark: (presetId) => {
      updateWatermarks((current) => current.filter((candidate) => candidate.id !== presetId));
      // Photos that used it fall back to the first watermark left in the library (or none); nothing else about them changes.
      const fallback = watermarkStoreRef.current.find((candidate) => candidate.id !== presetId)?.id ?? '';
      mutate((current) => ({ ...current, frames: current.frames.map((frame) => { const overlay = readOverlay(frame.overlay); return overlay.watermarkPresetId === presetId ? { ...frame, overlay: { ...overlay, watermarkPresetId: fallback } } : frame; }) }));
    },
    addTextWatermark: (text, subtext) => {
      const entry = textWatermark(`wm-${newId().slice(0, 8)}`, text, subtext);
      if (!entry) return null;
      updateWatermarks((current) => [...current, entry]);
      return entry.id;
    },
    addWatermarkVersion: async (presetId, slot) => {
      const entry = watermarkStoreRef.current.find((candidate) => candidate.id === presetId);
      if (!entry) return false;
      const picked = await pickImageFile();
      if (!picked) return false;
      try {
        const next = await addVersion(entry, slot, picked);
        updateWatermarks((current) => current.map((candidate) => (candidate.id === presetId ? { ...candidate, forDark: next.forDark, forLight: next.forLight } : candidate)));
        return true;
      } catch { setNotice('That image could not be added.'); return false; }
    },
    setWatermarkSlot: (presetId, slot) => updateWatermarks((current) => current.map((candidate) => (candidate.id === presetId ? moveToSlot(candidate, slot) : candidate))),
    listDeviceFonts: () => listDeviceFonts(),
    hasDeviceFont: (fontName) => hasDeviceFont(fontName),
    updateRecipe: (photoId, patch) => applyPatch(editTargets(photoId), patch),
    denoisePhoto,
    applyLook: (photoId, lookId) => {
      const look = looks.find((entry) => entry.id === lookId);
      if (!look) return;
      const targets = editTargets(photoId);
      // "None" takes the photo's current look off: the sliders that look set go back to where they start.
      const previous = looks.find((entry) => entry.id === stateRef.current?.frames.find((frame) => frame.id === photoId)?.appliedLookId);
      applyPatch(targets, lookId === 'none' ? removeLookPatch(previous) : look.recipeDelta);
      mutate((current) => ({ ...current, frames: current.frames.map((frame) => (targets.includes(frame.id) ? { ...frame, appliedLookId: lookId === 'none' ? undefined : lookId } : frame)) }));
    },
    saveUserLook: (photoId, name) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      if (!frame) return false;
      const existing = userLooks.find((look) => look.name.toLocaleLowerCase('en-GB') === name.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-GB'));
      const next = saveUserLook(userLooks, name, editToRecipe(frame.edit), userLookId(), Date.now());
      if (!next) { setNotice(name.trim() ? looksText.full : looksText.needName); return false; }
      updateUserLooks(next);
      const saved = existing ? next.find((look) => look.id === existing.id)! : next[next.length - 1];
      setNotice(existing ? looksText.updated(saved.name) : looksText.saved(saved.name));
      return true;
    },
    renameUserLook: (lookId, name) => {
      const next = renameUserLook(userLooks, lookId.replace(USER_LOOK_PREFIX, ''), name);
      if (!next) { setNotice(name.trim() ? looksText.nameTaken : looksText.needName); return false; }
      updateUserLooks(next);
      return true;
    },
    deleteUserLook: (lookId) => {
      const look = userLooks.find((entry) => USER_LOOK_PREFIX + entry.id === lookId);
      if (!look) return;
      updateUserLooks(removeUserLook(userLooks, look.id));
      setNotice(looksText.removed(look.name));
    },
    exportUserLooks: () => (userLooks.length ? exportUserLooks(userLooks) : null),
    importUserLooks: (text) => {
      const result = importUserLooks(userLooks, text, userLookId, Date.now());
      if (result.error) { setNotice(result.error === 'newer' ? looksText.newer : result.error === 'not-looks' ? looksText.notLooks : looksText.unreadable); return; }
      if (!result.added && !result.replaced) { setNotice(userLooks.length >= MAX_USER_LOOKS ? looksText.full : looksText.nothingUsable); return; }
      updateUserLooks(result.looks);
      setNotice(looksText.imported(result.added, result.replaced) + (result.skipped ? looksText.skipped(result.skipped) : ''));
    },
    resetPhotoEdits: (photoId) => { const targets = editTargets(photoId); editFrames(targets, () => undefined); mutate((current) => ({ ...current, frames: current.frames.map((frame) => (targets.includes(frame.id) ? { ...frame, appliedLookId: undefined } : frame)) })); },
    // With no photo open there is nothing to copy: a neutral recipe here would let Paste silently reset another photo.
    copyRecipe: () => { if (activeFrame) setClipboard(editToRecipe(activeFrame.edit)); },
    pasteRecipe: () => { if (clipboard && activeId) applyPatch(editTargets(activeId), clipboard); },
    setBurstGrouped: (burstGroupId, grouped) => mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.burstGroupId === burstGroupId ? { ...frame, burstUngrouped: grouped ? undefined : true } : frame)) })),
    // Choosing a step in History goes back (or forward) to it, like several Undos at once; later steps stay
    // available to redo. A new version only exists when the person starts one and names it (owner, 26 Nov 2026).
    jumpToEditStep: (photoId, cursor) => {
      const at = Date.now();
      mutate((current) => ({
        ...current,
        shoot: { ...current.shoot, lastUpdatedAt: at },
        frames: current.frames.map((frame) =>
          frame.id === photoId ? syncEditGroup(jumpToStep(frame, cursor)) : frame),
      }));
    },
    // Forking makes a NEW, named version; the parent and all its later edit steps remain untouched.
    forkEditVersion: (photoId, cursor, name) => {
      const versionId = `fork-${newId()}`;
      const at = Date.now();
      mutate((current) => ({
        ...current,
        shoot: { ...current.shoot, lastUpdatedAt: at },
        frames: current.frames.map((frame) =>
          frame.id === photoId ? syncEditGroup(renameEditVersion(forkEditCheckpoint(frame, cursor, versionId, at), versionId, name)) : frame),
      }));
    },
    switchEditVersion: (photoId, versionId) => {
      const at = Date.now();
      mutate((current) => ({
        ...current,
        shoot: { ...current.shoot, lastUpdatedAt: at },
        frames: current.frames.map((frame) =>
          frame.id === photoId ? syncEditGroup(switchVersionInCatalogue(frame, versionId)) : frame),
      }));
    },
    renameEditVersion: (photoId, versionId, name) => mutate((current) => ({ ...current,
      frames: current.frames.map((frame) => (frame.id === photoId ? renameEditVersion(frame, versionId, name) : frame)) })),
    saveEditCheckpoint: (photoId, name) => {
      const at = Date.now();
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: at },
        frames: current.frames.map((frame) => (frame.id === photoId ? saveCheckpoint(frame, `checkpoint-${newId()}`, name, at) : frame)) }));
    },
    restoreEditCheckpoint: (photoId, checkpointId) => {
      const at = Date.now();
      mutate((current) => ({ ...current, shoot: { ...current.shoot, lastUpdatedAt: at },
        frames: current.frames.map((frame) => (frame.id === photoId ? syncEditGroup(restoreCheckpoint(frame, checkpointId, `checkpoint-open-${newId()}`, at)) : frame)) }));
    },
    deleteEditCheckpoint: (photoId, checkpointId) => mutate((current) => ({ ...current,
      frames: current.frames.map((frame) => (frame.id === photoId ? deleteCheckpoint(frame, checkpointId) : frame)) })),
    restoreFormatCrop: (photoId, formatId, eventAt) => {
      const frame = stateRef.current?.frames.find((candidate) => candidate.id === photoId);
      const event = readFormatHistory(frame?.formatHistory).events.find((e) => e.formatId === formatId && e.kind === 'crop' && e.at === eventAt);
      if (event?.after) changeCrops(photoId, [formatId], () => event.after!);
    },
    undo: () => {
      if (activeFrame?.editHistory && activeFrame.editHistory.cursor > 0) mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === activeFrame.id ? syncEditGroup(stepEdit(frame, -1)) : frame)) }));
      else mutate(undoDecision);
    },
    redo: () => {
      const history = activeFrame?.editHistory;
      if (history && history.cursor < history.steps.length) mutate((current) => ({ ...current, frames: current.frames.map((frame) => (frame.id === activeFrame.id ? syncEditGroup(stepEdit(frame, 1)) : frame)) }));
      else mutate(redoDecision);
    },
    cancelTask: (id) => { tasks.cancel(Number(id)); },
    clearTask: (id) => { tasks.dismissFinished(Number(id)); setTaskHistory((current) => { const { [id]: _removed, ...rest } = current; return rest; }); },
    clearCompletedTasks: () => { tasks.clearFinished(); setTaskHistory({}); },
    clearNotice: () => { setNotice(null); stub.actions.clearNotice(); },
    showNotice: (message) => setNotice(message),
  };
  const unconnected = Object.fromEntries(NOT_CONNECTED.map((name) => [name, () => setNotice('That is not connected to the InFlight engine yet. Your photos and originals are unchanged.')])) as Partial<WorkspaceActions>;
  const actions = useMemo(() => ({ ...stub.actions, ...unconnected, ...real, ...tapSelect.actions }) as WorkspaceActions,
    // `real` and `unconnected` are rebuilt each render and only close over stable refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tapSelect.actions, stub.actions, editStyleOn, forgetEditStyle, looks, userLooks, updateUserLooks, templates, updateTemplates, brandKits, brandKitsOn, updateBrandKits, watermarkLibrary, applyAuto, changeOverlay, changeCrops, stub.store.selectedSizeIds, addMask, editMasks, runAutoCull, runExportAction, runDeepVisionReviewAction, activeId, activeFrame, clipboard, selected, applyPatch, editFrames, enterProject, openProject, backToProjects, decide, importPhotos, loadHub, reconnectOriginal, agreeAiOpinion, askAiOpinion, cancelAiOpinion, applyAiOpinion, applyProposal, closeProposal]);

  exportEnv.current = { fonts: mergeFonts(deviceFonts), presets: watermarkLibrary, auto: watermarkAuto, textAllowed: featureAccess(can).overlayText, markAllowed: featureAccess(can).watermarkCustom };
  // Species names in the person's language (about 2.6 MB with every group) are fetched once, and only when a photo in
  // the project has a species name to show; the photo list is redrawn when they arrive.
  const [speciesNamesVersion, setSpeciesNamesVersion] = useState(0);
  useEffect(() => onSpeciesNamesLoaded(() => setSpeciesNamesVersion((version) => version + 1)), []);
  const hasSpeciesName = (state?.frames ?? []).some((frame) => frame.subjectNames?.length || frame.tags?.length);
  useEffect(() => { if (hasSpeciesName) void loadSpeciesNames(language); }, [hasSpeciesName]);
  const photoCache = useRef(new Map<string, { inputs: unknown[]; photo: Photo }>());
  const photos = useMemo(() => {
    const shown = (state?.frames ?? []).filter((frame) => !frame.removedAt && !pairs.rawOf.has(frame.id));
    // Exposure brackets from the camera's own settings, among the photos shown (a RAW+JPEG pair counts once).
    const brackets = bracketsByFrame(shown);
    // Rank within the shoot from Auto pick's scores (src/core/shootTiers.ts); unscored photos stay unranked.
    const tiers = shootTiers(shown);
    const nextCache = new Map<string, { inputs: unknown[]; photo: Photo }>();
    const counted = recountBursts(shown.map((frame) => {
    const bracket = brackets.get(frame.id);
    const tier = tiers.get(frame.id);
    const assist = assists[frame.id];
    const jpegId = pairs.jpegOf.get(frame.id);
    const pairedJpeg = jpegId ? state?.frames.find((candidate) => candidate.id === jpegId)?.filename : undefined;
    const beingImported = importingIds.current.has(frame.id);
    const originalConnected = frame.isDemo ? !urls[frame.id]?.failed : provider.current?.hasBlob(frame.stableKey) === true;
    const sources = { preview: provider.current?.pictureSourceOf(urls[frame.id]?.preview), thumb: provider.current?.pictureSourceOf(urls[frame.id]?.thumb) };
    const verifiedOriginalSize = verifiedRasterSizes[`${frame.stableKey}|${frame.originalSha256 ?? ''}`];
    // One photo is built again only when something of its own changed: a thumbnail arriving for one photo of 2,048 used
    // to rebuild all of them, a long task each time (the lead's stress test, 27 Nov).
    const inputs: unknown[] = [frame, urls[frame.id], assist, autoUnavailable[frame.id], watermarkAuto[frame.id], histograms[frame.id],
      pixelSizes[frame.id], verifiedOriginalSize, originalConnected, JSON.stringify(sources), fullDeveloping[frame.stableKey],
      speciesNamesVersion, pairedJpeg, tier, bracket ? JSON.stringify(bracket) : undefined, beingImported];
    const cached = photoCache.current.get(frame.id);
    if (cached && cached.inputs.length === inputs.length && cached.inputs.every((value, index) => value === inputs[index])) {
      nextCache.set(frame.id, cached);
      return cached.photo;
    }
    const built = withBracket(withPairedJpeg(pairedJpeg, withTier(tier, frameToPhoto(frame, urls[frame.id], { beingImported, assist, autoUnavailable: autoUnavailable[frame.id], watermarkAuto: watermarkAuto[frame.id], histogram: histograms[frame.id], pixelSize: pixelSizes[frame.id], verifiedOriginalSize, originalConnected, sources, dngCopy: dngCopyOffered(frame, canExportRawMaster()), fullDevelop: fullDeveloping[frame.stableKey] ? 'running' : fullDevelopPossible(frame, canDevelopRaw(), Boolean(provider.current?.hasBlob(frame.stableKey)) || frame.sourceKind !== 'file' || isDesktopApp()) ? 'possible' : undefined }))), bracket);
    nextCache.set(frame.id, { inputs, photo: built });
    return built;
  }));
  photoCache.current = nextCache;
  return counted;
  }, [state?.frames, pairs, urls, assists, autoUnavailable, watermarkAuto, histograms, pixelSizes, verifiedRasterSizes, speciesNamesVersion, fullDeveloping, importing]);
  // Photos moved to Trash: browsable and restorable from the Removed panel without walking back through Undo
  // (ROADMAP.md, "Removed photos panel" next item). Thumbnails are not fetched for them; the filename is enough
  // to recognise one in a short list, and restoring returns it to the normal, already-thumbnailed photo list.
  const removedPhotos = useMemo(() => removedFrames(state?.frames ?? []).map((frame) => frameToPhoto(frame, urls[frame.id], {})), [state?.frames, urls]);
  // "Where were these taken?": the project's choice, and a suggestion from the photos' GPS, worked out here on the device.
  const speciesPlace = useMemo(() => {
    if (!state || state.shoot.collage) return null;
    const answered = state.settings?.speciesArea;
    const area = answered ?? { kind: 'home' as const };
    // Asked only while unanswered, and only when something points elsewhere: the scan saw a species from outside the
    // home region, or the photos' GPS (read here, never sent) is outside it.
    const suggestion = answered ? null : suggestAreaFromPositions(positionsOf(state.frames), homeRegions);
    const asked = answered ? undefined : state.settings?.speciesAreaPrompt?.example;
    const prompt = asked || suggestion ? { ...(asked ? { example: displaySpeciesName(asked, speciesNameIndex()).name } : {}), suggestion } : null;
    return { area, home: homeRegions, prompt };
  }, [state, homeRegions]);
  const store: WorkspaceStore = useMemo(() => ({
    ...stub.store,
    looks,
    fonts: mergeFonts(deviceFonts),
    settings: mergeSettings(stub.store.settings, savedUi.settings),
    assistMode,
    ...(activeFrame && autoStatus[activeFrame.id] ? { autoStatus: { photoId: activeFrame.id, ...autoStatus[activeFrame.id] } } : {}),
    ...(activeFrame && denoiseStatus[activeFrame.id] ? { denoiseStatus: { photoId: activeFrame.id, ...denoiseStatus[activeFrame.id] } } : {}),
    ...(cloudRecipeOn && state ? { cloudEdits: { choice: cloudEditsChoice, covered: cloudEditsPlan.covered.length, toDo: cloudEditsPlan.toDo.length, running: cloudEditsRunning } } : {}),
    watermarkPresets: watermarkLibrary,
    overlayTemplates: templates.map(({ id, name }) => ({ id, name })),
    ...(brandKitsOn ? { brandKits: brandKits.map(({ id, name, watermarkPresetId }) => { const shown = shownLogoId({ ...readOverlay(undefined), watermarkPresetId }, watermarkLibrary.map((preset) => preset.id)); const logo = watermarkLibrary.find((preset) => preset.id === shown); return { id, name, logoLabel: logo?.label ?? 'Logo not on this device', logoMissing: !logo }; }) } : {}),
    features: { ...featureAccess(can), focusStack: can('focusStack') || focusStackPreviewOn(), panorama: can('panorama') || panoramaPreviewOn(), savedViews: can('savedViews') || workflowPreviewOn('savedViews'), nextToReview: can('nextToReview') || workflowPreviewOn('nextToReview'), hdrMerge: can('hdrMerge') || hdrPreviewOn(), onImageAdvice: can('onImageAdvice') || workflowPreviewOn('onImageAdvice') },
    featurePlan: featurePlan(),
    screen, hubState, projects,
    activeProjectId: state?.shoot.id ?? null,
    speciesPlace,
    externalEditor: externalEdits.store,
    collage: readCollage(state?.shoot.collage),
    photos,
    removedPhotos,
    removedOpen,
    activePhotoId: activeId,
    selectedPhotoIds: selected,
    reviewingPhotoIds: reviewingIds,
    aiSecondOpinion: aiOpinionView(aiSettings, aiOpinion, activeId),
    assistantSuggestions: proposalView,
    // Finished tasks join the history in an effect, one render after the store marks them done. Merge them here too,
    // so a task that has just finished is never missing from both lists (the Tasks panel would lose its row).
    tasks: visibleTasks(
      taskList.filter((task) => task.state === 'running' || task.state === 'queued' || task.state === 'paused').map(taskToInfo),
      Object.values({
        ...taskHistory,
        ...Object.fromEntries(taskList.filter((task) => task.state === 'done' || task.state === 'failed' || task.state === 'cancelled')
          .filter((task) => !taskHistory[String(task.id)])
          .map((task) => { const info = taskToInfo({ ...task, endedAt: task.endedAt ?? Date.now() }); return [info.id, info]; })),
      }),
      clock,
    ),
    canUndo: Boolean(state?.undoStack.length) || (activeFrame?.editHistory?.cursor ?? 0) > 0,
    canRedo: Boolean(state?.redoStack.length) || (activeFrame?.editHistory ? activeFrame.editHistory.cursor < activeFrame.editHistory.steps.length : false),
    clipboardRecipe: clipboard,
    PhotoSurface: EngineSurface,
    tapSelect: tapSelect.state,
    lastActionNotice: notice ?? stub.store.lastActionNotice,
    shootRoom: shootRoom.room,
    liveFolder: liveFolder && liveFolder.projectId === state?.shoot.id ? { name: liveFolder.name, imported: liveFolder.imported, arriving: liveFolder.arriving, problem: liveFolder.problem, ...(liveFolder.ftp ? { ftp: { addresses: liveFolder.ftp.addresses, port: liveFolder.ftp.port, user: liveFolder.ftp.user, password: liveFolder.ftp.password } } : {}), ...(liveFolder.tether ? { tether: { camera: liveFolder.tether.camera, fetching: liveFolder.tether.fetching } } : {}) } : null,
    quickStart: quickStart && quickStart.projectId === state?.shoot.id && screen === 'editor' ? { phase: quickStart.phase, photoId: quickStart.photoId } : null,
    lightroomOffer: lightroomOffer && lightroomPending.current?.projectId === state?.shoot.id ? lightroomOffer : null,
    backup: state ? { state: backupStatus.state, at: backupStatus.at } : null,
    searchPictureIds,
  }), [looks, searchPictureIds, backupStatus.state, backupStatus.at, stub.store, can, savedUi, assistMode, autoStatus, deviceFonts, watermarkLibrary, templates, brandKits, brandKitsOn, screen, hubState, projects, state?.shoot.id, state?.shoot.collage, state?.undoStack.length, state?.redoStack.length, activeFrame, denoiseStatus, clipboard, photos, removedPhotos, removedOpen, activeId, selected, taskList, taskHistory, clock, notice, lightroomOffer, quickStart, tapSelect.state, speciesPlace, externalEdits.store, aiSettings, aiOpinion, proposalView]);

  return { store, actions };
}
