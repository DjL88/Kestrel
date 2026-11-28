import type { CaptureProfileId } from '../../core/captureSharpen';
import type { ColourSenseNote, ColourWords } from '../engineClient/colourWords';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { LensProfile } from '../../core/lensCorrection';

// Single Contract File for InFlight UI Shell
// All components import their types ONLY from this file.
// Engine engineers swap src/stub.ts with a real WorkspaceStore + WorkspaceActions provider.

/** Culling Assistant rules: minimum quality (0 to 100), keep at least and at most N per burst. */
export interface CullRulesView { minQuality: number; keepAtLeast: number; keepAtMost: number }
export type CullRuleWhy = 'meetsQuality' | 'burstMinimum' | 'belowQuality' | 'burstFull' | 'uncertain' | 'copy' | 'yourKeep' | 'yourChoice';
export interface CullRankingRow { photoId: string; filename: string; score: number; outcome: 'keep' | 'review' | 'copy'; why: CullRuleWhy; burst: string | null }
export interface CullRankingView { rows: CullRankingRow[]; notScanned: number; newKeepers: number }

export type DecisionState = 'unreviewed' | 'keep' | 'reject';
/** Which photos the filmstrip and grid show by decision. 'to-review' is the photos with no decision yet. */
export type FilmstripFilter = 'all' | 'to-review' | 'flagged' | 'set-aside';
/** The order photos are shown in. 'shoot' is the order they were imported in; nothing is moved on disk. */
export type PhotoSort = 'shoot' | 'captured-oldest' | 'captured-newest' | 'filename' | 'rating' | 'best';
/** The engine's three-tier ranking of a photo within its shoot. Absent or null means it has not been ranked: nothing is guessed. */
export type PhotoTier = 'good' | 'better' | 'best';
/** A histogram measured from the picture's pixels: 32 bins, each 0 to 100, plus the share of pixels clipped to pure black or white. */
export interface PhotoHistogram {
  luma: number[];
  red: number[];
  green: number[];
  blue: number[];
  shadowClip: number;
  highlightClip: number;
  /** Share of pixels at 0 (shadow) or 255 (highlight) in each channel, so clipping can be said in words per channel. */
  channelClip?: Record<'red' | 'green' | 'blue', { shadow: number; highlight: number }>;
  /** 'rgb16': measured from the 16-bit RAW develop. Absent: measured from the 8-bit picture on screen. */
  precision?: 'rgb16';
}
/** 'unsupported': the original is there, but its compression can't be read yet (a JPEG XL DNG); not 'unavailable'. */
export type TileState = 'importing' | 'analysing' | 'ready' | 'unavailable' | 'unsupported';
export type AssistMode = 'solo' | 'copilot' | 'autopilot';
export type ThemeMode = 'dark' | 'light' | 'auto';
export type PanelId =
  | 'copilot'
  | 'adjust'
  | 'formats'
  | 'masks'
  | 'enhance'
  | 'overlays'
  | 'assist'
  | 'info'
  | 'history'
  | 'tasks';

export type DockPosition = 'left' | 'right' | 'float';
export type SettingsTabId =
  | 'appearance'
  | 'account'
  | 'assistance'
  | 'aiProviders'
  | 'storage'
  | 'keyboard'
  | 'previews'
  | 'presets'
  | 'formats'
  | 'language'
  | 'privacy';

export type FeatureKey =
  | 'watermarkCustom'
  | 'overlayText'
  | 'smartCulling'
  | 'speciesId'
  | 'onlineAi'
  | 'cloudAssist'
  | 'zoomVideo'
  | 'splitFrames'
  /** Preview: focus stacking (off by default). */
  | 'focusStack'
  /** Preview: panorama stitching (off by default). */
  | 'panorama'
  /** Preview: named saved views of the filmstrip's filters (off by default). */
  | 'savedViews'
  /** Preview: keys that jump to the next or previous photo still to review (off by default). */
  | 'nextToReview'
  /** Preview: HDR merge of a bracketed burst (off by default). */
  | 'hdrMerge'
  /** Preview: read-only advice drawn on the canvas (clipped areas, focus point, Colour Sense badge). Off by default. */
  | 'onImageAdvice';

/** What a cloud edit-settings job did, shown on its card (Dave, 27 Nov: make the cloud's work visible). */
export interface CloudRecipeResultView {
  /** What happened, in words. */
  message: string;
  /** The service confirmed it deleted its copy of the picture. */
  copyDeleted?: boolean;
  /** What changed, e.g. ["Exposure +0.3", "Highlights −20"]. Present when settings were applied. */
  changes?: string[];
  /** The changed settings at their old values, to show the photo as it was while "Hold to compare" is held. */
  before?: Partial<EditRecipe>;
}

/** What a cloud edit-settings job would send, shown before anything is sent. */
export interface CloudRecipeOfferView {
  status: 'ready' | 'unavailable';
  /** e.g. "1.4 MB smart preview". */
  sendLabel?: string;
  /** e.g. "3.0 MB full original": only with the full-file opt-in on and only when estimated faster. */
  alternativeLabel?: string;
  /** Why nothing can be sent, in words. */
  message?: string;
  /** Said beside the offer when the picture is not InFlight's own smart preview, e.g. a copy of the camera's built-in JPEG. */
  previewNote?: string;
}

export type SocialPlatform =
  | 'instagram'
  | 'youtube'
  | 'x'
  | 'linkedin'
  | 'tiktok'
  | 'pinterest';

export type ExportDestination =
  | 'local-zip'
  | 'local-individual'
  | 'local-folder'
  | 'share'
  | 'dropbox'
  | 'onedrive'
  | 'google-drive'
  | 'nas';

export type OverlayAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface FontOption {
  id: string;
  label: string;
  family: string;
  category: 'Sans' | 'Serif' | 'Display' | 'Mono' | 'Handwritten' | 'Custom';
  isDevice?: boolean;
}

export interface CropTransform {
  zoom: number; // 1.0 to 3.0
  panX: number; // -50 to 50 (%)
  panY: number; // -50 to 50 (%)
  insetTop: number; // 0 to 30 (%)
  insetRight: number;
  insetBottom: number;
  insetLeft: number;
  flipH: boolean;
  flipV: boolean;
  rotateDeg: number; // 0 | 90 | 180 | 270
  /** A border round this format, as a share of the format's width (0 to 10). Saved with the format; the export draws the same. */
  borderWidth?: number;
  /** The border colour as #rrggbb. */
  borderColour?: string;
  /** Border placement: all sides, top/bottom, left/right, or aspect-ratio auto-fit. */
  borderPlacement?: 'all' | 'horizontal' | 'vertical' | 'auto';
}

export interface VideoZoomConfig {
  enabled: boolean;
  focalX: number; // 0 to 100 (%)
  focalY: number; // 0 to 100 (%)
  direction: 'in' | 'out';
  durationSec: number;
}

export interface SizePreset {
  id: string;
  label: string;
  platform: SocialPlatform | 'print' | 'video' | 'custom';
  width: number;
  height: number;
  ratioLabel: string;
  kind: 'photo' | 'video';
  enabled: boolean;
  linked: boolean; // Paper-clipped to active edit group
  crop: CropTransform;
  boardX: number; // Movable position on the All-Formats canvas board (px)
  boardY: number;
}

export interface GradeRangeRecipe { hue: number; amount: number }
export interface ColourGradeRecipe { shadows: GradeRangeRecipe; midtones: GradeRangeRecipe; highlights: GradeRangeRecipe; balance: number }

export type LensProfileOutcome = 'applied' | 'needs-download' | 'no-lens' | 'not-found' | 'no-focal' | 'failed';

