import type { ColourSenseNote, ColourWords } from '../engineClient/colourWords';
import type { ComponentType, CSSProperties, ReactNode } from 'react';

// Single Contract File for InFlight UI Shell
// All components import their types ONLY from this file.
// Engine engineers swap src/stub.ts with a real WorkspaceStore + WorkspaceActions provider.

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
}
export type TileState = 'importing' | 'analysing' | 'ready' | 'unavailable';
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
  | 'presets'
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
  | 'splitFrames';

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
  denoiseRawAi: boolean;
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
  /** Film-like grain, 0 to 100, and its size, 0 (fine) to 100 (coarse; absent = 25). */
  grain?: number;
  grainSize?: number;
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

export interface MaskLayer {
  id: string;
  name: string;
  type: 'subject' | 'sky' | 'background' | 'brush' | 'area' | 'gradient';
  /** Present only for genuine editable oval/gradient masks; never fabricated for detected subjects. */
  geometry?: MaskGeometry;
  /** Restrict this layer to, or subtract, another layer's saved shape. */
  limit?: { id: string; mode: 'intersect' | 'subtract' };
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
  steps?: { id: string; label: string; from: string; to: string }[];
  /** ColourSense: whether the suggestion keeps the subject's colour, in words (absent when it could not be judged). */
  colourSense?: ColourSenseNote;
  /** Colour match: whether the subject carries the colours it should have (species signature or the vision model), in words. */
  colourMatch?: ColourSenseNote;
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
  /** What kind of vehicle or aircraft it probably is, in the person's language ("Military jet: Eurofighter Typhoon (probably)"). */
  vehicleLabel?: string;
  /** Extra words the photo can be found by (a vehicle's kind in this language and in English, its type name). */
  searchTerms?: string[];
  /** The subject name alone, without the "(suggested)" marker the label may carry, for editing it. */
  speciesName?: string;
  category: string;
  sharpnessScore: number;
  exif: PhotoExif;
  activeGroupId: string;
  editGroups: EditGroup[];
  sizes: SizePreset[];
  /** A split belongs to one output format, never every copy of this photo. */
  formatSplits?: Record<string, { enabled: boolean; offset: number; count?: 3 | 4 | 5 }>;
  videoZoom: VideoZoomConfig;
  masks: MaskLayer[];
  /** The camera's as-shot white in kelvin, estimated by InFlight's RAW decoder. Absent for JPEGs and older developments. */
  asShotKelvin?: number;
  /** Set when this photo was shot in a burst with others. `ungrouped` is the person's choice to see its frames one by one. */
  burst?: { groupId: string; index: number; count: number; ungrouped: boolean; score?: number };
  /** The photo's recorded edit steps (oldest first) and where it stands now. Absent until it has been edited. */
  editHistory?: { steps: { label: string; at: number }[]; cursor: number; originalAvailable?: boolean };
  /** Saved non-destructive photo-wide edit versions, all using one original. */
  editVersions?: {
    activeId: string;
    versions: { id: string; label: string; parentId: string | null; forkCursor: number; createdAt: number }[];
  };
  /** Actual recorded format actions; missing means pre-history, not a fabricated event. */
  formatHistory?: { formatId: string; kind: string; at: number; parentFormatId?: string; forkEditCursor?: number }[];
  /** The JPEG the camera wrote with this RAW, kept beside it and shown as one photo. Its flag and rating follow this photo. */
  pairedJpeg?: string;
  /** When the photo was taken, in milliseconds, when the file records it. Used only for sorting. */
  capturedAtMs?: number;
  /** The picture's size in real pixels, when the file says. Used for the true 100% zoom. */
  pixelSize?: { width: number; height: number };
  /** Measured from the picture as it is now. Absent until measured; the interface shows nothing rather than a guess. */
  histogram?: PhotoHistogram | null;
  /** Good, better or best, from the engine's decision maker. Shown as a word, never as a number. */
  tier?: PhotoTier | null;
  /** What 'auto' resolves to for this photo's watermark, measured on the pixels behind it. Absent until measured. */
  watermarkAuto?: 'light-on-dark' | 'dark-on-light';
  assistCritique: {
    subjectNote: string;
    colourConfidence: string;
    /** The colour check in words (main colours and findings). Shown only with the Colour-vision support setting on. */
    colourCheck?: ColourWords;
    kelvinEstimate: string;
    suggestions: AssistSuggestion[];
  };
}

