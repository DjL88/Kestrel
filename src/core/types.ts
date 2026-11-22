import type { FocusPoint } from './exportFraming';
import type { PhotoSearchEvidence } from './photoSearch';
import type { EditHistory } from './editHistory';
import type { PhotoFraming } from './photoFraming';
import type { PhotoEdit } from './photoEdits';

export type CullDecision = 'unreviewed' | 'keep' | 'reject';

export type FilterState = 'all' | CullDecision;

/** Show only photos with a star rating at least, or exactly, this value. 0 means unrated. */
export interface RatingFilter {
  mode: 'atLeast' | 'exactly';
  value: number;
}

export type WorkspaceViewMode = 'loupe' | 'grid' | 'compare';

/** How the visible photos are ordered. Confidence falls back to last for photos auto-cull has not scored. */
export type SortOrder = 'captured-desc' | 'captured-asc' | 'rating-desc' | 'name-asc' | 'confidence-desc' | 'edited-desc';

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
  editHistory?: EditHistory;
  /** Edit recipe when the user last requested a file download, stored locally. */
  lastExport?: { at: number; edit?: PhotoEdit; framing?: PhotoFraming };
  framing?: PhotoFraming;
  focusPoint?: FocusPoint;
  rating?: number;
  virtualCopy?: { originalFrameId: string; number: number };
  subjectNames?: string[];
  /** Labels such as a species, kept with the photo so projects can be searched by them. Always a suggestion the user can edit. */
  tags?: string[];
  /** Quiet local OCR and corroborated subject evidence. Separate from the photographer's tags and camera EXIF. */
  searchEvidence?: PhotoSearchEvidence;
  /** What the photo is mainly of, chosen by the user. */
  subjectKind?: import('./subjectTags').SubjectKind;
  /** Set when two independent readings of the photo (scene reading and object detector) disagreed about its subject, for
   * example a bird against an aircraft. While set, no automatic species name is shown or added. Cleared when a later
   * check agrees or when the user sets the subject themselves. Never changes a decision, rating or edit. */
  subjectDisputed?: boolean;
  /** Tags the app added by itself and the user has not yet kept. Always also in `tags`. */
  autoTags?: string[];
  /** Names the user removed from this photo, so the app never adds them to it again. */
  declinedTags?: string[];
  /** Set once the species model has looked at this photo, so it is not looked at again. */
  speciesChecked?: boolean;
  /** How confident the last auto-cull scan was in this photo, and its score (0-100). Set when a scan looks at the
   * photo, whether or not its suggestion was applied; absent for a photo no scan has looked at yet. Purely
   * informational (sort/review), never changes `decision` on its own. */
  cullConfidence?: 'high' | 'medium' | 'low';
  cullScore?: number;
  burstGroupId: string | null;
  burstIndex: number;
  burstCount: number;
  exif: ExifMetadata;
  isDemo: boolean;
  demoVariant?: DemoFrameVariant;
  sourceKind: 'demo' | 'file' | 'directory-handle';
  /** Desktop app: where the original is on the disk. It is read from there, never copied into the app or changed. */
  sourcePath?: string;
  /** The V2 text and watermark overlay for this photo (rows of text, fonts, placement). The shape belongs to src/v2, which
   * validates it on read; core only keeps it with the photo so it is saved, backed up and exported with the project. */
  overlay?: unknown;
  /** Set when the photo was removed from the library. The original file is never touched, and Restore clears this. */
  removedAt?: number;
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
  /** Set when the project is archived. Archived projects are hidden from the main list and can be restored. */
  archivedAt?: number;
  /** True for the Quick edits bucket, where single photos are opened without making a project first. */
  inbox?: boolean;
}

export interface DecisionHistoryEntry {
  frameId: string;
  batch?: { frameId: string; prevDecision: CullDecision; nextDecision: CullDecision }[];
  /** True when this step removed photos from the library, so undo restores them. */
  removal?: boolean;
  prevDecision: CullDecision;
  nextDecision: CullDecision;
  prevSelectedId: string | null;
  nextSelectedId: string | null;
}

export interface CullingState {
  /** Helpers chosen when the project was created. Absent on projects made before the wizard. */
  settings?: import('./projectSettings').ProjectSettings;
  shoot: ShootDescriptor;
  frames: PhotoFrame[];
  selectedFrameId: string | null;
  compareRightFrameId: string | null;
  filter: FilterState;
  searchQuery: string;
  ratingFilter?: RatingFilter | null;
  /** Exact-match EXIF filters, from the same consolidated Filter control as search and rating. */
  cameraFilter?: string | null;
  lensFilter?: string | null;
  sortOrder?: SortOrder;
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