export interface EditRecipe {
  lookId: string;
  exposure: number; // -5.0 to +5.0 EV stops
  highlights: number; // -100 to 100
  shadows: number; // -100 to 100
  contrast: number; // -100 to 100
  whites: number; // -100 to 100
  blacks: number; // -100 to 100
  temperature: number; // -100 to 100
  tint: number; // -100 to 100
  vibrance: number; // -100 to 100
  saturation: number; // -100 to 100
  clarity: number; // -100 to 100
  sharpen: number; // 0 to 100
  /** Capture sharpening by deconvolution with the camera's profile, 0 to 100. Absent = 0. */
  captureSharpen?: number;
  /** Which camera profile capture sharpening and deblur use ('nikon-z8', 'nikon-z5ii' or 'generic'). Set from the photo's camera. */
  captureProfile?: CaptureProfileId;
  /** Mild deblur by deconvolution (never generated pixels), 0 to 100. Absent = 0. */
  deblur?: number;
  denoiseRawAi: boolean;
  /** TrueDetail AI denoise: true while a learned denoiser's stored result is blended into the subject. Set false to remove it. Absent = off. */
  aiDenoise?: boolean;
  denoiseLuminance: number; // 0 to 100
  denoiseColour: number; // 0 to 100
  upscaleFactor: 1 | 2 | 4;
  detailRecovery: number; // 0 to 100
  lensCorrection: boolean;
  /** Tone curve points [input, output], 0 to 1 on display values. Absent = straight line. */
  toneCurve?: Array<[number, number]>;
  /** Colour mixer: eight bands (red, orange, yellow, green, aqua, blue, purple, magenta), each -100 to 100. Absent = untouched. */
  colourMixer?: { hue: number[]; saturation: number[]; luminance: number[] };
  /** Advanced: colour grading. Hue 0 to 360 degrees, strength 0 to 100 per range; balance -100 (highlights) to 100 (shadows). Absent = none. */
  colourGrade?: ColourGradeRecipe;
  /** Advanced: red, green and blue curves, same points as toneCurve, applied after it. Absent = none. */
  channelCurves?: Partial<Record<'red' | 'green' | 'blue', Array<[number, number]>>>;
  /** Remove haze (positive) or add it (negative), -100 to 100. Absent = 0. */
  dehaze?: number;
  /** Lens distortion, -100 (fixes pincushion) to 100 (fixes barrel), and lens vignetting correction 0 to 100. Absent = 0. */
  lensDistortion?: number;
  lensVignetting?: number;
  /** The measured profile for this photo's lens (from lensfun), set by applyLensProfile. null in a patch removes it. */
  lensProfile?: LensProfile | null;
  /** Lens colour edges: red/cyan and blue/yellow, -100 to 100 each (set by Detect, or by hand in Advanced). Absent = 0. */
  caRed?: number;
  caBlue?: number;
  /** Remove purple and green fringes beside strong edges, 0 to 100. Absent = 0. */
  defringePurple?: number;
  defringeGreen?: number;
  /** Vignette: -100 darker edges to 100 lighter edges (with a colour, the strength of that colour). Absent = 0. */
  vignette?: number;
  /** How far the vignette reaches into the picture, 0 to 100. Absent = 50. */
  vignetteSize?: number;
  /** How much the vignette softens the edges, 0 to 100. Absent = 0. */
  vignetteBlur?: number;
  /** A colour for the vignette as #rrggbb. Absent = darker or lighter, no colour. */
  vignetteColour?: string;
  /** Vignette shape, -100 (the frame's rectangle) to 100 (a circle). Absent = 0, an oval of the frame's shape. */
  vignetteRoundness?: number;
  /** Vignette fall-off, 0 (hard) to 100 (softest). Absent = 50. */
  vignetteFeather?: number;
  /** How much bright areas are spared from a darkening or colour vignette, 0 to 100. Absent = 0. */
  vignetteHighlights?: number;
  /** Film-like grain, 0 to 100, and its size, 0 (fine) to 100 (coarse; absent = 25). */
  grain?: number;
  grainSize?: number;
  /** Grain roughness, 0 (smooth and even) to 100 (irregular). Absent = 0. */
  grainRoughness?: number;
  /** Advanced: camera calibration, hue and saturation of each primary, -100 to 100. Absent = none. */
  calibration?: Record<'red' | 'green' | 'blue', { hue: number; saturation: number }>;
  /** White balance in kelvin against the camera's as-shot estimate (RAW photos only). Absent = as shot. */
  whiteBalance?: { asShotK: number; kelvin: number };
}

export interface LookPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  previewFilter: string;
  recipeDelta: Partial<EditRecipe>;
  /** A look the person saved on this device, rather than one that comes with Kestrel. */
  mine?: boolean;
}

/** A piece of information a text row can show: a field the photo file records, what subject detection found, or the person's own words. */
export type OverlayFieldId =
  | 'camera' | 'lens' | 'aperture' | 'shutter' | 'iso' | 'focalLength'
  | 'capturedAt' | 'title' | 'filename' | 'fileFormat' | 'fileSizeMb' | 'dimensions' | 'colourProfile' | 'rating'
  | 'species' | 'category'
  | 'custom';

/** Text and watermark stacked together at the bottom, lined up on one side. */
export type OverlayStack = 'left' | 'center' | 'right';

export interface OverlayTextRow {
  id: string;
  /** In the order they are shown. */
  fields: OverlayFieldId[];
  customText: string;
  fontId: string;
  sizePx: number;
  weight: 400 | 500 | 600 | 700;
  uppercase: boolean;
  letterSpacing: number;
}

export interface OverlaySettings {
  textEnabled: boolean;
  textLayoutMode: 'as-is' | 'cover-full';
  textPosition: OverlayAnchor;
  /** 'anchor': the box's edge sits at the edge margin of the chosen place (a corner, the top, the bottom). 'free': it was
   * dragged, and textX/textY are its centre. */
  textPlacement: 'anchor' | 'free';
  /** How the rows line up inside the text box. */
  textAlign: 'left' | 'center' | 'right';
  textX: number; // 4 to 96 (% of frame width)
  textY: number; // 4 to 96 (% of frame height)
  textOffsetX: number; // -40 to 40 (%)
  textOffsetY: number; // -40 to 40 (%)
  textColour: 'light' | 'dark';
  textScrim: boolean;
  /** Camera and lens as the camera wrote them (EXIF), instead of the Auto-correct names (Settings › Auto-correct). */
  rawCameraNames?: boolean;
  rows: OverlayTextRow[];
  watermarkEnabled: boolean;
  watermarkPresetId: string;
  watermarkPosition: OverlayAnchor;
  /** As textPlacement, for the watermark. */
  watermarkPlacement: 'anchor' | 'free';
  watermarkX: number; // 4 to 96 (% of frame width)
  watermarkY: number; // 4 to 96 (% of frame height)
  watermarkOpacity: number; // 10 to 100
  watermarkScale: number; // 40 to 160 (%)
  /** 'auto' picks light or dark from the photo behind the watermark (see Photo.watermarkAuto). */
  watermarkContrast: 'light-on-dark' | 'dark-on-light' | 'auto';
  snapEnabled: boolean;
  /** Space between an anchored box and the frame's edge, as % of the frame's width (so the same distance on every side). 0 to 12. */
  edgeMargin: number;
  /** Image layers over the photo, bottom first (src/core/layers.ts). Part of the picture: in every view and export, under the text and watermark. */
  layers?: import('../../core/layers').PhotoLayer[];
}

export interface EditGroup {
  id: string;
  name: string;
  recipe: EditRecipe;
  overlay: OverlaySettings;
  sizeIds: string[];
  splitFrames: boolean;
  splitPanOffset: number; // -25 to 25 (%)
}

/** Coordinates in the framed photograph (0–1), shared with the actual mask engine. */
export type MaskGeometry =
  | { kind: 'radial'; cx: number; cy: number; rx: number; ry: number; angle: number }
  | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number };

export type MaskGeometryField = 'cx' | 'cy' | 'rx' | 'ry' | 'angle' | 'x1' | 'y1' | 'x2' | 'y2';

/** A spot-healing spot as the editor shows it. Coordinates are in the framed photograph (0–1), like masks. */
export interface HealSpotView {
  id: string;
  /** Centre of the area being covered. */
  x: number; y: number;
  /** Centre of the area the pixels are copied from. */
  sx: number; sy: number;
  /** Radius as a share of the framed photograph's long edge. */
  r: number;
  mode: 'heal' | 'clone';
  /** Size and edge softness, 0 to 100, as the panel shows them. */
  size: number;
  feather: number;
  visible: boolean;
}

export interface HealSpotChange {
  size?: number;
  feather?: number;
  mode?: 'heal' | 'clone';
  source?: { sx: number; sy: number };
  at?: { x: number; y: number };
  visible?: boolean;
}

export interface MaskLayerPart { id: string; mode: 'add' | 'subtract' | 'intersect' }

export interface MaskLayer {
  id: string;
  name: string;
  type: 'subject' | 'sky' | 'background' | 'brush' | 'area' | 'gradient';
  /** Present only for genuine editable oval/gradient masks; never fabricated for detected subjects. */
  geometry?: MaskGeometry;
  /** Other layers combined into this one, in order: add their area, subtract it, or keep only the overlap. */
  parts?: MaskLayerPart[];
  visible: boolean;
  /** Edge softness, 0 to 100. */
  feather: number;
  /** The mask's own sliders (exposure, contrast, ...), each only present when set. */
  edit: Record<string, number>;
}

