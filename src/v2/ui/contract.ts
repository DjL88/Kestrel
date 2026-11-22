import type { ComponentType, CSSProperties } from 'react';

// Single Contract File for InFlight UI Shell
// All components import their types ONLY from this file.
// Engine engineers swap src/stub.ts with a real WorkspaceStore + WorkspaceActions provider.

export type DecisionState = 'unreviewed' | 'keep' | 'reject';
/** The engine's three-tier ranking of a photo within its shoot. Absent or null means it has not been ranked: nothing is guessed. */
export type PhotoTier = 'good' | 'better' | 'best';
export type TileState = 'importing' | 'analysing' | 'ready' | 'unavailable';
export type AssistMode = 'solo' | 'copilot' | 'autopilot';
export type ThemeMode = 'dark' | 'light';
export type PanelId =
  | 'copilot'
  | 'adjust'
  | 'formats'
  | 'masks'
  | 'enhance'
  | 'overlays'
  | 'assist'
  | 'info'
  | 'tasks';

export type DockPosition = 'left' | 'right' | 'float';
export type SettingsTabId =
  | 'appearance'
  | 'account'
  | 'assistance'
  | 'aiProviders'
  | 'storage'
  | 'keyboard'
  | 'language';

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
}

export interface LookPreset {
  id: string;
  name: string;
  category: string;
  description: string;
  previewFilter: string;
  recipeDelta: Partial<EditRecipe>;
}

export interface OverlayTextRow {
  id: string;
  fields: Array<'camera' | 'lens' | 'aperture' | 'shutter' | 'iso' | 'focalLength' | 'species' | 'custom'>;
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
  watermarkX: number; // 4 to 96 (% of frame width)
  watermarkY: number; // 4 to 96 (% of frame height)
  watermarkOpacity: number; // 10 to 100
  watermarkScale: number; // 40 to 160 (%)
  /** 'auto' picks light or dark from the photo behind the watermark (see Photo.watermarkAuto). */
  watermarkContrast: 'light-on-dark' | 'dark-on-light' | 'auto';
  snapEnabled: boolean;
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

export interface MaskLayer {
  id: string;
  name: string;
  type: 'subject' | 'sky' | 'background' | 'brush' | 'area';
  visible: boolean;
  feather: number;
}

export interface AssistSuggestion {
  id: string;
  title: string;
  summary: string;
  colourReadout: string;
  applied: boolean;
  recipeDelta: Partial<EditRecipe>;
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
  filename: string;
  title: string;
  previewUrl: string;
  thumbUrl: string;
  state: TileState;
  decision: DecisionState;
  originalConnected: boolean;
  rating: number; // 0 to 5
  speciesLabel?: string;
  category: string;
  sharpnessScore: number;
  exif: PhotoExif;
  activeGroupId: string;
  editGroups: EditGroup[];
  sizes: SizePreset[];
  videoZoom: VideoZoomConfig;
  masks: MaskLayer[];
  /** Good, better or best, from the engine's decision maker. Shown as a word, never as a number. */
  tier?: PhotoTier | null;
  /** What 'auto' resolves to for this photo's watermark, measured on the pixels behind it. Absent until measured. */
  watermarkAuto?: 'light-on-dark' | 'dark-on-light';
  assistCritique: {
    subjectNote: string;
    colourConfidence: string;
    kelvinEstimate: string;
    suggestions: AssistSuggestion[];
  };
}

export interface Project {
  id: string;
  name: string;
  updatedAt: string;
  coverUrl: string;
  photoCount: number;
  flaggedCount: number;
  localCopyStatus: 'synced' | 'offline-ready' | 'pending';
  folderPath: string;
}

export interface TaskInfo {
  id: string;
  label: string;
  detail: string;
  progress: number; // 0 to 100
  status: 'running' | 'done' | 'cancelled' | 'failed';
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
  calmView: boolean;
  touchDensity: 'comfortable' | 'compact';
  cvdGuidance: boolean;
  ongoingCritique: boolean;
  defaultAssistMode: AssistMode;
  language: 'en-GB' | 'en-US' | 'de-DE' | 'fr-FR';
  account: {
    signedIn: boolean;
    provider?: 'google' | 'apple' | 'email';
    email?: string;
    displayName?: string;
  };
  aiProviders: AiProviderConfig[];
  storageConnectors: StorageConnector[];
  localCacheLimitGb: number;
}

export interface ExportRequest {
  destination: ExportDestination;
  groupIds: string[];
  sizeIds: string[];
  includeBefore: boolean;
  includeAfter: boolean;
  includeOverlay: boolean;
  includeWatermark: boolean;
  includeVideo: boolean;
  photoIds: string[];
}

/** How a photo is drawn. The engine supplies this so the canvas shows real, developed pixels; without it the UI falls back
 * to a plain image with a CSS filter. 'original' is the photo with no edit, 'edited' is with its recipe. */
export interface PhotoSurfaceProps {
  photoId: string;
  variant: 'edited' | 'original';
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
  tasks: TaskInfo[];
  settings: WorkspaceSettings;