export interface Project {
  kind?: 'photography' | 'collage';
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
}

export interface TaskInfo {
  id: string;
  label: string;
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
  touchDensity: 'comfortable' | 'compact';
  /** Which side the tool rail is on. 'left' mode puts it on the right so a pencil or a left hand does not catch it. */
  hand: 'right' | 'left';
  cvdGuidance: boolean;
  /** Basic accounts only: leave locked Pro features (and their badges) out of the interface. */
  hideProFeatures: boolean;
  /** Show the advanced editing controls (colour grading, channel curves). Off by default so the panel stays simple. */
  advancedControls: boolean;
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
  /** Standalone, photo-wide TIFF made from the selected sensor RAW. */
  rawMaster?: boolean;
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
}

/** How a photo is drawn. The engine supplies this so the canvas shows real, developed pixels; without it the UI falls back
 * to a plain image with a CSS filter. 'original' is the photo with no edit, 'edited' is with its recipe. */
export interface PhotoSurfaceProps {
  /** Editor-only coverage guide, never part of the photo recipe or export. */
  maskGuideId?: string;
  /** Editor-only SVG content (mask outline and handles) drawn in the displayed picture's own pixels, over exactly that picture. */
  maskOutline?: (picture: { width: number; height: number }) => ReactNode;
  photoId: string;
  variant: 'edited' | 'original';
  /** Non-destructive live preview of a hovered Look. Never stored or applied to original pixels. */
  lookPreview?: Partial<EditRecipe>;
  alt: string;
  className?: string;
  style?: CSSProperties;
}

export type HubViewState = 'ready' | 'empty' | 'loading' | 'error';

export interface WorkspaceStore {
  screen: 'hub' | 'editor';
  hubState: HubViewState;
  projects: Project[];
  activeProjectId: string | null;
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
  features: Record<FeatureKey, boolean>;
  /** Which plan each feature belongs to, so the UI can mark Pro features with the Pro badge. Basic or Pro only. */
  featurePlan: Record<FeatureKey, 'basic' | 'pro'>;
  looks: LookPreset[];
  hoveredLookId: string | null;
  fonts: FontOption[];
  watermarkPresets: WatermarkPreset[];
  /** Saved overlay templates on this device (name only; the layout stays inside the store). */
  overlayTemplates: Array<{ id: string; name: string }>;
  tasks: TaskInfo[];
  /** Photos whose deep vision review is running right now (empty when none). */
  reviewingPhotoIds: string[];
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
  canUndo: boolean;
  canRedo: boolean;
  clipboardRecipe: EditRecipe | null;
  lastActionNotice: string | null;
  /** After reading a Lightroom catalogue: how many of its photos are not in this project yet, and where Lightroom keeps them. */
  lightroomOffer?: { missing: number; folder: string } | null;
  /** First run: InFlight is adding the picked photos and running Auto on the first ('working'), has applied Auto ('ready'),
   * found the photo already looked natural and left it ('unchanged'), or could not check it ('failed'). */
  quickStart?: { phase: 'working' | 'ready' | 'unchanged' | 'failed'; photoId: string | null } | null;
  /** The open project's automatic backup, as last reported. Absent when no project is open. */
  backup?: { state: 'idle' | 'working' | 'ok' | 'partial' | 'failed'; at?: number } | null;
  /** Optional engine-supplied renderer for the canvas (see PhotoSurfaceProps). */
  PhotoSurface?: ComponentType<PhotoSurfaceProps>;
}

export interface WorkspaceActions {
  // Navigation & Projects
  openProject: (projectId: string) => void;
  backToProjects: () => void;
  createProject: (name: string, kind?: 'photography' | 'collage') => void;
  createCollageFromSelection?: (photoIds: string[]) => void;
  exportCollage?: (request: import('../engineClient/exportCollage').CollageExportRequest) => Promise<void>;
  updateCollage?: (document: import('../../core/collage').CollageDocument) => void;
  browseCollageProjectPhotos?: (sourceProjectId: string) => Promise<Array<{ id: string; filename: string }>>;
  addCollageProjectPhotos?: (sourceProjectId: string, photoIds: string[]) => Promise<void>;
  /** Pick a folder (on this device, an external drive or a synced cloud folder) and make a project of its photos. */
  createProjectFromFolder: () => void;
  renameProject: (projectId: string, name: string) => void;
  archiveProject: (projectId: string, archived: boolean) => void;
  /** Removes InFlight's catalogue entry and its stored copies. Original files are never touched. */
  deleteProject: (projectId: string) => void;
  setHubState: (state: HubViewState) => void;