export interface AssistSuggestion {
  id: string;
  title: string;
  summary: string;
  colourReadout: string;
  applied: boolean;
  recipeDelta: Partial<EditRecipe>;
  comparison?: { before: string; after: string };
  /** The same edit as ordered slider steps with real values (src/core/editingSequence.ts), for Watch and Learn. */
  steps?: { id: string; label: string; from: string; to: string; /** The recipe setting the step changes. */ key?: string }[];
  /** ColourSense: whether the suggestion keeps the subject's colour, in words (absent when it could not be judged). */
  colourSense?: ColourSenseNote;
  /** Colour match: whether the subject carries the colours it should have (species signature or the vision model), in words. */
  colourMatch?: ColourSenseNote;
  /** The vision guardian doubted this suggestion looks natural, in words. Advice only: Apply still applies it. */
  secondOpinion?: ColourSenseNote;
  /** Personal style (a preview, off by default): how this suggestion was leaned towards the person's own edits, in words. */
  styleNote?: string;
}

export interface PhotoExif {
  camera: string;
  lens: string;
  aperture: string;
  shutter: string;
  iso: number;
  focalLength: string;
  capturedAt: string;
  fileFormat: string;
  fileSizeMb: number;
  dimensions: string;
  colourProfile: string;
}

export interface Photo {
  id: string;
  /** The same photo on every device of a shared project: from the original's fingerprint (src/core/sharedSync.ts). */
  sharedKey?: string;
  /** A cloud preview of someone else's original: fine for viewing, commenting and editing, not the full file. */
  cloudPreview?: boolean;
  filename: string;
  title: string;
  previewUrl: string;
  thumbUrl: string;
  state: TileState;
  decision: DecisionState;
  originalConnected: boolean;
  rating: number; // 0 to 5
  speciesLabel?: string;
  /** The species name shown is InFlight's own suggestion, so 'Not right? Look again' is offered. */
  speciesAuto?: boolean;
  /** The place an automatic species name was matched against, in the person's words ("Species list used: Worldwide"). */
  speciesAreaLabel?: string;
  /** What kind of vehicle or aircraft it probably is, in the person's language ("Military jet: Eurofighter Typhoon (probably)"). */
  vehicleLabel?: string;
  /** The subject name alone, without the "(suggested)" marker the label may carry, for editing it. */
  speciesName?: string;
  /** The vehicle reading's ids, so a correction starts from what is shown. */
  vehicleKind?: string;
  vehicleType?: string;
  category: string;
  /** Tags InFlight worked out by itself (place, light, weather, style, genre, vehicle), already in the person's words.
   * `words` also holds the British English word, so search finds a tag in either language. */
  photoTags?: { id: string; facet: import('../../core/photoTags').TagFacet; label: string; words: string[] }[];
  sharpnessScore: number;
  exif: PhotoExif;
  /** Whether the file says it was already edited in another app, in the person's words (src/core/editStatus.ts). */
  editStatus?: { kind: import('../../core/editStatus').EditStatusKind; label: string; detail: string };
  /** Where the camera says it focused, in the person's words (src/core/cameraFocus.ts). Absent when the file does not say. */
  /** `area` is the AF box as fractions of the picture as shown (after the camera's orientation), top-left origin. */
  cameraFocus?: { label: string; detail: string; area?: { x: number; y: number; width: number; height: number } };
  activeGroupId: string;
  editGroups: EditGroup[];
  sizes: SizePreset[];
  /** A split belongs to one output format, never every copy of this photo. */
  formatSplits?: Record<string, { enabled: boolean; offset: number; count?: 3 | 4 | 5 }>;
  videoZoom: VideoZoomConfig;
  masks: MaskLayer[];
  /** Spot healing on this photo, in the order it is applied. Absent where there is no engine. */
  healSpots?: HealSpotView[];
  /** The camera's as-shot white in kelvin, estimated by InFlight's RAW decoder. Absent for JPEGs and older developments. */
  asShotKelvin?: number;
  /** Set when this photo was shot in a burst with others. `ungrouped` is the person's choice to see its frames one by one. */
  burst?: { groupId: string; index: number; count: number; ungrouped: boolean; score?: number };
  /** The photo's recorded edit steps (oldest first) and where it stands now. Absent until it has been edited. */
  editHistory?: { steps: {
    label: string; at: number;
    /** Made by Auto or brought in from Lightroom, rather than slider by slider. */
    by?: 'auto' | 'lightroom';
    /** What changed, slider by slider, with real values. */
    changes?: { label: string; from: string; to: string }[];
    /** Auto's own reasons, in the person's language. */
    why?: string[];
  }[]; cursor: number; originalAvailable?: boolean };
  /** Saved non-destructive photo-wide edit versions, all using one original. */
  editVersions?: {
    activeId: string;
    versions: { id: string; label: string; parentId: string | null; forkCursor: number; createdAt: number }[];
  };
  /** Named checkpoints of the whole editing state (recipe and every format's crop), oldest first. */
  editCheckpoints?: { id: string; name: string; createdAt: number; versionId: string }[];
  /** Actual recorded format actions; missing means pre-history, not a fabricated event. `crop` is the crop a crop action left. */
  formatHistory?: { formatId: string; kind: string; at: number; parentFormatId?: string; forkEditCursor?: number; crop?: CropTransform }[];
  /** The JPEG the camera wrote with this RAW, kept beside it and shown as one photo. Its flag and rating follow this photo. */
  pairedJpeg?: string;
  /** When the photo was taken, in milliseconds, when the file records it. Used only for sorting. */
  capturedAtMs?: number;
  /** The picture's size in real pixels, when the file says. Used for the true 100% zoom. */
  pixelSize?: { width: number; height: number };
  /** Where Auto found the subject (fractions of the picture), so the canvas can suggest a crop. Never applied by itself. */
  cropSuggestion?: { box: { x0: number; y0: number; x1: number; y1: number } };
  /** Measured from the picture as it is now. Absent until measured; the interface shows nothing rather than a guess. */
  histogram?: PhotoHistogram | null;
  /** Which picture of a RAW each view shows: the camera's embedded preview or InFlight's develop from the sensor data,
   * as recorded when the preview was made. Absent for JPEG/PNG files and while nothing is shown yet. */
  /** This photo came back from another editor: where from, when, and at what bit depth. */
  externalEdit?: import('../../core/externalEdit').ExternalEditRecord;
  /** A lossless DNG copy can be saved: a Nikon HE/HE* NEF in the desktop app. */
  dngCopy?: boolean;
  /** This photo is a focus stack made in InFlight: the photos it was made from, in order. */
  focusStack?: { sources: string[] };
  /** This photo is a panorama stitched in InFlight: the photos it was made from, in order. */
  panorama?: { sources: string[] };
  /** This photo is an HDR merge made in InFlight: its bracket, in order, with each one's measured exposure in stops. */
  hdrMerge?: { sources: Array<{ filename: string; ev: number }> };
  /** This photo is one frame of an exposure bracket found from the camera's settings: the bracket's photos in shooting order, each one's stops against the middle, and whether the camera marked it. */
  bracket?: { photoIds: string[]; ev: number[]; fromCamera: boolean };
  /** 'offered': a RAW whose full-size develop is not on screen and can be made here; 'running': it is being made. */
  fullDevelop?: 'offered' | 'running';
  picture?: { preview?: import('../../core/pictureSource').PictureProvenance; thumb?: import('../../core/pictureSource').PictureProvenance };
  /** Good, better or best, from the engine's decision maker. Shown as a word, never as a number. */
  tier?: PhotoTier | null;
  /** What 'auto' resolves to for this photo's watermark, measured on the pixels behind it. Absent until measured. */
  watermarkAuto?: 'light-on-dark' | 'dark-on-light';
  assistCritique: {
    subjectNote: string;
    colourConfidence: string;
    /** The colour check in words (main colours and findings). Shown only with the Colour-vision support setting on. */
    colourCheck?: ColourWords;
    /** Red and green areas that look alike to many colour-blind viewers, numbered and named, in the picture's fractions.
     * Outlined on the photo only with Colour-vision support on. */
    colourAreas?: Array<{ label: string; area: { x: number; y: number; width: number; height: number } }>;
    /** One plain verdict on the colours (src/core/colourVerdict.ts). Absent until the colours have been measured. */
    colourVerdict?: import('../../core/colourVerdict').ColourVerdict;
    kelvinEstimate: string;
    suggestions: AssistSuggestion[];
  };
}

export interface Project {
  kind?: 'photography' | 'collage' | 'tethered';
  id: string;
  name: string;
  updatedAt: string;
  /** The project's best favourite, at review size. Empty when no picture is cached on this device. */
  coverUrl: string;
  /** Up to three further favourites, thumbnail size, shown beside the cover in the list view. */
  sampleUrls?: string[];
  photoCount: number;
  flaggedCount: number;
  localCopyStatus: 'synced' | 'offline-ready' | 'pending';
  folderPath: string;
  /** Hidden from the main list but kept; restore brings it back. */
  archived?: boolean;
  /** Deleted: shown only in Recently deleted until restored or removed for good after 30 days. */
  trashed?: boolean;
}