  // Shell UI layout state
  activePanel: PanelId | null;
  panels: Record<PanelId, PanelLayoutState>;
  filmstripCollapsed: boolean;
  filmstripHeight: number;
  filmstripFilter: 'all' | 'flagged';
  filmstripSearch: string;
  gridViewOpen: boolean;
  compareMode: boolean;
  canvasZoom: number; // 0.5 to 3.0
  isFullScreen: boolean;
  exportOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTabId;
  activeMaskTool: 'subject' | 'sky' | 'background' | 'brush' | 'eraser' | 'area';
  canUndo: boolean;
  canRedo: boolean;
  clipboardRecipe: EditRecipe | null;
  lastActionNotice: string | null;
  /** Optional engine-supplied renderer for the canvas (see PhotoSurfaceProps). */
  PhotoSurface?: ComponentType<PhotoSurfaceProps>;
}

export interface WorkspaceActions {
  // Navigation & Projects
  openProject: (projectId: string) => void;
  backToProjects: () => void;
  createProject: (name: string) => void;
  setHubState: (state: HubViewState) => void;

  // Photos, Culling & Selection
  selectPhoto: (photoId: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => void;
  selectAllPhotos: () => void;
  clearSelection: () => void;
  setDecision: (photoIds: string[], decision: DecisionState) => void;
  toggleFlag: (photoIds: string[]) => void;
  setRating: (photoIds: string[], rating: number) => void;
  importPhotos: () => void;
  runAutoCull: () => void;
  reconnectOriginal: (photoId: string) => void;
  toggleDemoUnavailable: () => void;

  // Flight Mode & Deep Vision Review
  setAssistMode: (mode: AssistMode) => void;
  runDeepVisionReview: (photoId: string) => void;
  applyAssistSuggestion: (photoId: string, suggestionId: string) => void;
  applyAllAssistSuggestions: (photoId: string) => void;
  dismissAssistSuggestion: (photoId: string, suggestionId: string) => void;

  // Editing & Looks
  updateRecipe: (photoId: string, patch: Partial<EditRecipe>, label?: string) => void;
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
  setActiveSize: (sizeId: string, modifiers?: { ctrl?: boolean }) => void;
  selectAllEnabledSizes: (photoId: string) => void;
  setCanvasLayoutMode: (mode: 'single' | 'all-formats') => void;
  moveSizeArtboard: (photoId: string, sizeId: string, boardX: number, boardY: number) => void;
  resetArtboardPositions: (photoId: string) => void;
  toggleSizeEnabled: (photoId: string, sizeId: string) => void;
  toggleSizeLinked: (photoId: string, sizeId: string) => void;
  updateSizeCrop: (photoId: string, sizeId: string, patch: Partial<CropTransform>) => void;
  flipSelectedSizes: (photoId: string, axis: 'horizontal' | 'vertical') => void;
  rotateSelectedSizes: (photoId: string) => void;
  resetSizeCrop: (photoId: string, sizeId: string) => void;
  addCustomSize: (photoId: string, label: string, width: number, height: number) => void;
  toggleSplitFrames: (photoId: string) => void;
  setSplitPanOffset: (photoId: string, offset: number) => void;
  updateVideoZoom: (photoId: string, patch: Partial<VideoZoomConfig>) => void;

  // Overlays (Text & Watermark) & Snapping
  updateOverlay: (photoId: string, patch: Partial<OverlaySettings>) => void;
  alignOverlaysCleanly: (photoId: string, layout: 'stacked-left' | 'opposite-bottom' | 'centred-pair') => void;
  addOverlayRow: (photoId: string) => void;
  updateOverlayRow: (photoId: string, rowId: string, patch: Partial<OverlayTextRow>) => void;
  removeOverlayRow: (photoId: string, rowId: string) => void;
  /** Opens the file picker and adds the chosen image to the watermark library. Resolves to the new watermark's id. */
  importWatermarkImage: () => Promise<string | null>;
  /** Removes a flat background from a watermark's artwork. With commit false it only previews (a picture on transparency). */
  cutOutWatermark: (presetId: string, slot: 'dark' | 'light', tolerance: number, commit: boolean) => Promise<{ url: string; tooMuch: boolean } | null>;
  /** Makes the missing version (white for dark photos, black for light photos) from the one that exists. */
  makeWatermarkVariant: (presetId: string, slot: 'dark' | 'light') => Promise<void>;
  deleteWatermark: (presetId: string) => void;
  addCustomFont: (fontName: string) => void;
  /** Names of the fonts installed on this device, or null when the device cannot list them (then a name can be typed). */
  listDeviceFonts: () => Promise<string[] | null>;
  /** True when a font of this name is installed on this device. */
  hasDeviceFont: (fontName: string) => boolean;

  // Masks (placeholder engine hook)
  setActiveMaskTool: (tool: WorkspaceStore['activeMaskTool']) => void;
  addMaskLayer: (photoId: string, type: MaskLayer['type']) => void;
  toggleMaskLayer: (photoId: string, maskId: string) => void;
  removeMaskLayer: (photoId: string, maskId: string) => void;

  // Tasks & Export
  cancelTask: (taskId: string) => void;
  /** Remove one finished task from the Completed tab. */
  clearTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
  setExportOpen: (open: boolean) => void;
  runExport: (request: ExportRequest) => void;

  // Shell Layout & View Controls
  setActivePanel: (panelId: PanelId | null) => void;
  setPanelVisible: (panelId: PanelId, visible: boolean) => void;
  setPanelDock: (panelId: PanelId, dock: DockPosition) => void;
  moveFloatingPanel: (panelId: PanelId, x: number, y: number) => void;
  resetPanelLayout: () => void;
  setBottomTab: (tab: 'filmstrip' | 'info') => void;
  setFilmstripCollapsed: (collapsed: boolean) => void;
  setFilmstripHeight: (height: number) => void;
  setFilmstripFilter: (filter: 'all' | 'flagged') => void;
  setFilmstripSearch: (query: string) => void;
  setGridViewOpen: (open: boolean) => void;
  setCompareMode: (compare: boolean) => void;
  setCanvasZoom: (zoom: number) => void;
  toggleFullScreen: () => void;

  // Settings
  setSettingsOpen: (open: boolean, tab?: SettingsTabId) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  updateSettings: (patch: Partial<WorkspaceSettings>) => void;
  signInStub: (provider: 'google' | 'apple' | 'email', email?: string) => void;
  signOutStub: () => void;
  toggleAiProvider: (providerId: AiProviderConfig['id']) => void;
  toggleStorageConnector: (connectorId: StorageConnector['id']) => void;
  clearNotice: () => void;
}
