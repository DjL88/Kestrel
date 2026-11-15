import type { PhotoFraming } from './photoFraming';
import type { PhotoEdit } from './photoEdits';

export type CullDecision = 'unreviewed' | 'keep' | 'reject';

export type FilterState = 'all' | CullDecision;

export type WorkspaceViewMode = 'loupe' | 'grid' | 'compare';

export type DemoAssetKey =
  | 'red-kite'
  | 'kingfisher'
  | 'barn-owl'
  | 'collie-coco'
  | 'red-fox'
  | 'osprey';

export interface DemoFrameVariant {
  assetKey: DemoAssetKey;
  /** Subtle deterministic framing offset in normalized percent (-3..+3) */
  panX: number;
  /** Subtle deterministic framing offset in normalized percent (-3..+3) */
  panY: number;
  /** Subtle deterministic zoom crop factor (1.0..1.08) */
  cropScale: number;
  /** Simulated slight motion/focus softness in px (0 = tack sharp) */
  softnessPx: number;
  /** Subject label used strictly for demo shoot description, not AI inference */
  demoSceneLabel: string;
}

export interface ExifMetadata {
  rating?: number;
  rejectedByMetadata?: boolean;
  camera?: string;
  lens?: string;
  focalLengthMm?: number;
  apertureF?: number;
  shutterSpeed?: string;
  iso?: number;
  capturedAtMs?: number;
  width?: number;
  height?: number;
  formatLabel?: string;
  isEmbeddedPreviewOnly?: boolean;
}

export interface PhotoFrame {
  id: string;
  /** Stable catalogue identifier (relative path / deterministic key across relinks) */
  stableKey: string;
  filename: string;
  sequenceIndex: number;
  decision: CullDecision;
  edit?: PhotoEdit;
  framing?: PhotoFraming;
  rating?: number;
  virtualCopy?: { originalFrameId: string; number: number };
  subjectNames?: string[];
  burstGroupId: string | null;
  burstIndex: number;
  burstCount: number;
  exif: ExifMetadata;
  isDemo: boolean;
  demoVariant?: DemoFrameVariant;
  sourceKind: 'demo' | 'file' | 'directory-handle';
}

export interface ShootDescriptor {
  id: string;
  title: string;
  sourceKind: 'demo' | 'local-files' | 'local-folder';
  totalFrames: number;
  folderName?: string;
  needsFolderRegrant?: boolean;
  needsFileReselect?: boolean;
  createdAt: number;
  lastUpdatedAt: number;
}

export interface DecisionHistoryEntry {
  frameId: string;
  prevDecision: CullDecision;
  nextDecision: CullDecision;
  prevSelectedId: string | null;
  nextSelectedId: string | null;
}

export interface CullingState {
  shoot: ShootDescriptor;
  frames: PhotoFrame[];
  selectedFrameId: string | null;
  compareRightFrameId: string | null;
  filter: FilterState;
  searchQuery: string;
  keeperTarget: number;
  autoAdvance: boolean;
  undoStack: DecisionHistoryEntry[];
  redoStack: DecisionHistoryEntry[];
}

export interface CullCounts {
  all: number;
  unreviewed: number;
  keep: number;
  reject: number;
}