export interface TaskInfo {
  id: string;
  label: string;
  /** The kind of engine work ('import', 'thumbnail', 'cull', ...), when the scheduler ran it. */
  kind?: string;
  detail: string;
  progress: number; // 0 to 100
  status: import('../../core/taskStore').TaskState;
  done?: number;
  total?: number | null;
  stage?: string;
  location?: import('../../core/taskStore').TaskLocation;
  pauseable?: boolean;
  cancellable?: boolean;
  priority?: number;
  startedAt?: number;
  items?: readonly import('../../core/taskStore').TaskItemInfo[];
  /** When it finished (ms since 1970). Finished tasks stay in the Completed tab for 4 hours or until deleted. */
  endedAt?: number;
}

export interface PanelLayoutState {
  visible: boolean;
  dock: DockPosition;
  floatX: number;
  floatY: number;
}

export interface WatermarkPreset {
  id: string;
  label: string;
  text: string;
  subtext?: string;
  /** 'image' is the person's own artwork, kept on this device. Absent means a text watermark. */
  kind?: 'text' | 'image';
  /** Artwork for dark photos (a light mark). */
  forDarkUrl?: string;
  /** Artwork for light photos (a dark mark). */
  forLightUrl?: string;
}

/** The person's own AI (key or a model on this computer), as the Assist panel shows it. */
export interface AiSecondOpinionView {
  /** none: nothing set up in Settings; consent: set up but not agreed for this destination; ready: may be asked. */
  setup: 'none' | 'consent' | 'ready';
  destination?: string;
  onThisComputer?: boolean;
  consentText?: string;
  photoId?: string;
  phase?: 'asking' | 'ready' | 'failed' | 'applied';
  message?: string;
  summary?: string;
  points?: { label: string; detail: string }[];
  /** Plain lines such as "Warmth: +0.2", exactly the values Apply would set. */
  changes?: string[];
}

export interface AssistantSuggestionsView {
  name: string;
  intro: string;
  lines: { photo: string; change: string; reason: string }[];
  more?: string;
}

export interface AiProviderConfig {
  id: 'gemini' | 'claude' | 'chatgpt' | 'local';
  name: string;
  description: string;
  connected: boolean;
  modelLabel: string;
}

export interface StorageConnector {
  id: 'dropbox' | 'onedrive' | 'google-drive' | 'nas';
  name: string;
  status: 'connected' | 'not-connected';
  accountLabel?: string;
}

export interface WorkspaceSettings {
  theme: ThemeMode;
  /** Calm View, the preset. Switching it sets the parts below together; each part can then be changed on its own. */
  calmView: boolean;
  /** Less movement: no slides, fades or spinners in the workspace (the operating system's reduce-motion setting does the same). */
  calmMotion: boolean;
  /** Fewer badges: leave out the Ready label on finished photos. Labels that need action always show. */
  calmBadges: boolean;
  /** Fewer hints: hide the tips drawn on the canvas. */
  calmHints: boolean;
  /** Hide the numbers beside sliders. Separate from the preset, because many people find exact values calming. */
  calmReadouts: boolean;
  /** Focus mode: the filmstrip's row keeps photos, Import and Folder, and the rest sits under More. Unset: on for phones. */
  filmstripFocus?: boolean;
  touchDensity: 'comfortable' | 'compact';
  /** Which side the tool rail is on. 'left' mode puts it on the right so a pencil or a left hand does not catch it. */
  hand: 'right' | 'left';
  cvdGuidance: boolean;
  /** Basic accounts only: leave locked Pro features (and their badges) out of the interface. */
  hideProFeatures: boolean;
  /** Show the advanced editing controls (colour grading, channel curves). Off by default so the panel stays simple. */
  advancedControls: boolean;
  /** Move to the next photo after a rating or decision on one photo (culling). */
  advanceAfterDecision: boolean;
  /** A quick one-finger flick across the photo steps to the next or previous photo (touch screens). On by default. */
  swipeBetweenPhotos: boolean;
  /** Game controllers (Gamepad API) run commands: Settings > Keyboard > Game controller. On unless turned off; nothing happens until a controller is connected. */
  gamepadEnabled?: boolean;
  /** Settings > Keyboard > Macro pad keys: the pad's keys run their actions. On unless turned off (plug and play). */
  padKeysEnabled?: boolean;
  ongoingCritique: boolean;
  defaultAssistMode: AssistMode;
  language: 'en-GB' | 'en-US' | 'de-DE' | 'fr-FR';
  account: {
    signedIn: boolean;
    provider?: 'google' | 'apple' | 'email';
    email?: string;
    displayName?: string;
    /** This month's cloud allowances and balance, from the control plane once signed in. Absent: the section is hidden. */
    cloud?: import('../../core/cloudPlan').CloudUsage;
  };
  aiProviders: AiProviderConfig[];
  storageConnectors: StorageConnector[];
  localCacheLimitGb: number;
}

export interface ExportRequest {
  /** Standalone, photo-wide 16-bit file made from the selected sensor RAW. */
  rawMaster?: boolean;
  /** Which 16-bit file the RAW master is written as. Absent = TIFF. */
  rawMasterFormat?: 'tiff' | 'png';
  fileFormat?: 'jpeg' | 'png';
  jpegQuality?: number;
  destination: ExportDestination;
  groupIds: string[];
  sizeIds: string[];
  includeBefore: boolean;
  includeAfter: boolean;
  includeOverlay: boolean;
  includeWatermark: boolean;
  includeVideo: boolean;
  /** Copy the exact original file (as shot). Never a developed or preview file. */
  includeOriginal?: boolean;
  /** Shrink the longer side of an edited/unedited size to this many pixels, keeping its aspect ratio. Never upscales: a
   * format already smaller than this is exported at its own size. Unset or 0 means full size (no cap). Never applies to
   * the exact original file. */
  maxLongestEdgePx?: number;
  photoIds: string[];
  /** A brand kit put on these photos first, as one Undo step on each, so the export carries it (K080). */
  brandKitId?: string;
  /** Captions and credits (IPTC) written into each JPEG or PNG, with code replacements. Absent = none. */
  captions?: import('../../core/captionTemplate').CaptionTemplate;
}

/** How a photo is drawn. The engine supplies this so the canvas shows real, developed pixels; without it the UI falls back
 * to a plain image with a CSS filter. 'original' is the photo with no edit, 'edited' is with its recipe. */
/** One tap on the framed photo, as shares (0 to 1) of its width and height. */
export interface TapPoint { x: number; y: number; add: boolean }

export interface TapSelectState {
  /** 'unavailable': this build does not offer the pack; 'not-downloaded': offered, the person has not chosen to download it. */
  pack: 'unavailable' | 'not-downloaded' | 'downloading' | 'ready' | 'failed';
  /** 0 to 1 while downloading. */
  downloadProgress?: number;
  /** Plain words for the last failure. */
  message?: string;
  /** The photo being selected on, if any. Each subject is its own reversible subject mask. */
  session?: {
    photoId: string;
    /** 'reading': the model is reading the photo once (the slow step); 'working': answering a tap. */
    phase: 'reading' | 'ready' | 'working' | 'failed';
    mode: 'add' | 'remove';
    subjects: Array<{ maskId: string; taps: TapPoint[] }>;
    /** Index into subjects of the one taps go to; a new subject starts on the next added tap. */
    active: number;
    /** The fine-edge pack is refining the first tap's outline in the background; taps still work meanwhile. */
    refining?: boolean;
  };
}

export interface PhotoSurfaceProps {
  /** Editor-only coverage guide, never part of the photo recipe or export. */
  maskGuideId?: string;
  /** The guide as a line round the mask (the V2 default) or the hatched area. */
  maskGuideStyle?: 'outline' | 'fill';
  /** Editor-only SVG content (mask outline and handles) drawn in the displayed picture's own pixels, over exactly that picture. */
  maskOutline?: (picture: { width: number; height: number }) => ReactNode;
  photoId: string;
  variant: 'edited' | 'original';
  /** Non-destructive live preview of a hovered Look. Never stored or applied to original pixels. */
  lookPreview?: Partial<EditRecipe>;
  alt: string;
  className?: string;
  style?: CSSProperties;
  /** Called with the shown picture's pixel size (framed, upright) whenever a picture loads, the small interim one included. */
  onPictureSize?: (size: { width: number; height: number }) => void;
  /** True while the picture is still loading or being redrawn (a develop or an edit), false once it is on screen. */
  onBusyChange?: (busy: boolean) => void;
  /** True while the zoomed-in part of the photo is being drawn at full detail from the full-resolution picture. */
  onDetailLoading?: (loading: boolean) => void;
}