  // Photos, Culling & Selection
  selectPhoto: (photoId: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => void;
  /** Make this photo the one keys act on, without changing which photos are selected (the chosen side of a two-photo compare). */
  focusPhoto: (photoId: string) => void;
  selectAllPhotos: () => void;
  clearSelection: () => void;
  setDecision: (photoIds: string[], decision: DecisionState) => void;
  /** Moves already set-aside (rejected) photos into Trash. The catalogue entry is removed; InFlight's stored copies
   * go with it, but the original file on disk is never touched. Reversible with the normal per-photo Undo. */
  removePhotos: (photoIds: string[]) => void;
  toggleFlag: (photoIds: string[]) => void;
  setRating: (photoIds: string[], rating: number) => void;
  correctSpeciesName: (photoId: string, name: string) => void;
  importPhotos: () => void;
  importFolder: () => void;
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
  /** First run: pick photos; InFlight makes a project, adds them and runs Auto on the first one. */
  startQuickStart?: () => void;
  dismissQuickStart?: () => void;
  runAutoCull: () => void;
  reconnectOriginal: (photoId: string) => void;
  toggleDemoUnavailable: () => void;

  // Flight Mode & Deep Vision Review
  setAssistMode: (mode: AssistMode) => void;
  runDeepVisionReview: (photoId: string) => void;
  applyAssistSuggestion: (photoId: string, suggestionId: string) => void;
  requestLocalAuto?: (photoId: string) => void;
  applyAllAssistSuggestions: (photoId: string) => void;
  /** A sized JPEG of the edited photo for a client gallery, or null when there is no trustworthy picture yet. Absent in the stub. */
  renderGalleryPreview?: (photoId: string) => Promise<Blob | null>;
  /** The photo's whole edit as plain data for a shared project, or null when it has no edit. Absent in the stub. */
  sharedEditOf?: (photoId: string) => Record<string, unknown> | null;
  /** Replace the photo's edit with a shared one (or clear it). Recorded as an edit step, so it can be undone. */
  applySharedEdit?: (photoId: string, edit: Record<string, unknown> | null) => void;
  /** On a clash: keep this device's edit as a virtual copy beside the photo, and give the photo the shared edit. Returns the copy's id. */
  keepBothShared?: (photoId: string, theirs: Record<string, unknown> | null) => string | null;
  /** Add photos fetched from a shared project's cloud store to this project, linked to the owner's originals. */
  importCloudPreviews?: (items: { file: File; projectId: string; photoKey: string }[]) => Promise<void>;
  /** The photo's exact original bytes, checked against its fingerprint, or null when the original is not connected. */
  readVerifiedOriginal?: (photoId: string) => Promise<Blob | null>;
  dismissAssistSuggestion: (photoId: string, suggestionId: string) => void;

  // Editing & Looks
  updateRecipe: (photoId: string, patch: Partial<EditRecipe>, label?: string) => void;
  /** Denoise this photo now. Signed in with the cloud feature on, the press is the consent to upload a working-size copy for this job; the device is the fallback. */
  denoisePhoto: (photoId: string) => void;
  applyLook: (photoId: string, lookId: string) => void;
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
  toggleMaskLayer: (photoId: string, maskId: string) => void;
  removeMaskLayer: (photoId: string, maskId: string) => void;
  setMaskEdit: (photoId: string, maskId: string, key: string, value: number) => void;
  setMaskFeather: (photoId: string, maskId: string, percent: number) => void;
  setMaskGeometry: (photoId: string, maskId: string, field: MaskGeometryField, value: number) => void;
  setMaskLimit: (photoId: string, maskId: string, limit: MaskLayer['limit'] | null) => void;

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
  /** Switch between independent checkpoint-forked versions without touching the source file. */
  switchEditVersion: (photoId: string, versionId: string) => void;
  setFilmstripCollapsed: (collapsed: boolean) => void;
  setFilmstripHeight: (height: number) => void;
  setFilmstripFilter: (filter: FilmstripFilter) => void;
  setFilmstripMinRating: (rating: number) => void;
  setFilmstripSort: (sort: PhotoSort) => void;
  setFilmstripSearch: (query: string) => void;
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
}

/** Background suitability chosen when importing watermark artwork. */
export type WatermarkUsage = 'auto' | 'dark' | 'light' | 'both';