export type HubViewState = 'ready' | 'empty' | 'loading' | 'error';

/** Where a project's photos were taken, for species names. The suggestion comes from GPS read on this device, and is only used after one tap. */
export interface SpeciesPlace {
  area: import('../../core/speciesArea').SpeciesArea;
  home: string[];
  /** The one small question, shown only when the scan saw a species from elsewhere (`example`, in the person's words)
   * or the photos' GPS is outside home (`suggestion`), and the place is not answered yet. */
  prompt: { example?: string; suggestion: import('../../core/speciesArea').SpeciesArea | null } | null;
}

export interface WorkspaceStore {
  screen: 'hub' | 'editor';
  hubState: HubViewState;
  projects: Project[];
  activeProjectId: string | null;
  /** The open project's "Where were these taken?" choice, the home regions it falls back to, and a GPS suggestion. */
  speciesPlace?: SpeciesPlace | null;
  /** Editing in another app: the apps chosen before and the photos out in one now. Absent where it cannot work (the web). */
  externalEditor?: {
    apps: import('../../core/externalEdit').ExternalApp[];
    watching: Record<string, { appName: string; state: 'sending' | 'waiting' | 'saving' | 'bringing-back'; returned: number }>;
  } | null;
  /** Present only when the active project is a collage; normal Photography workspaces remain unchanged. */
  collage?: import('../../core/collage').CollageDocument | null;
  photos: Photo[];
  activePhotoId: string | null;
  selectedPhotoIds: string[];
  activeSizeId: string;
  selectedSizeIds: string[];
  canvasLayoutMode: 'single' | 'all-formats';
  bottomTab: 'filmstrip' | 'info';
  assistMode: AssistMode;
  /**
   * What Auto last did for the open photo (the Auto button or Auto-pilot), so a press is always answered: working,
   * applied, left unchanged with the reason, or not possible with the reason. Absent until Auto has looked.
   */
  autoStatus?: {
    photoId: string; state: 'working' | 'applied' | 'unchanged' | 'unavailable'; text: string;
    /** Set when Co-pilot or Auto-pilot looked by itself (not a press of the Auto button). */
    mode?: 'copilot' | 'autopilot';
    /** When this was said, in ms since the epoch. */
    at?: number;
    /** The time of the edit step Co-pilot or Auto-pilot recorded, so the banner can tell its step from a later one. */
    appliedAt?: number;
  };
  /**
   * Why the last Denoise left the open photo as it was, in the person's words: no visible noise found (the panel then offers
   * "Denoise anyway") or a RAW not developed yet (the panel says to wait for the develop). Absent otherwise.
   */
  denoiseStatus?: { photoId: string; state: 'no-visible-noise' | 'waiting-develop'; text: string };
  /** Cloud edits for the open project. Absent while cloud edit settings are off or no project is open. */
  cloudEdits?: { choice: import('../../core/cloudEditsChoice').CloudEditsChoice; covered: number; toDo: number; running: boolean };
  features: Record<FeatureKey, boolean>;
  /** Which plan each feature belongs to, so the UI can mark Pro features with the Pro badge. Basic or Pro only. */
  featurePlan: Record<FeatureKey, 'basic' | 'pro'>;
  looks: LookPreset[];
  hoveredLookId: string | null;
  fonts: FontOption[];
  watermarkPresets: WatermarkPreset[];
  /** Saved overlay templates on this device (name only; the layout stays inside the store). */
  overlayTemplates: Array<{ id: string; name: string }>;
  /** Saved brand kits on this device (K080): name and the logo they use. Absent while the brand-kits preview is off. */
  brandKits?: Array<{ id: string; name: string; logoLabel: string; /** True when no watermark on this device can be drawn, so Export puts no logo. */ logoMissing?: boolean }>;
  tasks: TaskInfo[];
  /** Photos whose deep vision review is running right now (empty when none). */
  reviewingPhotoIds: string[];
  /** Bring your own AI, in the real workspace only: set-up state and the answer for the photo on screen. */
  aiSecondOpinion?: AiSecondOpinionView;
  /** The oldest set of suggestions an AI assistant left for this project, in words; absent when there are none. */
  assistantSuggestions?: AssistantSuggestionsView;
  settings: WorkspaceSettings;

  // Shell UI layout state
  activePanel: PanelId | null;
  panels: Record<PanelId, PanelLayoutState>;
  filmstripCollapsed: boolean;
  filmstripHeight: number;
  filmstripFilter: FilmstripFilter;
  /** Show only photos rated at least this many stars (0 shows every rating). */
  filmstripMinRating: number;
  filmstripSort: PhotoSort;
  filmstripSearch: string;
  /** Photos whose picture matches the search words (search by description, on this device). Absent or null: words only. */
  searchPictureIds?: string[] | null;
  /** Show only photos with this tag id; null shows all. */
  filmstripTag?: string | null;
  gridViewOpen: boolean;
  compareMode: boolean;
  canvasZoom: number; // 0.5 to 3.0
  isFullScreen: boolean;
  exportOpen: boolean;
  /** Photos moved to Trash (removed from the catalogue, original untouched) that can be browsed and restored
   * without walking back through per-photo Undo. Empty once nothing is removed. */
  removedPhotos: Photo[];
  removedOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTabId;
  activeMaskTool: 'subject' | 'sky' | 'background' | 'brush' | 'eraser' | 'area' | 'gradient';
  /** Tap-to-select (optional EfficientSAM-Ti pack). Absent where the engine does not offer it. */
  tapSelect?: TapSelectState;
  canUndo: boolean;
  canRedo: boolean;
  clipboardRecipe: EditRecipe | null;
  lastActionNotice: string | null;
  /** After reading a Lightroom catalogue: how many of its photos are not in this project yet, and where Lightroom keeps them. */
  lightroomOffer?: { missing: number; folder: string } | null;
  /** First run: InFlight is adding the picked photos and running Auto on the first ('working'), has applied Auto ('ready'),
   * found the photo already looked natural and left it ('unchanged'), held its suggestion because the vision guardian
   * doubted it ('held'), or could not check it ('failed'). */
  quickStart?: { phase: 'working' | 'ready' | 'unchanged' | 'held' | 'failed'; photoId: string | null } | null;
  /** Live shoot: the folder being watched for new frames, how many have arrived, how many are still being written, and
   * whether the folder can be read just now (a drive unplugged mid-shoot). Absent when nothing is watched. */
  /** Live shoot room: the links other screens on this network open, and how many frames are showing there. */
  shootRoom?: { links: { address: string; url: string }[]; shown: number } | null;
  liveFolder?: { name: string; imported: number; arriving: number; problem: boolean; ftp?: LiveFtpInbox; tether?: LiveTether } | null;
  /** The open project's automatic backup, as last reported. Absent when no project is open. */
  backup?: { state: 'idle' | 'working' | 'ok' | 'partial' | 'failed'; at?: number } | null;
  /** Optional engine-supplied renderer for the canvas (see PhotoSurfaceProps). */
  PhotoSurface?: ComponentType<PhotoSurfaceProps>;
}

/** A camera tethered by USB feeding the watched folder: its name, and the file being fetched from it now. */
export interface LiveTether { camera: string; fetching: string | null }

/** What to type into a Wi-Fi camera's FTP transfer settings while InFlight's inbox is on (desktop app). */
export interface LiveFtpInbox { addresses: string[]; port: number; user: string; password: string }

export interface WorkspaceActions {
  // Navigation & Projects
  openProject: (projectId: string) => void;
  backToProjects: () => void;
  /** `mode` is the new project's Flight mode; absent, it starts in Settings' default. */
  createProject: (name: string, kind?: 'photography' | 'collage' | 'tethered', mode?: AssistMode, cloudEdits?: import('../../core/cloudEditsChoice').CloudEditsChoice) => void;
  /** Cloud edits for the open project: which photos a run covers. Absent while cloud edit settings are off. */
  setCloudEdits?: (choice: import('../../core/cloudEditsChoice').CloudEditsChoice) => void;
  /** Runs Cloud edits now for the photos still to do. One row in Tasks. Returns what happened, in words. */
  runCloudEdits?: () => Promise<string>;
  createCollageFromSelection?: (photoIds: string[]) => void;
  /** Focus stack the chosen photos into a new linked photo, as a background task (preview, behind its flag). */
  focusStackPhotos?: (photoIds: string[]) => void;
  /** Stitch the chosen photos into a new linked panorama, as a background task (preview, behind its flag). */
  stitchPanorama?: (photoIds: string[]) => void;
  /** Merge the chosen bracket into a new linked 16-bit HDR photo, as a background task (preview, behind its flag). */
  hdrMergePhotos?: (photoIds: string[]) => void;
  exportCollage?: (request: import('../engineClient/exportCollage').CollageExportRequest) => Promise<void>;
  updateCollage?: (document: import('../../core/collage').CollageDocument) => void;
  browseCollageProjectPhotos?: (sourceProjectId: string) => Promise<Array<{ id: string; filename: string }>>;
  addCollageProjectPhotos?: (sourceProjectId: string, photoIds: string[]) => Promise<void>;
  /** Pick a folder (on this device, an external drive or a synced cloud folder) and make a project of its photos. */
  createProjectFromFolder: () => void;
  renameProject: (projectId: string, name: string) => void;
  archiveProject: (projectId: string, archived: boolean) => void;
  /** Moves the project to Recently deleted for 30 days. Nothing is removed yet; original files are never touched. */
  deleteProject: (projectId: string) => void;
  /** A separate, complete copy named "… (copy)", made as a task in Tasks. Stored photo copies are shared. */
  duplicateProject: (projectId: string) => void;
  /** Takes a project back out of Recently deleted, as it was. */
  restoreDeletedProject: (projectId: string) => void;
  /** Removes InFlight's catalogue entry and its stored copies now. Original files are never touched. */
  deleteProjectForever: (projectId: string) => void;
  setHubState: (state: HubViewState) => void;

  // Photos, Culling & Selection
  /** `order` is the photos as the filmstrip or grid shows them, so a Shift range covers only what is on screen. */
  selectPhoto: (photoId: string, modifiers?: { ctrl?: boolean; shift?: boolean; order?: readonly string[] }) => void;
  /** Make this photo the one keys act on, without changing which photos are selected (the chosen side of a two-photo compare). */
  focusPhoto: (photoId: string) => void;
  /** Select every photo shown, or only `photoIds` (the photos the current filter shows) when given. */
  selectAllPhotos: (photoIds?: readonly string[]) => void;
  clearSelection: () => void;
  setDecision: (photoIds: string[], decision: DecisionState) => void;
  /** Moves already set-aside (rejected) photos into Trash. The catalogue entry is removed; InFlight's stored copies
   * go with it, but the original file on disk is never touched. Reversible with the normal per-photo Undo. */
  removePhotos: (photoIds: string[]) => void;
  /** Moves photos (with their paired JPEG and copies, choices and edits) to another project, as a task in Tasks.
   * A photo whose file is already there stays here. Original files are never touched. */
  movePhotos?: (photoIds: string[], targetProjectId: string) => void;
  toggleFlag: (photoIds: string[]) => void;
  setRating: (photoIds: string[], rating: number) => void;
  correctSpeciesName: (photoId: string, name: string) => void;
  /** 'Not right? Look again': drop the automatic species name for good and let the species scan look at the photo again. */
  lookAgainAtSpecies?: (photoId: string) => void;
  /** "Where were these taken?" for the open project; species names are matched against that place from now on. */
  setSpeciesArea?: (area: import('../../core/speciesArea').SpeciesArea) => void;
  /** The person's own vehicle name for a photo, or for every frame of its burst. 'not-a-vehicle' removes it for good. */
  correctVehicle: (photoId: string, choice: { kind: string; type?: string } | 'not-a-vehicle', wholeBurst: boolean) => void;
  /** The person removes a tag InFlight found: it goes and is never added to that photo again. */
  removePhotoTag?: (photoId: string, tagId: string) => void;
  importPhotos: () => void;
  /** The photos whose tiles are on screen now (filmstrip, grid): their thumbnails come first. Optional for older stubs. */
  thumbnailsOnScreen?: (photoIds: readonly string[]) => void;
  importFolder: () => void;
  /** Live shoot: watch a folder a tether app (or the FTP inbox) writes into, importing each finished frame as it lands. */
  watchFolder?: () => void;
  stopWatchingFolder?: () => void;
  /** Live shoot over Wi-Fi: receive frames a camera sends by FTP into a chosen folder (desktop app only). */
  receiveFromCamera?: () => void;
  /** Live shoot room: show the shoot on other screens on this network (a client's iPad, a studio screen); desktop app. */
  openShootRoom?: () => void;
  closeShootRoom?: () => void;
  /** Live shoot over USB: save each frame the connected camera takes into a chosen folder and watch it (desktop app, preview). */
  tetherCamera?: () => void;
  importDroppedPhotos: (files: File[]) => void;
  /** Back the open project up now to this device (and its chosen place), checking the saved copy reads back the same. */
  backUpProjectNow: () => void;
  /** Save the open project's catalogue (decisions, edits, links; never photos) as a .kestrel.json file. */
  saveProjectBackupFile: () => void;
  /** Make a new project from a .kestrel.json backup file and open it. The backed-up project is never overwritten. */
  restoreProjectBackup: (file: File) => void;
  /** Save ratings, flags and confirmed tags as XMP sidecars (the selection when two or more are selected, else the whole project). */
  saveXmpSidecars: (photoIds: string[]) => void;
  /** Read ratings, flags and tags from chosen .xmp files (or one .zip) for matching photos. Every file is checked before anything changes. */
  readXmpSidecars: (files: File[], photoIds: string[]) => void;
  /** Bring ratings, flags, keywords, collections and basic edits in from a Lightroom Classic catalogue (.lrcat) for the photos
   * already in this project. The catalogue is only read; choices already made in InFlight are kept. */
  readLightroomCatalogue: (file: File) => void;
  /** Choose the folder Lightroom keeps the catalogue's photos in: add those photos, then bring in their details. */
  chooseLightroomFolder?: () => void;
  dismissLightroomOffer?: () => void;
  /** Save the whole project's ratings, flags, keywords and edit recipes in open formats (XMP with Camera Raw settings, CSV, JSON). */
  exportOpenFormats?: () => void;
  /** First run: pick photos; InFlight makes a project, adds them and runs Auto on the first one. */
  startQuickStart?: () => void;
  dismissQuickStart?: () => void;
  runAutoCull: () => void;
  /** Culling Assistant (x-std-cull-rules, a preview off by default; present only while it is on): rank every judged
   * photo under the rules from stored observations, with no new scan. Cheap enough to call on every slider movement. */
  rankCulling?: (rules: CullRulesView) => CullRankingView;
  /** Keep the photos the rules propose, as one step that Undo takes back. Never rejects. Returns how many were kept. */
  applyCullRules?: (rules: CullRulesView) => number;
  /** Finish my best (a preview off by default; present only while it is on): plan, run and review one best-first batch. */
  finishBest?: import('../engineClient/useFinishBest').FinishBestControl;
  reconnectOriginal: (photoId: string) => void;
  /** Save a lossless DNG copy of a Nikon HE/HE* NEF (desktop). The original is only read. */
  saveDngCopy: (photoId: string) => void;
  /** Desktop: send a 16-bit TIFF of the current edit to another app and bring each save back as a new photo. */
  editInOtherApp?: (photoId: string, app: import('../../core/externalEdit').ExternalApp | 'choose' | 'default') => void;
  /** Stop watching the file sent to another app. The file stays in InFlight's working folder. */
  stopExternalEdit?: (photoId: string) => void;
  /** Develop a RAW from its sensor data at full size, as one Tasks item. The original is only read. */
  developFullSize: (photoId: string) => void;
  toggleDemoUnavailable: () => void;

  // Flight Mode & Deep Vision Review
  setAssistMode: (mode: AssistMode) => void;
  runDeepVisionReview: (photoId: string) => void;
  applyAssistSuggestion: (photoId: string, suggestionId: string) => void;
  requestLocalAuto?: (photoId: string) => void;
  /** One-click Auto: checks the photo on this device and applies Natural Auto as one undoable step, or says why not. */
  autoEdit?: (photoId: string) => void;
  /** Bring your own AI (present only in the real workspace): agree, by host name, to send a small preview there. */
  agreeAiSecondOpinion?: () => void;
  /** Ask the person's own AI about this photo's colour and light. Advisory only: nothing changes until Apply. */
  askAiSecondOpinion?: (photoId: string) => void;
  cancelAiSecondOpinion?: () => void;
  /** Apply the checked, one-small-step suggestion as one undoable edit; refused if the photo changed since. */
  applyAiSecondOpinion?: (photoId: string) => void;
  dismissAiSecondOpinion?: () => void;
  /** Suggestions an AI assistant left through the MCP tool: apply them all (decisions undoable), or dismiss. */
  applyAssistantSuggestions?: (name: string) => void;
  dismissAssistantSuggestions?: (name: string) => void;
  /** Personal style (a preview, off by default; present only while it is on): forget everything learnt on this device. */
  resetEditStyle?: () => void;
  /** Cloud edit settings (preview, off by default): what would be sent and its size. Sends nothing. Absent while the feature is off. */
  prepareCloudRecipe?: (photoId: string) => Promise<CloudRecipeOfferView>;
  /** Sends the option the person pressed and applies the settings that come back as one undoable step. Returns what happened, in words. */
  sendCloudRecipe?: (photoId: string, choice: 'send' | 'alternative') => Promise<CloudRecipeResultView>;
  /** The separate opt-in for sending full originals. Returns what is in force afterwards. */
  setCloudRecipeFullFile?: (on: boolean) => boolean;
  cloudRecipeFullFileOn?: () => boolean;
  /** The remembered answer to "Use InFlight's cloud for this?" (asked once, never pre-ticked). */
  cloudConsent?: () => import('../../core/cloudConsent').CloudConsentAnswer;
  /** Remember yes or no, or forget the answer ('ask'). Returns what is in force afterwards. */
  setCloudConsent?: (answer: 'yes' | 'no' | 'ask') => import('../../core/cloudConsent').CloudConsentAnswer;
  /** The month's cloud numbers, so a run covers the best photos the allowance can pay for. */
  setCloudUsageHint?: (usage: import('../../core/cloudPlan').CloudUsage | undefined) => void;
  applyAllAssistSuggestions: (photoId: string) => void;
  /** A sized JPEG of the edited photo for a client gallery, or null when there is no trustworthy picture yet. Absent in the stub. */
  renderGalleryPreview?: (photoId: string) => Promise<Blob | null>;
  /** Render this photo's format exactly as export will (Output scale included) and return the picture. Absent in the stub. */
  previewEnlargement?: (photoId: string, sizeId: string) => Promise<import('../engineClient/enlargementPreview').EnlargementPreviewResult>;
  /** The photo's whole edit as plain data for a shared project, or null when it has no edit. Absent in the stub. */
  sharedEditOf?: (photoId: string) => Record<string, unknown> | null;
  /** False once the photo is no longer in this catalogue, so a queued shared edit waits instead of sharing "no edit". */
  sharedPhotoExists?: (photoId: string) => boolean;
  /** Replace the photo's edit with a shared one (or clear it). Recorded as an edit step, so it can be undone. */
  applySharedEdit?: (photoId: string, edit: Record<string, unknown> | null) => void;
  /** On a clash: keep this device's edit as a virtual copy beside the photo, and give the photo the shared edit. Returns the copy's id. */
  keepBothShared?: (photoId: string, theirs: Record<string, unknown> | null) => string | null;
  /** The photo's star rating and pick/set-aside as shared beside its edit in a shared project. Absent in the stub. */
  sharedMarksOf?: (photoId: string) => import('../../core/sharedMarks').SharedMarks;
  /** Set the rating and pick/set-aside that came from a shared project. The pick is an undoable decision step. */
  applySharedMarks?: (photoId: string, marks: import('../../core/sharedMarks').SharedMarks) => void;
  /** Add photos fetched from a shared project's cloud store to this project, linked to the owner's originals. */
  importCloudPreviews?: (items: { file: File; projectId: string; photoKey: string }[]) => Promise<void>;
  /** The photo's exact original bytes, checked against its fingerprint, or null when the original is not connected. */
  readVerifiedOriginal?: (photoId: string) => Promise<Blob | null>;
  /** Put the owner's original (already checked against its fingerprint) behind a cloud preview, keeping its edits and shared identity. */
  attachCloudOriginal?: (photoId: string, original: File, sha256: string) => Promise<boolean>;
  dismissAssistSuggestion: (photoId: string, suggestionId: string) => void;

  // Editing & Looks
  updateRecipe: (photoId: string, patch: Partial<EditRecipe>, label?: string) => void;
  /** Denoise this photo now. Signed in with the cloud feature on, the press is the consent to upload a working-size copy for this job; the device is the fallback. `anyway` denoises a photo whose noise read as not visible, at a gentle strength, through the same checks. */
  denoisePhoto: (photoId: string, options?: { anyway?: boolean }) => void;
  applyLook: (photoId: string, lookId: string) => void;
  /** Your own looks, kept on this device. Each returns false (with a notice) when it was refused. */
  saveUserLook?: (photoId: string, name: string) => boolean;
  renameUserLook?: (lookId: string, name: string) => boolean;
  deleteUserLook?: (lookId: string) => void;
  /** The looks file text, or null when there are no looks of your own to save. */
  exportUserLooks?: () => string | null;
  importUserLooks?: (text: string) => void;
  setHoveredLook: (lookId: string | null) => void;
  resetPhotoEdits: (photoId: string) => void;
  copyRecipe: () => void;
  pasteRecipe: () => void;
  undo: () => void;
  redo: () => void;

  // Formats, Edit Groups, Crop, Split Frames, Artboard & Video Zoom
  setActiveGroup: (photoId: string, groupId: string) => void;
  addEditGroup: (photoId: string) => void;
  renameEditGroup: (photoId: string, groupId: string, name: string) => void;
  setActiveSize: (sizeId: string, modifiers?: { ctrl?: boolean; shift?: boolean; available?: readonly string[] }) => void;
  clearSizeSelection: () => void;
  selectAllEnabledSizes: (photoId: string, availableIds?: readonly string[]) => void;
  setCanvasLayoutMode: (mode: 'single' | 'all-formats') => void;
  moveSizeArtboard: (photoId: string, sizeId: string, boardX: number, boardY: number) => void;
  resetArtboardPositions: (photoId: string) => void;
  toggleSizeEnabled: (photoId: string, sizeId: string) => void;
  toggleSizeLinked: (photoId: string, sizeId: string) => void;
  updateSizeCrop: (photoId: string, sizeId: string, patch: Partial<CropTransform>) => void;
  flipSelectedSizes: (photoId: string, axis: 'horizontal' | 'vertical') => void;
  rotateSelectedSizes: (photoId: string) => void;
  resetSizeCrop: (photoId: string, sizeId: string) => void;
  /** Save this photo's text overlay and watermark layout as a named template on this device. */
  saveOverlayTemplate: (photoId: string, name: string) => void;
  /** Give each of these photos the template's overlay (a copy; later changes to the photo do not change the template). */
  applyOverlayTemplate: (templateId: string, photoIds: string[]) => void;
  renameOverlayTemplate: (templateId: string, name: string) => void;
  deleteOverlayTemplate: (templateId: string) => void;
  /** Brand kits (K080), present only while the preview is on. Save this photo's logo, colours and text style as a kit. */
  saveBrandKit?: (photoId: string, name: string) => boolean;
  /** Rename a kit, and with fromPhotoId take that photo's logo, colours and text style in place of the kit's own. */
  editBrandKit?: (kitId: string, change: { name?: string; fromPhotoId?: string }) => boolean;
  deleteBrandKit?: (kitId: string) => void;
  /** Changes only the Original output canvas; never rewrites imported pixels. */
  setOriginalOutputSize: (photoId: string, width: number, height: number) => void;
  resetOriginalOutputSize: (photoId: string) => void;
  addCustomSize: (photoId: string, label: string, width: number, height: number) => void;
  /** A copy of a format (same size and crop) as a new format on this photo. */
  duplicateSize: (photoId: string, sizeId: string) => void;
  /** Delete a format: a custom one is removed, a built-in one is switched off. A photo always keeps at least one. */
  removeSize: (photoId: string, sizeId: string) => void;
  toggleSplitFrames: (photoId: string) => void;
  /** One photo's selected format: 1 rejoins, 2 to 5 export adjacent continuous frames. */
  setSplitFrameCount: (photoId: string, sizeId: string, count: 1 | 2 | 3 | 4 | 5) => void;
  setSplitPanOffset: (photoId: string, offset: number) => void;
  updateVideoZoom: (photoId: string, patch: Partial<VideoZoomConfig>) => void;

  // Overlays (Text & Watermark) & Snapping
  updateOverlay: (photoId: string, patch: Partial<OverlaySettings>) => void;
  /** Puts the text and the watermark together at the bottom, stacked, lined up left, centre or right. */
  alignOverlaysCleanly: (photoId: string, layout: OverlayStack) => void;
  /** Moves a text row up (-1) or down (+1). */
  moveOverlayRow: (photoId: string, rowId: string, direction: -1 | 1) => void;
  addOverlayRow: (photoId: string) => void;
  updateOverlayRow: (photoId: string, rowId: string, patch: Partial<OverlayTextRow>) => void;
  removeOverlayRow: (photoId: string, rowId: string) => void;
  /** Measure this photo's lens colour edges and set caRed/caBlue from them. 'clean' = nothing to correct; 'unclear' = too few edges to tell. */
  detectColourEdges: (photoId: string) => Promise<'corrected' | 'clean' | 'unclear'>;
  /** Find this photo's lens in the lensfun profiles and apply its profile. Only with `download` does it fetch the
   * profiles (once, then kept on this device); without it, a device that lacks them answers 'needs-download'. */
  applyLensProfile: (photoId: string, download: boolean) => Promise<LensProfileOutcome>;
  /** White balance from the picture itself, as one undoable step. `at` (0 to 1 across the shown, framed picture) is a spot
   * that should be grey or white (the eyedropper); without it, Auto estimates the light from the whole picture.
   * 'limited' = a slider reached its end first; 'unreadable' = the spot is clipped or too dark, nothing changed. */
  neutralWhiteBalance?: (photoId: string, at?: { x: number; y: number }) => Promise<'set' | 'limited' | 'unreadable'>;
  /** Spot healing: cover a spot at `at` (framed photo, 0–1) with pixels copied from the best nearby place found on the
   * photo. 'full' when the photo already has the most spots allowed; 'no-source' when nothing nearby fits. */
  addHealSpot?: (photoId: string, at: { x: number; y: number }, size: number) => Promise<{ result: 'added'; spotId: string } | { result: 'full' | 'no-source' | 'unreadable' }>;
  updateHealSpot?: (photoId: string, spotId: string, change: HealSpotChange) => void;
  /** Copy from the next best nearby place instead. False when there is no other. */
  nextHealSource?: (photoId: string, spotId: string) => Promise<boolean>;
  removeHealSpot?: (photoId: string, spotId: string) => void;
  clearHealSpots?: (photoId: string) => void;
  /** Image layers. Add one from an image file on this device (opens the file picker). */
  addImageLayer: (photoId: string) => Promise<void>;
  /** Add another photo of this project as a layer: a copy of it as it looks now, with its edits. */
  addPhotoLayer: (photoId: string, sourcePhotoId: string) => Promise<void>;
  updateLayer: (photoId: string, layerId: string, patch: Partial<Omit<import('../../core/layers').PhotoLayer, 'id' | 'assetId' | 'aspect'>>) => void;
  removeLayer: (photoId: string, layerId: string) => void;
  /** Move a layer up (1, towards the top) or down (-1). */
  moveLayer: (photoId: string, layerId: string, direction: -1 | 1) => void;
  /** Opens the file picker and adds the chosen image to the watermark library. Resolves to the new watermark's id. */
  importWatermarkImage: (usage?: WatermarkUsage) => Promise<string | null>;
  /** Removes a flat background from a watermark's artwork. With commit false it only previews (a picture on transparency). */
  cutOutWatermark: (presetId: string, slot: 'dark' | 'light', tolerance: number, commit: boolean) => Promise<{ url: string; tooMuch: boolean } | null>;
  /** Makes the missing version (white for dark photos, black for light photos) from the one that exists. */
  makeWatermarkVariant: (presetId: string, slot: 'dark' | 'light') => Promise<void>;
  deleteWatermark: (presetId: string) => void;
  /** Adds a text watermark (a line and an optional second line) to the library. Returns its id, or null when the text is empty. */
  addTextWatermark: (text: string, subtext: string) => string | null;
  /** Opens the file picker and puts the chosen image in this watermark's version for dark ('dark') or light ('light') photos. */
  addWatermarkVersion: (presetId: string, slot: 'dark' | 'light') => Promise<boolean>;
  /** The person says the artwork is for the other kind of photo: moves a watermark's only version to that slot. */
  setWatermarkSlot: (presetId: string, slot: 'dark' | 'light') => void;
  addCustomFont: (fontName: string) => void;
  /** Names of the fonts installed on this device, or null when the device cannot list them (then a name can be typed). */
  listDeviceFonts: () => Promise<string[] | null>;
  /** True when a font of this name is installed on this device. */
  hasDeviceFont: (fontName: string) => boolean;

  // Genuine non-destructive masks; brush painting still requires canvas coordinate integration.
  setActiveMaskTool: (tool: WorkspaceStore['activeMaskTool']) => void;
  addMaskLayer: (photoId: string, type: MaskLayer['type']) => void;
  /** Tap-to-select: download the optional pack (the person's choice), start on a photo, tap, and finish. */
  downloadTapSelect?: () => void;
  startTapSelect?: (photoId: string) => void;
  tapSelectAt?: (photoId: string, tap: TapPoint) => void;
  setTapSelectMode?: (mode: 'add' | 'remove') => void;
  newTapSubject?: () => void;
  finishTapSelect?: () => void;
  toggleMaskLayer: (photoId: string, maskId: string) => void;
  removeMaskLayer: (photoId: string, maskId: string) => void;
  setMaskEdit: (photoId: string, maskId: string, key: string, value: number) => void;
  setMaskFeather: (photoId: string, maskId: string, percent: number) => void;
  setMaskGeometry: (photoId: string, maskId: string, field: MaskGeometryField, value: number) => void;
  /** Combine other masks into this one, in order; an empty list removes every part. */
  setMaskParts: (photoId: string, maskId: string, parts: MaskLayerPart[]) => void;

  // Tasks & Export
  cancelTask: (taskId: string) => void;
  /** Remove one finished task from the Completed tab. */
  clearTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
  setExportOpen: (open: boolean) => void;
  runExport: (request: ExportRequest) => void;

  /** Open or close the Removed photos panel (browse Trash and restore without Undo). */
  setRemovedOpen: (open: boolean) => void;
  /** Brings photos back from Trash into the catalogue. Ignores any id that is not currently removed. */
  restorePhotos: (photoIds: string[]) => void;

  // Shell Layout & View Controls
  setActivePanel: (panelId: PanelId | null) => void;
  setPanelVisible: (panelId: PanelId, visible: boolean) => void;
  setPanelDock: (panelId: PanelId, dock: DockPosition) => void;
  moveFloatingPanel: (panelId: PanelId, x: number, y: number) => void;
  resetPanelLayout: () => void;
  setBottomTab: (tab: 'filmstrip' | 'info') => void;
  /** Show a burst as one stack (true) or as its individual photos (false). Nothing is deleted or decided either way. */
  setBurstGrouped: (burstGroupId: string, grouped: boolean) => void;
  /** Restore a photo to how it was after this many edit steps (0 is the original). Later steps stay available. */
  jumpToEditStep: (photoId: string, cursor: number) => void;
  /** Start a new, named editing version from this step; the current version and all its later steps are kept. */
  forkEditVersion: (photoId: string, cursor: number, name: string) => void;
  /** Switch between independent checkpoint-forked versions without touching the source file. */
  switchEditVersion: (photoId: string, versionId: string) => void;
  /** Give an editing version a name of the person's choosing. */
  renameEditVersion: (photoId: string, versionId: string, name: string) => void;
  /** Save the photo's whole editing state (recipe and every format's crop) under a name. */
  saveEditCheckpoint: (photoId: string, name: string) => void;
  /** Open a saved checkpoint as a new editing version; the current version is kept. */
  restoreEditCheckpoint: (photoId: string, checkpointId: string) => void;
  deleteEditCheckpoint: (photoId: string, checkpointId: string) => void;
  /** Put a format's crop back to the one a recorded crop action left (itself recorded, so it can be undone the same way). */
  restoreFormatCrop: (photoId: string, formatId: string, eventAt: number) => void;
  setFilmstripCollapsed: (collapsed: boolean) => void;
  setFilmstripHeight: (height: number) => void;
  setFilmstripFilter: (filter: FilmstripFilter) => void;
  setFilmstripMinRating: (rating: number) => void;
  setFilmstripSort: (sort: PhotoSort) => void;
  setFilmstripSearch: (query: string) => void;
  setFilmstripTag?: (tagId: string | null) => void;
  setGridViewOpen: (open: boolean) => void;
  setCompareMode: (compare: boolean) => void;
  setCanvasZoom: (zoom: number) => void;
  toggleFullScreen: () => void;

  // Settings
  setSettingsOpen: (open: boolean, tab?: SettingsTabId) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  /** Removes the catalogue, previews and saved choices on this device, then restarts. Originals are never touched. */
  eraseDeviceData: () => void;
  updateSettings: (patch: Partial<WorkspaceSettings>) => void;
  signInStub: (provider: 'google' | 'apple' | 'email', email?: string) => void;
  signOutStub: () => void;
  toggleAiProvider: (providerId: AiProviderConfig['id']) => void;
  toggleStorageConnector: (connectorId: StorageConnector['id']) => void;
  clearNotice: () => void;
  /** Shows a short message in the usual notice (for a key that had nothing to do, for example). */
  showNotice?: (message: string) => void;
}

/** Background suitability chosen when importing watermark artwork. */
export type WatermarkUsage = 'auto' | 'dark' | 'light' | 'both';
