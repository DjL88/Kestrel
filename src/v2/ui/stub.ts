// Single Stub Engine for InFlight UI Shell
// Implements WorkspaceStore + WorkspaceActions entirely in-memory.
// Replace this file when connecting the real Kestrel/InFlight engine.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CropTransform,
  DecisionState,
  DockPosition,
  EditGroup,
  EditRecipe,
  ExportRequest,
  FeatureKey,
  FontOption,
  LookPreset,
  MaskLayer,
  OverlaySettings,
  OverlayTextRow,
  PanelId,
  PanelLayoutState,
  Photo,
  Project,
  SizePreset,
  TaskInfo,
  WatermarkPreset,
  WorkspaceActions,
  WorkspaceStore,
} from './contract';
import { computeMultiSelection, getActiveGroup } from './utils/studioMath';

const DEFAULT_CROP: CropTransform = {
  zoom: 1,
  panX: 0,
  panY: 0,
  insetTop: 0,
  insetRight: 0,
  insetBottom: 0,
  insetLeft: 0,
  flipH: false,
  flipV: false,
  rotateDeg: 0,
};

const BASE_RECIPE: EditRecipe = {
  lookId: 'natural-raw',
  exposure: 0.2,
  highlights: -14,
  shadows: 18,
  contrast: 8,
  whites: 6,
  blacks: -4,
  temperature: 4,
  tint: 0,
  vibrance: 10,
  saturation: 2,
  clarity: 12,
  sharpen: 24,
  denoiseRawAi: true,
  denoiseLuminance: 18,
  denoiseColour: 14,
  upscaleFactor: 1,
  detailRecovery: 22,
  lensCorrection: true,
};

export const INITIAL_LOOKS: LookPreset[] = [
  {
    id: 'natural-raw',
    name: 'Natural True',
    category: 'Balanced',
    description: 'Faithful 16-bit colour science with gentle highlight roll-off.',
    previewFilter: 'contrast(1.04) saturate(1.04)',
    recipeDelta: { exposure: 0.1, contrast: 6, temperature: 0, vibrance: 8, saturation: 0 },
  },
  {
    id: 'highland-mist',
    name: 'Highland Mist',
    category: 'Landscape',
    description: 'Cool slate shadows with crisp lifted mid-tones for Scottish light.',
    previewFilter: 'brightness(1.03) contrast(1.08) saturate(0.94) hue-rotate(-4deg)',
    recipeDelta: { exposure: 0.2, shadows: 26, highlights: -22, temperature: -12, vibrance: 6, clarity: 14 },
  },
  {
    id: 'golden-heather',
    name: 'Golden Heather',
    category: 'Warm',
    description: 'Soft late-afternoon warmth that preserves natural feather tones.',
    previewFilter: 'brightness(1.05) contrast(1.06) saturate(1.14) sepia(0.14)',
    recipeDelta: { exposure: 0.3, temperature: 22, vibrance: 14, shadows: 16, contrast: 10 },
  },
  {
    id: 'nordic-slate',
    name: 'Nordic Slate',
    category: 'Editorial',
    description: 'Restrained, desaturated greens with clean architectural contrast.',
    previewFilter: 'contrast(1.12) saturate(0.78) brightness(0.98)',
    recipeDelta: { contrast: 18, saturation: -20, vibrance: 4, temperature: -8, blacks: -14 },
  },
  {
    id: 'crisp-wildlife',
    name: 'Crisp Wildlife',
    category: 'Nature',
    description: 'Micro-contrast tuned for plumage, eye catchlights, and fur texture.',
    previewFilter: 'contrast(1.14) saturate(1.12) brightness(1.02)',
    recipeDelta: { clarity: 28, sharpen: 38, vibrance: 16, shadows: 20, highlights: -18 },
  },
  {
    id: 'silver-monochrome',
    name: 'Silver Ilford',
    category: 'Monochrome',
    description: 'Classic British silver-gelatin black & white with deep tonal separation.',
    previewFilter: 'grayscale(1) contrast(1.22) brightness(1.02)',
    recipeDelta: { saturation: -100, vibrance: -100, contrast: 28, clarity: 22, blacks: -16 },
  },
  {
    id: 'coastal-breeze',
    name: 'Coastal Breeze',
    category: 'Landscape',
    description: 'Airy highlights and faithful sea-spray blues without cyan clipping.',
    previewFilter: 'brightness(1.07) contrast(1.02) saturate(1.08)',
    recipeDelta: { exposure: 0.4, highlights: -10, shadows: 28, temperature: -6, vibrance: 14 },
  },
  {
    id: 'autumn-copper',
    name: 'Autumn Copper',
    category: 'Warm',
    description: 'Rich russet and amber foliage with velvety dark shadows.',
    previewFilter: 'contrast(1.1) saturate(1.22) sepia(0.18)',
    recipeDelta: { temperature: 28, contrast: 16, saturation: 14, blacks: -12, highlights: -16 },
  },
  {
    id: 'velvet-dusk',
    name: 'Velvet Dusk',
    category: 'Moody',
    description: 'Low-key atmospheric twilight with smooth shadow gradations.',
    previewFilter: 'brightness(0.88) contrast(1.16) saturate(1.06)',
    recipeDelta: { exposure: -0.5, contrast: 20, shadows: -10, temperature: -10, clarity: 10 },
  },
  {
    id: 'documentary-35',
    name: 'Documentary 35',
    category: 'Editorial',
    description: 'Honest, balanced contrast inspired by editorial print journalism.',
    previewFilter: 'contrast(1.1) saturate(0.92) sepia(0.06)',
    recipeDelta: { contrast: 14, saturation: -8, temperature: 6, clarity: 16, blacks: -8 },
  },
  {
    id: 'soft-matte',
    name: 'Soft Print Matte',
    category: 'Print',
    description: 'Lifted shadow floor tailored for cotton rag fine-art prints.',
    previewFilter: 'brightness(1.04) contrast(0.92) saturate(0.95)',
    recipeDelta: { contrast: -12, blacks: 18, shadows: 22, highlights: -12, vibrance: 4 },
  },
  {
    id: 'vivid-plumage',
    name: 'Vivid Plumage',
    category: 'Nature',
    description: 'Colour-blind-safe saturation boost protecting warm reds and greens.',
    previewFilter: 'contrast(1.09) saturate(1.26) brightness(1.02)',
    recipeDelta: { vibrance: 28, saturation: 12, clarity: 18, highlights: -14, shadows: 14 },
  },
];

export const INITIAL_FONTS: FontOption[] = [
  { id: 'jakarta', label: 'Plus Jakarta Sans', family: '"Plus Jakarta Sans", sans-serif', category: 'Sans' },
  { id: 'playfair', label: 'Playfair Display', family: '"Playfair Display", Georgia, serif', category: 'Serif' },
  { id: 'outfit', label: 'Outfit', family: '"Outfit", sans-serif', category: 'Sans' },
  { id: 'jetbrains', label: 'JetBrains Mono', family: '"JetBrains Mono", monospace', category: 'Mono' },
  { id: 'fraunces', label: 'Fraunces', family: '"Fraunces", Georgia, serif', category: 'Serif' },
  { id: 'cormorant', label: 'Cormorant Garamond', family: '"Cormorant Garamond", Georgia, serif', category: 'Serif' },
  { id: 'bricolage', label: 'Bricolage Grotesque', family: '"Bricolage Grotesque", sans-serif', category: 'Display' },
  { id: 'dm-sans', label: 'DM Sans', family: '"DM Sans", sans-serif', category: 'Sans' },
  { id: 'syne', label: 'Syne', family: '"Syne", sans-serif', category: 'Display' },
  { id: 'lora', label: 'Lora', family: '"Lora", Georgia, serif', category: 'Serif' },
  { id: 'ibm-mono', label: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace', category: 'Mono' },
  { id: 'manrope', label: 'Manrope', family: '"Manrope", sans-serif', category: 'Sans' },
  { id: 'oswald', label: 'Oswald Condensed', family: '"Oswald", sans-serif', category: 'Display' },
  { id: 'caveat', label: 'Caveat Script', family: '"Caveat", cursive', category: 'Handwritten' },
];

export const INITIAL_WATERMARKS: WatermarkPreset[] = [
  { id: 'wm-inflight', label: 'InFlight Field Signature', text: '© D. LAWSON', subtext: 'HIGHLAND ARCHIVE' },
  { id: 'wm-minimal', label: 'Minimal Mono Mark', text: 'LAWSON · UK' },
  { id: 'wm-editorial', label: 'Editorial Plate Stamp', text: 'PLATE 04 // FIELD NOTES' },
];

export function createDefaultSizes(): SizePreset[] {
  return [
    {
      id: 'orig-3x2',
      label: 'Original 3:2',
      platform: 'print',
      width: 3000,
      height: 2000,
      ratioLabel: '3:2',
      kind: 'photo',
      enabled: true,
      linked: true,
      crop: { ...DEFAULT_CROP },
      boardX: 0,
      boardY: 0,
    },
    {
      id: 'ig-portrait',
      label: 'Instagram Portrait',
      platform: 'instagram',
      width: 1080,
      height: 1350,
      ratioLabel: '4:5',
      kind: 'photo',
      enabled: true,
      linked: true,
      crop: { ...DEFAULT_CROP },
      boardX: 0,
      boardY: 0,
    },
    {
      id: 'ig-square',
      label: 'Instagram Square',
      platform: 'instagram',
      width: 1080,
      height: 1080,
      ratioLabel: '1:1',
      kind: 'photo',
      enabled: false,
      linked: true,
      crop: { ...DEFAULT_CROP },
      boardX: 0,
      boardY: 0,
    },
    {
      id: 'ig-story',
      label: 'Instagram / TikTok Story',
      platform: 'instagram',
      width: 1080,
      height: 1920,
      ratioLabel: '9:16',
      kind: 'photo',
      enabled: false,
      linked: true,
      crop: { ...DEFAULT_CROP },
      boardX: 0,
      boardY: 0,
    },
    {
      id: 'yt-wide',
      label: 'YouTube / Widescreen',
      platform: 'youtube',
      width: 1920,
      height: 1080,
      ratioLabel: '16:9',
      kind: 'photo',
      enabled: true,
      linked: true,
      crop: { ...DEFAULT_CROP },
      boardX: 0,
      boardY: 0,
    },
    {
      id: 'x-feed',
      label: 'X / LinkedIn Post',
      platform: 'x',
      width: 1600,
      height: 900,
      ratioLabel: '16:9',
      kind: 'photo',
      enabled: false,
      linked: true,
      crop: { ...DEFAULT_CROP },
      boardX: 0,
      boardY: 0,
    },
    {
      id: 'video-zoom',
      label: 'Video (Zoom MP4)',
      platform: 'video',
      width: 1080,
      height: 1920,
      ratioLabel: '9:16 MP4',
      kind: 'video',
      enabled: false,
      linked: true,
      crop: { ...DEFAULT_CROP },
      boardX: 0,
      boardY: 0,
    },
  ];
}

export function createDefaultOverlay(enabled = false): OverlaySettings {
  return {
    textEnabled: enabled,
    textLayoutMode: 'as-is',
    textPosition: 'bottom-left',
    textX: 8,
    textY: 90,
    textOffsetX: 0,
    textOffsetY: 0,
    textColour: 'light',
    textScrim: true,
    rows: [
      {
        id: 'row-1',
        fields: ['camera', 'lens'],
        customText: '',
        fontId: 'jakarta',
        sizePx: 14,
        weight: 600,
        uppercase: false,
        letterSpacing: 0.2,
      },
      {
        id: 'row-2',
        fields: ['aperture', 'shutter', 'iso'],
        customText: '',
        fontId: 'jetbrains',
        sizePx: 12,
        weight: 500,
        uppercase: false,
        letterSpacing: 0.4,
      },
    ],
    watermarkEnabled: false,
    watermarkPresetId: 'wm-inflight',
    watermarkPosition: 'bottom-right',
    watermarkX: 92,
    watermarkY: 90,
    watermarkOpacity: 74,
    watermarkScale: 100,
    watermarkContrast: 'light-on-dark',
    snapEnabled: true,
  };
}

export function createEditGroups(withAltGroup = true): EditGroup[] {
  const mainGroup: EditGroup = {
    id: 'group-primary',
    name: 'Edit Group 1 · Clean Feed',
    recipe: { ...BASE_RECIPE },
    overlay: createDefaultOverlay(false),
    sizeIds: ['orig-3x2', 'ig-portrait', 'yt-wide'],
    splitFrames: false,
    splitPanOffset: 0,
  };
  if (!withAltGroup) return [mainGroup];
  const editorialGroup: EditGroup = {
    id: 'group-editorial',
    name: 'Edit Group 2 · EXIF Story Card',
    recipe: { ...BASE_RECIPE, lookId: 'golden-heather', temperature: 16, contrast: 12 },
    overlay: createDefaultOverlay(true),
    sizeIds: ['ig-portrait', 'ig-story'],
    splitFrames: false,
    splitPanOffset: 0,
  };
  return [mainGroup, editorialGroup];
}

const SAMPLE_BASES = [
  {
    src: '/v2-sample/kestrel.jpg',
    title: 'Hovering Highland Kestrel',
    species: 'Common Kestrel (Falco tinnunculus)',
    category: 'Wildlife',
    camera: 'Sony A7 IV',
    lens: 'FE 200–600mm f/5.6–6.3 G',
    aperture: 'f/6.3',
    shutter: '1/2500s',
    iso: 800,
    focalLength: '600mm',
    subjectNote:
      'Subject detected: Common Kestrel — eye sharpness is crisp. Chest plumage reads slightly cool/muted against the overcast moor; suggest +6 warmth and +8 vibrance.',
    colourConfidence: 'White balance verified neutral (5480K). No green/magenta tint drift.',
    kelvinEstimate: '5480K · Tint +1',
  },
  {
    src: '/v2-sample/glencoe.jpg',
    title: 'Glen Coe Dawn Ridge',
    species: 'Buachaille Etive Mòr',
    category: 'Landscape',
    camera: 'Fujifilm X-T5',
    lens: 'XF 16–55mm f/2.8 R LM WR',
    aperture: 'f/8.0',
    shutter: '1/125s',
    iso: 160,
    focalLength: '24mm',
    subjectNote:
      'Landscape valley detected — upper cloud highlights sit close to clipping while lower heather shadows can lift safely by +20.',
    colourConfidence: 'Cool blue shadow bias detected in glen floor; safe to warm by +8 without turning foliage orange.',
    kelvinEstimate: '6120K · Tint -2',
  },
  {
    src: '/v2-sample/lighthouse.jpg',
    title: 'Neist Point Sea Stack',
    species: 'Atlantic Headland',
    category: 'Coastal',
    camera: 'Nikon Z8',
    lens: 'NIKKOR Z 24–70mm f/2.8 S',
    aperture: 'f/9.0',
    shutter: '1/60s',
    iso: 100,
    focalLength: '35mm',
    subjectNote:
      'Horizon is level within 0.2°. Lighthouse white masonry is clean; subtle clarity (+14) brings out sea spray texture.',
    colourConfidence: 'Balanced slate-blue ocean and warm lantern highlight — strong contrast for deuteranopia & protanopia.',
    kelvinEstimate: '5820K · Tint 0',
  },
  {
    src: '/v2-sample/stag.jpg',
    title: 'Cairngorms Red Stag',
    species: 'Red Deer (Cervus elaphus)',
    category: 'Wildlife',
    camera: 'Canon EOS R5',
    lens: 'RF 100–500mm f/4.5–7.1 L',
    aperture: 'f/7.1',
    shutter: '1/1000s',
    iso: 1600,
    focalLength: '450mm',
    subjectNote:
      'Subject detected: Red Deer Stag in pine mist — ISO 1600 grain visible in dark conifer backdrop; RAW Deep Denoise recommended.',
    colourConfidence: 'Autumn coat tones sit cleanly in warm brown-amber range; avoid pushing saturation past +15.',
    kelvinEstimate: '5300K · Tint +2',
  },
];

function createStubPhotos(): Photo[] {
  const photos: Photo[] = [];
  for (let i = 0; i < 20; i++) {
    const base = SAMPLE_BASES[i % SAMPLE_BASES.length];
    const num = String(101 + i).padStart(4, '0');
    let state: Photo['state'] = 'ready';
    let originalConnected = true;

    if (i === 17) state = 'analysing';
    if (i === 18) state = 'importing';
    if (i === 3 || i === 19) {
      state = 'unavailable';
      originalConnected = false;
    }

    const decision: DecisionState = [0, 1, 2, 4, 7, 11].includes(i) ? 'keep' : 'unreviewed';
    const rating = decision === 'keep' ? (i % 2 === 0 ? 5 : 4) : i % 3 === 0 ? 3 : 2;
    const suffix = i < 4 ? '' : ` · Frame ${Math.floor(i / 4) + 1}`;

    photos.push({
      id: `photo-${i + 1}`,
      filename: `IFL_${num}.ARW`,
      title: `${base.title}${suffix}`,
      previewUrl: base.src,
      thumbUrl: base.src,
      state,
      decision,
      originalConnected,
      rating,
      speciesLabel: base.species,
      category: base.category,
      sharpnessScore: 84 + ((i * 7) % 15),
      exif: {
        camera: base.camera,
        lens: base.lens,
        aperture: base.aperture,
        shutter: base.shutter,
        iso: base.iso,
        focalLength: base.focalLength,
        capturedAt: `18 Oct 2026 · 0${7 + (i % 3)}:${String(12 + i * 2).slice(-2)}`,
        fileFormat: '16-bit RAW',
        fileSizeMb: Number((38.4 + (i % 6) * 2.1).toFixed(1)),
        dimensions: '7008 × 4672',
        colourProfile: 'Display P3',
      },
      activeGroupId: 'group-primary',
      editGroups: createEditGroups(true),
      sizes: createDefaultSizes(),
      videoZoom: {
        enabled: false,
        focalX: i % 4 === 0 ? 52 : 48,
        focalY: i % 4 === 0 ? 38 : 44,
        direction: 'in',
        durationSec: 6,
      },
      masks: [
        { id: `m-subj-${i}`, name: 'Subject (Auto)', type: 'subject', visible: true, feather: 18 },
        { id: `m-sky-${i}`, name: 'Sky', type: 'sky', visible: false, feather: 24 },
      ],
      assistCritique: {
        subjectNote: base.subjectNote,
        colourConfidence: base.colourConfidence,
        kelvinEstimate: base.kelvinEstimate,
        suggestions: [
          {
            id: `sug-1-${i}`,
            title: 'Warm plumage & lift shaded detail',
            summary: 'Adds +6 warmth, +8 vibrance, and lifts deep shadows (+22) without clipping highlights.',
            colourReadout: 'Warmth +6 · Vibrance +8 · Shadows +22',
            applied: false,
            recipeDelta: { temperature: 10, vibrance: 18, shadows: 22, highlights: -18 },
          },
          {
            id: `sug-2-${i}`,
            title: 'RAW Deep Denoise & feather micro-detail',
            summary: 'Clears high-ISO backdrop speckle while preserving crisp natural edges.',
            colourReadout: 'RAW Denoise On · Clarity +16 · Sharpen 32',
            applied: false,
            recipeDelta: { denoiseRawAi: true, denoiseLuminance: 32, clarity: 16, sharpen: 32 },
          },
          {
            id: `sug-3-${i}`,
            title: 'Balance mid-tone contrast for print & social',
            summary: 'Gentle S-curve equivalent that keeps whites luminous and blacks grounded.',
            colourReadout: 'Contrast +14 · Whites +8 · Blacks -8',
            applied: false,
            recipeDelta: { contrast: 14, whites: 8, blacks: -8 },
          },
        ],
      },
    });
  }
  return photos;
}

const INITIAL_PROJECTS: Project[] = [
  {
    id: 'proj-highlands',
    name: 'Scottish Highlands — Autumn Wildlife',
    updatedAt: 'Today · 10:18',
    coverUrl: '/v2-sample/kestrel.jpg',
    photoCount: 20,
    flaggedCount: 6,
    localCopyStatus: 'offline-ready',
    folderPath: '/Volumes/FieldSSD/Highlands_2026',
  },
  {
    id: 'proj-skye',
    name: 'Isle of Skye — Headland Light',
    updatedAt: 'Yesterday · 19:40',
    coverUrl: '/v2-sample/lighthouse.jpg',
    photoCount: 48,
    flaggedCount: 11,
    localCopyStatus: 'synced',
    folderPath: '/Volumes/FieldSSD/Skye_Coast',
  },
  {
    id: 'proj-cairngorms',
    name: 'Cairngorms Pinewood Stags',
    updatedAt: '14 Oct 2026',
    coverUrl: '/v2-sample/stag.jpg',
    photoCount: 64,
    flaggedCount: 14,
    localCopyStatus: 'offline-ready',
    folderPath: '/Volumes/ArchiveNAS/Cairngorms',
  },
];

const INITIAL_TASKS: TaskInfo[] = [
  {
    id: 'task-cull',
    label: 'Auto-Cull & 16-bit RAW analysis',
    detail: 'Rating sharpness & detecting subjects (17 of 20 complete)',
    progress: 85,
    status: 'running',
  },
  {
    id: 'task-copies',
    label: 'Building local fast working copies',
    detail: '2 remaining · Offline editing ready',
    progress: 64,
    status: 'running',
  },
  {
    id: 'task-lens',
    label: 'Optical lens profiles matched',
    detail: 'Sony, Fujifilm, Nikon & Canon RAW profiles verified',
    progress: 100,
    status: 'done',
  },
];

function createDefaultPanels(): Record<PanelId, PanelLayoutState> {
  return {
    copilot: { visible: true, dock: 'left', floatX: 110, floatY: 88 },
    adjust: { visible: true, dock: 'left', floatX: 110, floatY: 88 },
    formats: { visible: true, dock: 'left', floatX: 110, floatY: 88 },
    masks: { visible: true, dock: 'left', floatX: 110, floatY: 88 },
    enhance: { visible: true, dock: 'left', floatX: 110, floatY: 88 },
    overlays: { visible: true, dock: 'left', floatX: 110, floatY: 88 },
    assist: { visible: true, dock: 'right', floatX: 980, floatY: 88 },
    info: { visible: true, dock: 'right', floatX: 980, floatY: 88 },
    tasks: { visible: true, dock: 'right', floatX: 980, floatY: 88 },
  };
}

export const DEFAULT_FEATURE_PLAN: Record<FeatureKey, 'basic' | 'pro'> = {
  watermarkCustom: 'pro',
  overlayText: 'pro',
  smartCulling: 'pro',
  speciesId: 'pro',
  onlineAi: 'pro',
  cloudAssist: 'pro',
  zoomVideo: 'basic',
  splitFrames: 'basic',
};

export const DEFAULT_FEATURES: Record<FeatureKey, boolean> = {
  watermarkCustom: true,
  overlayText: true,
  smartCulling: true,
  speciesId: true,
  onlineAi: true,
  cloudAssist: true,
  zoomVideo: true,
  splitFrames: true,
};

function logAction(name: string, payload?: unknown) {
  if (typeof console !== 'undefined') {
    console.info(`[InFlight Stub Action] ${name}`, payload ?? '');
  }
}

export function useWorkspace(): { store: WorkspaceStore; actions: WorkspaceActions } {
  const autostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [store, setStore] = useState<WorkspaceStore>(() => ({
    screen: autostart ? 'editor' : 'hub',
    hubState: 'ready',
    projects: INITIAL_PROJECTS,
    activeProjectId: 'proj-highlands',
    photos: createStubPhotos(),
    activePhotoId: 'photo-1',
    selectedPhotoIds: ['photo-1'],
    activeSizeId: 'orig-3x2',
    selectedSizeIds: ['orig-3x2'],
    canvasLayoutMode: 'single',
    bottomTab: 'filmstrip',
    assistMode: 'copilot',
    features: DEFAULT_FEATURES,
    featurePlan: DEFAULT_FEATURE_PLAN,
    looks: INITIAL_LOOKS,
    hoveredLookId: null,
    fonts: INITIAL_FONTS,
    watermarkPresets: INITIAL_WATERMARKS,
    tasks: INITIAL_TASKS,
    settings: {
      theme: 'dark',
      calmView: false,
      touchDensity: 'comfortable',
      cvdGuidance: true,
      ongoingCritique: true,
      defaultAssistMode: 'copilot',
      language: 'en-GB',
      account: {
        signedIn: false,
      },
      aiProviders: [
        {
          id: 'local',
          name: 'InFlight Local RAW Models',
          description: 'Built-in offline subject detection, sharpness scoring, and colour balance checks.',
          connected: true,
          modelLabel: 'On-device · Always private',
        },
        {
          id: 'gemini',
          name: 'Google Gemini',
          description: 'Optional connected vision critique for Deep Vision Review & species checks.',
          connected: true,
          modelLabel: 'Bring Your Own Key',
        },
        {
          id: 'claude',
          name: 'Anthropic Claude',
          description: 'Connect your Claude account for natural-language composition notes.',
          connected: false,
          modelLabel: 'Not linked',
        },
        {
          id: 'chatgpt',
          name: 'OpenAI ChatGPT',
          description: 'Connect your OpenAI account for editorial critique.',
          connected: false,
          modelLabel: 'Not linked',
        },
      ],
      storageConnectors: [
        { id: 'dropbox', name: 'Dropbox', status: 'connected', accountLabel: 'studio@lawson-uk.org' },
        { id: 'onedrive', name: 'Microsoft OneDrive', status: 'not-connected' },
        { id: 'google-drive', name: 'Google Drive', status: 'connected', accountLabel: 'Field Archive' },
        { id: 'nas', name: 'Local NAS (SMB / WebDAV)', status: 'connected', accountLabel: 'smb://nas.local/Photos' },
      ],
      localCacheLimitGb: 25,
    },
    activePanel: 'adjust',
    panels: createDefaultPanels(),
    filmstripCollapsed: false,
    filmstripHeight: 152,
    filmstripFilter: 'all',
    filmstripSearch: '',
    gridViewOpen: false,
    compareMode: false,
    canvasZoom: 1,
    isFullScreen: false,
    exportOpen: false,
    settingsOpen: false,
    settingsTab: 'appearance',
    activeMaskTool: 'subject',
    canUndo: false,
    canRedo: false,
    clipboardRecipe: null,
    lastActionNotice: null,
  }));

  // Simple in-memory undo/redo stack for recipe edits
  const [undoStack, setUndoStack] = useState<Array<{ photoId: string; groupId: string; recipe: EditRecipe }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ photoId: string; groupId: string; recipe: EditRecipe }>>([]);

  // The theme is applied by App on the .inflight-v2 root (data-v2-theme), never on the document.

  // Sync undo/redo availability flags
  useEffect(() => {
    setStore((prev) =>
      prev.canUndo === (undoStack.length > 0) && prev.canRedo === (redoStack.length > 0)
        ? prev
        : { ...prev, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }
    );
  }, [undoStack.length, redoStack.length]);

  const showNotice = useCallback((msg: string) => {
    setStore((prev) => ({ ...prev, lastActionNotice: msg }));
  }, []);

  const updatePhotoById = useCallback(
    (photoId: string, updater: (photo: Photo) => Photo) => {
      setStore((prev) => ({
        ...prev,
        photos: prev.photos.map((p) => (p.id === photoId ? updater(p) : p)),
      }));
    },
    []
  );

  const actions = useMemo<WorkspaceActions>(() => ({
    openProject: (projectId) => {
      logAction('openProject', { projectId });
      setStore((prev) => ({
        ...prev,
        activeProjectId: projectId,
        screen: 'editor',
        gridViewOpen: false,
      }));
    },

    backToProjects: () => {
      logAction('backToProjects');
      setStore((prev) => ({
        ...prev,
        screen: 'hub',
        gridViewOpen: false,
      }));
    },

    createProject: (name) => {
      const clean = name.trim();
      if (!clean) return;
      logAction('createProject', { name: clean });
      const newProject: Project = {
        id: `proj-${Date.now()}`,
        name: clean,
        updatedAt: 'Just now',
        coverUrl: '/v2-sample/glencoe.jpg',
        photoCount: 20,
        flaggedCount: 6,
        localCopyStatus: 'offline-ready',
        folderPath: `/Volumes/FieldSSD/${clean.replace(/\s+/g, '_')}`,
      };
      setStore((prev) => ({
        ...prev,
        hubState: 'ready',
        projects: [newProject, ...prev.projects],
        activeProjectId: newProject.id,
        screen: 'editor',
        lastActionNotice: `Created project "${clean}"`,
      }));
    },

    setHubState: (hubState) => {
      logAction('setHubState', { hubState });
      setStore((prev) => ({ ...prev, hubState }));
    },

    selectPhoto: (photoId, modifiers) => {
      logAction('selectPhoto', { photoId, modifiers });
      setStore((prev) => {
        const orderedIds = prev.photos.map((p) => p.id);
        const nextSelection = computeMultiSelection(
          orderedIds,
          prev.selectedPhotoIds,
          prev.activePhotoId,
          photoId,
          modifiers
        );
        return {
          ...prev,
          activePhotoId: photoId,
          selectedPhotoIds: nextSelection,
        };
      });
    },

    selectAllPhotos: () => {
      logAction('selectAllPhotos');
      setStore((prev) => ({
        ...prev,
        selectedPhotoIds: prev.photos.map((p) => p.id),
      }));
    },

    clearSelection: () => {
      logAction('clearSelection');
      setStore((prev) => ({
        ...prev,
        selectedPhotoIds: prev.activePhotoId ? [prev.activePhotoId] : [],
      }));
    },

    setDecision: (photoIds, decision) => {
      logAction('setDecision', { photoIds, decision });
      setStore((prev) => {
        const idSet = new Set(photoIds);
        const photos = prev.photos.map((p) =>
          idSet.has(p.id) ? { ...p, decision } : p
        );
        const flaggedCount = photos.filter((p) => p.decision === 'keep').length;
        const projects = prev.projects.map((proj) =>
          proj.id === prev.activeProjectId ? { ...proj, flaggedCount } : proj
        );
        return { ...prev, photos, projects };
      });
    },

    toggleFlag: (photoIds) => {
      logAction('toggleFlag', { photoIds });
      setStore((prev) => {
        const idSet = new Set(photoIds);
        const targets = prev.photos.filter((p) => idSet.has(p.id));
        const allFlagged = targets.length > 0 && targets.every((p) => p.decision === 'keep');
        const nextDecision: DecisionState = allFlagged ? 'unreviewed' : 'keep';
        const photos = prev.photos.map((p) =>
          idSet.has(p.id) ? { ...p, decision: nextDecision } : p
        );
        const flaggedCount = photos.filter((p) => p.decision === 'keep').length;
        const projects = prev.projects.map((proj) =>
          proj.id === prev.activeProjectId ? { ...proj, flaggedCount } : proj
        );
        return {
          ...prev,
          photos,
          projects,
          lastActionNotice:
            nextDecision === 'keep'
              ? `Flagged ${photoIds.length} ${photoIds.length === 1 ? 'photo' : 'photos'}`
              : `Removed flag from ${photoIds.length} ${photoIds.length === 1 ? 'photo' : 'photos'}`,
        };
      });
    },

    setRating: (photoIds, rating) => {
      logAction('setRating', { photoIds, rating });
      const clamped = Math.max(0, Math.min(5, rating));
      setStore((prev) => {
        const idSet = new Set(photoIds);
        return {
          ...prev,
          photos: prev.photos.map((p) => (idSet.has(p.id) ? { ...p, rating: clamped } : p)),
          lastActionNotice: `Set rating to ${clamped} ${clamped === 1 ? 'star' : 'stars'}`,
        };
      });
    },

    importPhotos: () => {
      logAction('importPhotos');
      const taskId = `task-import-${Date.now()}`;
      setStore((prev) => ({
        ...prev,
        tasks: [
          {
            id: taskId,
            label: 'Importing photographs & generating 16-bit previews',
            detail: 'Reading camera card folder…',
            progress: 42,
            status: 'running',
          },
          ...prev.tasks,
        ],
        lastActionNotice: 'Import queued — check Tasks for progress',
      }));
    },

    runAutoCull: () => {
      logAction('runAutoCull');
      const taskId = `task-autocull-${Date.now()}`;
      setStore((prev) => ({
        ...prev,
        tasks: [
          {
            id: taskId,
            label: 'Auto-Cull & Analyse running',
            detail: 'Scoring eye sharpness, detecting subjects & flagging top frames',
            progress: 72,
            status: 'running',
          },
          ...prev.tasks.filter((t) => !t.id.startsWith('task-autocull-')),
        ],
        photos: prev.photos.map((p) =>
          p.state === 'analysing' ? { ...p, state: 'ready', decision: 'keep' } : p
        ),
        lastActionNotice: 'Auto-Cull & Analyse updated focus shortlist (no photos auto-rejected)',
      }));
    },

    reconnectOriginal: (photoId) => {
      logAction('reconnectOriginal', { photoId });
      updatePhotoById(photoId, (p) => ({
        ...p,
        originalConnected: true,
        state: 'ready',
      }));
      showNotice('Original RAW folder reconnected');
    },

    toggleDemoUnavailable: () => {
      logAction('toggleDemoUnavailable');
      setStore((prev) => {
        if (!prev.activePhotoId) return prev;
        return {
          ...prev,
          photos: prev.photos.map((p) =>
            p.id === prev.activePhotoId
              ? {
                  ...p,
                  originalConnected: !p.originalConnected,
                  state: p.originalConnected ? 'unavailable' : 'ready',
                }
              : p
          ),
        };
      });
    },

    setAssistMode: (mode) => {
      logAction('setAssistMode', { mode });
      setStore((prev) => {
        // In Auto-pilot, automatically mark top suggestions applied on active photo
        const nextPhotos =
          mode === 'autopilot' && prev.activePhotoId
            ? prev.photos.map((p) => {
                if (p.id !== prev.activePhotoId) return p;
                const firstSug = p.assistCritique.suggestions[0];
                if (!firstSug || firstSug.applied) return p;
                return {
                  ...p,
                  editGroups: p.editGroups.map((g) =>
                    g.id === p.activeGroupId
                      ? { ...g, recipe: { ...g.recipe, ...firstSug.recipeDelta } }
                      : g
                  ),
                  assistCritique: {
                    ...p.assistCritique,
                    suggestions: p.assistCritique.suggestions.map((s) =>
                      s.id === firstSug.id ? { ...s, applied: true } : s
                    ),
                  },
                };
              })
            : prev.photos;
        return {
          ...prev,
          assistMode: mode,
          photos: nextPhotos,
          lastActionNotice:
            mode === 'autopilot'
              ? 'Auto-pilot active — automatic culling and smart edits enabled'
              : mode === 'copilot'
              ? 'Co-pilot active — InFlight reviews and suggests edits for your approval'
              : 'Solo active — full manual control',
        };
      });
    },

    runDeepVisionReview: (photoId) => {
      logAction('runDeepVisionReview', { photoId });
      setStore((prev) => ({
        ...prev,
        tasks: [
          {
            id: `task-dvr-${Date.now()}`,
            label: 'Deep Vision Review',
            detail: 'Combining internal RAW models + connected AI critique',
            progress: 100,
            status: 'done',
          },
          ...prev.tasks,
        ],
        lastActionNotice: 'Deep Vision Review complete — suggestions refreshed',
      }));
    },

    applyAssistSuggestion: (photoId, suggestionId) => {
      logAction('applyAssistSuggestion', { photoId, suggestionId });
      updatePhotoById(photoId, (photo) => {
        const sug = photo.assistCritique.suggestions.find((s) => s.id === suggestionId);
        if (!sug) return photo;
        return {
          ...photo,
          editGroups: photo.editGroups.map((g) =>
            g.id === photo.activeGroupId
              ? { ...g, recipe: { ...g.recipe, ...sug.recipeDelta } }
              : g
          ),
          assistCritique: {
            ...photo.assistCritique,
            suggestions: photo.assistCritique.suggestions.map((s) =>
              s.id === suggestionId ? { ...s, applied: true } : s
            ),
          },
        };
      });
      showNotice('Applied suggested adjustment');
    },

    applyAllAssistSuggestions: (photoId) => {
      logAction('applyAllAssistSuggestions', { photoId });
      updatePhotoById(photoId, (photo) => {
        const combined = photo.assistCritique.suggestions.reduce<Partial<EditRecipe>>(
          (acc, s) => ({ ...acc, ...s.recipeDelta }),
          {}
        );
        return {
          ...photo,
          editGroups: photo.editGroups.map((g) =>
            g.id === photo.activeGroupId ? { ...g, recipe: { ...g.recipe, ...combined } } : g
          ),
          assistCritique: {
            ...photo.assistCritique,
            suggestions: photo.assistCritique.suggestions.map((s) => ({ ...s, applied: true })),
          },
        };
      });
      showNotice('Applied all Deep Vision Review recommendations');
    },

    dismissAssistSuggestion: (photoId, suggestionId) => {
      logAction('dismissAssistSuggestion', { photoId, suggestionId });
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        assistCritique: {
          ...photo.assistCritique,
          suggestions: photo.assistCritique.suggestions.filter((s) => s.id !== suggestionId),
        },
      }));
    },

    updateRecipe: (photoId, patch) => {
      setStore((prev) => {
        const photo = prev.photos.find((p) => p.id === photoId);
        if (photo) {
          const group = getActiveGroup(photo);
          setUndoStack((u) => [...u.slice(-24), { photoId, groupId: group.id, recipe: group.recipe }]);
          setRedoStack([]);
        }
        const targetPhotoIds = new Set(
          prev.selectedPhotoIds.length > 1 && prev.selectedPhotoIds.includes(photoId)
            ? prev.selectedPhotoIds
            : [photoId]
        );
        return {
          ...prev,
          photos: prev.photos.map((p) =>
            targetPhotoIds.has(p.id)
              ? {
                  ...p,
                  editGroups: p.editGroups.map((g) =>
                    g.id === p.activeGroupId ? { ...g, recipe: { ...g.recipe, ...patch } } : g
                  ),
                }
              : p
          ),
        };
      });
    },

    applyLook: (photoId, lookId) => {
      logAction('applyLook', { photoId, lookId });
      const look = INITIAL_LOOKS.find((l) => l.id === lookId);
      if (!look) return;
      // Directly set all main sliders to the Look's neutral baseline + Look delta so sliders visibly move
      const neutralLookBase: Partial<EditRecipe> = {
        exposure: 0,
        highlights: 0,
        shadows: 0,
        contrast: 0,
        whites: 0,
        blacks: 0,
        temperature: 0,
        tint: 0,
        vibrance: 0,
        saturation: 0,
        clarity: 0,
        sharpen: 20,
      };
      setStore((prev) => {
        const targetIds = prev.selectedPhotoIds.length > 1 ? prev.selectedPhotoIds : [photoId];
        const idSet = new Set(targetIds);
        return {
          ...prev,
          hoveredLookId: null,
          photos: prev.photos.map((p) =>
            idSet.has(p.id)
              ? {
                  ...p,
                  editGroups: p.editGroups.map((g) =>
                    g.id === p.activeGroupId
                      ? { ...g, recipe: { ...g.recipe, ...neutralLookBase, ...look.recipeDelta, lookId } }
                      : g
                  ),
                }
              : p
          ),
          lastActionNotice: `Applied "${look.name}" — sliders updated`,
        };
      });
    },

    setHoveredLook: (lookId) => {
      setStore((prev) => (prev.hoveredLookId === lookId ? prev : { ...prev, hoveredLookId: lookId }));
    },

    resetPhotoEdits: (photoId) => {
      logAction('resetPhotoEdits', { photoId });
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        editGroups: photo.editGroups.map((g) =>
          g.id === photo.activeGroupId
            ? {
                ...g,
                recipe: {
                  ...BASE_RECIPE,
                  exposure: 0,
                  highlights: 0,
                  shadows: 0,
                  contrast: 0,
                  whites: 0,
                  blacks: 0,
                  temperature: 0,
                  tint: 0,
                  vibrance: 0,
                  saturation: 0,
                  clarity: 0,
                  sharpen: 15,
                  lookId: 'natural-raw',
                },
              }
            : g
        ),
      }));
      showNotice('Photo adjustments reset');
    },

    copyRecipe: () => {
      setStore((prev) => {
        const photo = prev.photos.find((p) => p.id === prev.activePhotoId);
        if (!photo) return prev;
        const group = getActiveGroup(photo);
        logAction('copyRecipe', { photoId: photo.id });
        return {
          ...prev,
          clipboardRecipe: { ...group.recipe },
          lastActionNotice: 'Copied adjustments to clipboard',
        };
      });
    },

    pasteRecipe: () => {
      setStore((prev) => {
        if (!prev.clipboardRecipe || !prev.activePhotoId) return prev;
        const targetIds = new Set(
          prev.selectedPhotoIds.length > 0 ? prev.selectedPhotoIds : [prev.activePhotoId]
        );
        logAction('pasteRecipe', { targetCount: targetIds.size });
        return {
          ...prev,
          photos: prev.photos.map((p) =>
            targetIds.has(p.id)
              ? {
                  ...p,
                  editGroups: p.editGroups.map((g) =>
                    g.id === p.activeGroupId ? { ...g, recipe: { ...prev.clipboardRecipe! } } : g
                  ),
                }
              : p
          ),
          lastActionNotice: `Pasted adjustments to ${targetIds.size} ${targetIds.size === 1 ? 'photo' : 'photos'}`,
        };
      });
    },

    undo: () => {
      logAction('undo');
      setUndoStack((prevUndo) => {
        if (prevUndo.length === 0) return prevUndo;
        const last = prevUndo[prevUndo.length - 1];
        setStore((prev) => {
          const photo = prev.photos.find((p) => p.id === last.photoId);
          const currentGroup = photo?.editGroups.find((g) => g.id === last.groupId);
          if (currentGroup) {
            setRedoStack((r) => [...r, { photoId: last.photoId, groupId: last.groupId, recipe: currentGroup.recipe }]);
          }
          return {
            ...prev,
            photos: prev.photos.map((p) =>
              p.id === last.photoId
                ? {
                    ...p,
                    editGroups: p.editGroups.map((g) =>
                      g.id === last.groupId ? { ...g, recipe: last.recipe } : g
                    ),
                  }
                : p
            ),
            lastActionNotice: 'Undid last adjustment',
          };
        });
        return prevUndo.slice(0, -1);
      });
    },

    redo: () => {
      logAction('redo');
      setRedoStack((prevRedo) => {
        if (prevRedo.length === 0) return prevRedo;
        const next = prevRedo[prevRedo.length - 1];
        setStore((prev) => ({
          ...prev,
          photos: prev.photos.map((p) =>
            p.id === next.photoId
              ? {
                  ...p,
                  editGroups: p.editGroups.map((g) =>
                    g.id === next.groupId ? { ...g, recipe: next.recipe } : g
                  ),
                }
              : p
          ),
          lastActionNotice: 'Redid adjustment',
        }));
        return prevRedo.slice(0, -1);
      });
    },

    setActiveGroup: (photoId, groupId) => {
      logAction('setActiveGroup', { photoId, groupId });
      updatePhotoById(photoId, (p) => ({ ...p, activeGroupId: groupId }));
    },

    addEditGroup: (photoId) => {
      logAction('addEditGroup', { photoId });
      updatePhotoById(photoId, (photo) => {
        const index = photo.editGroups.length + 1;
        const active = getActiveGroup(photo);
        const newGroup: EditGroup = {
          id: `group-${Date.now()}`,
          name: `Edit Group ${index} · Variant`,
          recipe: { ...active.recipe },
          overlay: {
            ...active.overlay,
            rows: active.overlay.rows.map((r) => ({ ...r })),
          },
          sizeIds: ['ig-portrait', 'ig-square'],
          splitFrames: false,
          splitPanOffset: 0,
        };
        return {
          ...photo,
          activeGroupId: newGroup.id,
          editGroups: [...photo.editGroups, newGroup],
        };
      });
      showNotice('Added independent edit group');
    },

    renameEditGroup: (photoId, groupId, name) => {
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        editGroups: photo.editGroups.map((g) => (g.id === groupId ? { ...g, name } : g)),
      }));
    },

    setActiveSize: (sizeId, modifiers) => {
      logAction('setActiveSize', { sizeId, modifiers });
      setStore((prev) => {
        if (modifiers?.ctrl) {
          const exists = prev.selectedSizeIds.includes(sizeId);
          const next = exists
            ? prev.selectedSizeIds.filter((id) => id !== sizeId)
            : [...prev.selectedSizeIds, sizeId];
          return {
            ...prev,
            activeSizeId: sizeId,
            selectedSizeIds: next.length > 0 ? next : [sizeId],
          };
        }
        return {
          ...prev,
          activeSizeId: sizeId,
          selectedSizeIds: [sizeId],
        };
      });
    },

    selectAllEnabledSizes: (photoId) => {
      logAction('selectAllEnabledSizes', { photoId });
      setStore((prev) => {
        const photo = prev.photos.find((p) => p.id === photoId);
        if (!photo) return prev;
        const enabledIds = photo.sizes.filter((s) => s.enabled).map((s) => s.id);
        return {
          ...prev,
          selectedSizeIds: enabledIds.length > 0 ? enabledIds : [prev.activeSizeId],
          lastActionNotice: `Selected all ${enabledIds.length} active formats for group edits`,
        };
      });
    },

    setCanvasLayoutMode: (canvasLayoutMode) => {
      logAction('setCanvasLayoutMode', { canvasLayoutMode });
      setStore((prev) => ({ ...prev, canvasLayoutMode }));
    },

    moveSizeArtboard: (photoId, sizeId, boardX, boardY) => {
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        sizes: photo.sizes.map((s) =>
          s.id === sizeId ? { ...s, boardX: Math.round(boardX), boardY: Math.round(boardY) } : s
        ),
      }));
    },

    resetArtboardPositions: (photoId) => {
      logAction('resetArtboardPositions', { photoId });
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        sizes: photo.sizes.map((s) => ({ ...s, boardX: 0, boardY: 0 })),
      }));
      showNotice('Aligned all format boards neatly');
    },

    toggleSizeEnabled: (photoId, sizeId) => {
      logAction('toggleSizeEnabled', { photoId, sizeId });
      updatePhotoById(photoId, (photo) => {
        const sizes = photo.sizes.map((s) =>
          s.id === sizeId ? { ...s, enabled: !s.enabled } : s
        );
        const videoSize = sizes.find((s) => s.kind === 'video');
        return {
          ...photo,
          sizes,
          videoZoom: videoSize
            ? { ...photo.videoZoom, enabled: videoSize.enabled }
            : photo.videoZoom,
        };
      });
    },

    toggleSizeLinked: (photoId, sizeId) => {
      logAction('toggleSizeLinked', { photoId, sizeId });
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        sizes: photo.sizes.map((s) =>
          s.id === sizeId ? { ...s, linked: !s.linked } : s
        ),
      }));
    },

    updateSizeCrop: (photoId, sizeId, patch) => {
      setStore((prev) => {
        // Apply to multiple selected formats if user multi-selected formats; otherwise only the single target format!
        const targetSizeIds = new Set(
          prev.selectedSizeIds.length > 1 && prev.selectedSizeIds.includes(sizeId)
            ? prev.selectedSizeIds
            : [sizeId]
        );
        return {
          ...prev,
          photos: prev.photos.map((photo) =>
            photo.id === photoId
              ? {
                  ...photo,
                  sizes: photo.sizes.map((s) =>
                    targetSizeIds.has(s.id) ? { ...s, crop: { ...s.crop, ...patch } } : s
                  ),
                }
              : photo
          ),
        };
      });
    },

    flipSelectedSizes: (photoId, axis) => {
      logAction('flipSelectedSizes', { photoId, axis });
      setStore((prev) => {
        const targetSizeIds = new Set(
          prev.selectedSizeIds.length > 0 ? prev.selectedSizeIds : [prev.activeSizeId]
        );
        return {
          ...prev,
          photos: prev.photos.map((photo) =>
            photo.id === photoId
              ? {
                  ...photo,
                  sizes: photo.sizes.map((s) => {
                    if (!targetSizeIds.has(s.id)) return s;
                    return {
                      ...s,
                      crop:
                        axis === 'horizontal'
                          ? { ...s.crop, flipH: !s.crop.flipH }
                          : { ...s.crop, flipV: !s.crop.flipV },
                    };
                  }),
                }
              : photo
          ),
          lastActionNotice:
            targetSizeIds.size === 1
              ? `Flipped selected format ${axis}ly (other formats unchanged)`
              : `Flipped ${targetSizeIds.size} selected formats ${axis}ly`,
        };
      });
    },

    rotateSelectedSizes: (photoId) => {
      logAction('rotateSelectedSizes', { photoId });
      setStore((prev) => {
        const targetSizeIds = new Set(
          prev.selectedSizeIds.length > 0 ? prev.selectedSizeIds : [prev.activeSizeId]
        );
        return {
          ...prev,
          photos: prev.photos.map((photo) =>
            photo.id === photoId
              ? {
                  ...photo,
                  sizes: photo.sizes.map((s) =>
                    targetSizeIds.has(s.id)
                      ? { ...s, crop: { ...s.crop, rotateDeg: (s.crop.rotateDeg + 90) % 360 } }
                      : s
                  ),
                }
              : photo
          ),
          lastActionNotice:
            targetSizeIds.size === 1
              ? 'Rotated selected format 90° (other formats unchanged)'
              : `Rotated ${targetSizeIds.size} selected formats 90°`,
        };
      });
    },

    resetSizeCrop: (photoId, sizeId) => {
      logAction('resetSizeCrop', { photoId, sizeId });
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        sizes: photo.sizes.map((s) =>
          s.id === sizeId ? { ...s, crop: { ...DEFAULT_CROP } } : s
        ),
      }));
    },

    addCustomSize: (photoId, label, width, height) => {
      logAction('addCustomSize', { photoId, label, width, height });
      const id = `custom-${Date.now()}`;
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        sizes: [
          ...photo.sizes,
          {
            id,
            label: label.trim() || `${width}×${height}`,
            platform: 'custom',
            width,
            height,
            ratioLabel: `${width}×${height}`,
            kind: 'photo',
            enabled: true,
            linked: true,
            crop: { ...DEFAULT_CROP },
            boardX: 0,
            boardY: 0,
          },
        ],
      }));
      setStore((prev) => ({ ...prev, activeSizeId: id, selectedSizeIds: [id] }));
    },

    toggleSplitFrames: (photoId) => {
      logAction('toggleSplitFrames', { photoId });
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        editGroups: photo.editGroups.map((g) =>
          g.id === photo.activeGroupId ? { ...g, splitFrames: !g.splitFrames } : g
        ),
      }));
    },

    setSplitPanOffset: (photoId, offset) => {
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        editGroups: photo.editGroups.map((g) =>
          g.id === photo.activeGroupId ? { ...g, splitPanOffset: offset } : g
        ),
      }));
    },

    updateVideoZoom: (photoId, patch) => {
      logAction('updateVideoZoom', { photoId, patch });
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        videoZoom: { ...photo.videoZoom, ...patch },
        sizes:
          patch.enabled !== undefined
            ? photo.sizes.map((s) =>
                s.kind === 'video' ? { ...s, enabled: patch.enabled! } : s
              )
            : photo.sizes,
      }));
    },

    updateOverlay: (photoId, patch) => {
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        editGroups: photo.editGroups.map((g) =>
          g.id === photo.activeGroupId ? { ...g, overlay: { ...g.overlay, ...patch } } : g
        ),
      }));
    },

    alignOverlaysCleanly: (photoId, layout) => {
      logAction('alignOverlaysCleanly', { photoId, layout });
      const presets = {
        'stacked-left': {
          textPosition: 'bottom-left' as const,
          textX: 8,
          textY: 90,
          watermarkPosition: 'bottom-left' as const,
          watermarkX: 8,
          watermarkY: 78,
        },
        'opposite-bottom': {
          textPosition: 'bottom-left' as const,
          textX: 8,
          textY: 90,
          watermarkPosition: 'bottom-right' as const,
          watermarkX: 92,
          watermarkY: 90,
        },
        'centred-pair': {
          textPosition: 'bottom-center' as const,
          textX: 50,
          textY: 88,
          watermarkPosition: 'bottom-center' as const,
          watermarkX: 50,
          watermarkY: 76,
        },
      };
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        editGroups: photo.editGroups.map((g) =>
          g.id === photo.activeGroupId
            ? { ...g, overlay: { ...g.overlay, ...presets[layout], textOffsetX: 0, textOffsetY: 0 } }
            : g
        ),
      }));
      showNotice('Aligned text overlay and watermark cleanly');
    },

    addOverlayRow: (photoId) => {
      logAction('addOverlayRow', { photoId });
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        editGroups: photo.editGroups.map((g) => {
          if (g.id !== photo.activeGroupId) return g;
          const newRow: OverlayTextRow = {
            id: `row-${Date.now()}`,
            fields: ['species'],
            customText: '',
            fontId: 'playfair',
            sizePx: 14,
            weight: 500,
            uppercase: false,
            letterSpacing: 0.2,
          };
          return {
            ...g,
            overlay: {
              ...g.overlay,
              textEnabled: true,
              rows: [...g.overlay.rows, newRow],
            },
          };
        }),
      }));
    },

    updateOverlayRow: (photoId, rowId, patch) => {
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        editGroups: photo.editGroups.map((g) =>
          g.id === photo.activeGroupId
            ? {
                ...g,
                overlay: {
                  ...g.overlay,
                  rows: g.overlay.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
                },
              }
            : g
        ),
      }));
    },

    removeOverlayRow: (photoId, rowId) => {
      logAction('removeOverlayRow', { photoId, rowId });
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        editGroups: photo.editGroups.map((g) =>
          g.id === photo.activeGroupId
            ? {
                ...g,
                overlay: {
                  ...g.overlay,
                  rows: g.overlay.rows.filter((r) => r.id !== rowId),
                },
              }
            : g
        ),
      }));
    },

    addCustomFont: (fontName) => {
      const clean = fontName.trim();
      if (!clean) return;
      logAction('addCustomFont', { fontName: clean });
      const newFont: FontOption = {
        id: `custom-${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        label: clean,
        family: `"${clean}", var(--font-sans)`,
        category: 'Custom',
        isDevice: true,
      };
      setStore((prev) => ({
        ...prev,
        fonts: [newFont, ...prev.fonts.filter((f) => f.id !== newFont.id)],
        lastActionNotice: `Added font "${clean}" to overlay picker`,
      }));
    },

    setActiveMaskTool: (activeMaskTool) => {
      logAction('setActiveMaskTool', { activeMaskTool });
      setStore((prev) => ({ ...prev, activeMaskTool }));
    },

    addMaskLayer: (photoId, type) => {
      logAction('addMaskLayer', { photoId, type });
      const names: Record<MaskLayer['type'], string> = {
        subject: 'Subject (Auto)',
        sky: 'Sky',
        background: 'Background',
        brush: 'Brush Mask',
        area: 'Selected Area',
      };
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        masks: [
          ...photo.masks,
          { id: `mask-${Date.now()}`, name: names[type], type, visible: true, feather: 20 },
        ],
      }));
      showNotice(`Added ${names[type]} mask layer`);
    },

    toggleMaskLayer: (photoId, maskId) => {
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        masks: photo.masks.map((m) => (m.id === maskId ? { ...m, visible: !m.visible } : m)),
      }));
    },

    removeMaskLayer: (photoId, maskId) => {
      updatePhotoById(photoId, (photo) => ({
        ...photo,
        masks: photo.masks.filter((m) => m.id !== maskId),
      }));
    },

    clearTask: (taskId) => {
      logAction('clearTask', { taskId });
      setStore((prev) => ({ ...prev, tasks: prev.tasks.filter((task) => task.id !== taskId || task.status === 'running') }));
    },
    clearCompletedTasks: () => {
      logAction('clearCompletedTasks');
      setStore((prev) => ({ ...prev, tasks: prev.tasks.filter((task) => task.status === 'running') }));
    },
    cancelTask: (taskId) => {
      logAction('cancelTask', { taskId });
      setStore((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId ? { ...t, status: 'cancelled' } : t
        ),
      }));
    },

    setExportOpen: (exportOpen) => {
      logAction('setExportOpen', { exportOpen });
      setStore((prev) => ({ ...prev, exportOpen }));
    },

    runExport: (request: ExportRequest) => {
      logAction('runExport', request);
      const count = request.photoIds.length;
      const formatCount = request.sizeIds.length + (request.includeVideo ? 1 : 0);
      setStore((prev) => ({
        ...prev,
        exportOpen: false,
        tasks: [
          {
            id: `task-export-${Date.now()}`,
            label: `Exporting ${count} ${count === 1 ? 'photo' : 'photos'} (${formatCount} formats)`,
            detail: `Destination: ${request.destination}`,
            progress: 100,
            status: 'done',
          },
          ...prev.tasks,
        ],
        lastActionNotice: `Export queued for ${count} ${count === 1 ? 'photo' : 'photos'} → ${request.destination}`,
      }));
    },

    setActivePanel: (panelId) => {
      setStore((prev) => {
        if (panelId === null) return { ...prev, activePanel: null };
        return {
          ...prev,
          activePanel: prev.activePanel === panelId ? null : panelId,
          panels: {
            ...prev.panels,
            [panelId]: { ...prev.panels[panelId], visible: true },
          },
        };
      });
    },

    setPanelVisible: (panelId, visible) => {
      logAction('setPanelVisible', { panelId, visible });
      setStore((prev) => ({
        ...prev,
        activePanel: visible ? panelId : prev.activePanel === panelId ? null : prev.activePanel,
        panels: {
          ...prev.panels,
          [panelId]: { ...prev.panels[panelId], visible },
        },
      }));
    },

    setPanelDock: (panelId, dock: DockPosition) => {
      logAction('setPanelDock', { panelId, dock });
      setStore((prev) => ({
        ...prev,
        activePanel: panelId,
        panels: {
          ...prev.panels,
          [panelId]: { ...prev.panels[panelId], visible: true, dock },
        },
      }));
    },

    moveFloatingPanel: (panelId, floatX, floatY) => {
      setStore((prev) => ({
        ...prev,
        panels: {
          ...prev.panels,
          [panelId]: { ...prev.panels[panelId], floatX, floatY },
        },
      }));
    },

    resetPanelLayout: () => {
      logAction('resetPanelLayout');
      setStore((prev) => ({
        ...prev,
        panels: createDefaultPanels(),
        activePanel: 'adjust',
        filmstripCollapsed: false,
        filmstripHeight: 152,
        lastActionNotice: 'Panel layout restored to defaults',
      }));
    },

    setBottomTab: (bottomTab) => {
      setStore((prev) => ({ ...prev, bottomTab, filmstripCollapsed: false }));
    },

    setFilmstripCollapsed: (filmstripCollapsed) => {
      setStore((prev) => ({ ...prev, filmstripCollapsed }));
    },

    setFilmstripHeight: (filmstripHeight) => {
      setStore((prev) => ({ ...prev, filmstripHeight: Math.min(260, Math.max(108, filmstripHeight)) }));
    },

    setFilmstripFilter: (filmstripFilter) => {
      setStore((prev) => ({ ...prev, filmstripFilter }));
    },

    setFilmstripSearch: (filmstripSearch) => {
      setStore((prev) => ({ ...prev, filmstripSearch }));
    },

    setGridViewOpen: (gridViewOpen) => {
      setStore((prev) => ({ ...prev, gridViewOpen }));
    },

    setCompareMode: (compareMode) => {
      setStore((prev) => ({ ...prev, compareMode }));
    },

    setCanvasZoom: (canvasZoom) => {
      setStore((prev) => ({ ...prev, canvasZoom: Math.min(3, Math.max(0.5, Number(canvasZoom.toFixed(2)))) }));
    },

    toggleFullScreen: () => {
      logAction('toggleFullScreen');
      setStore((prev) => {
        const next = !prev.isFullScreen;
        if (typeof document !== 'undefined') {
          if (next && !document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else if (!next && document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
        }
        return { ...prev, isFullScreen: next };
      });
    },

    setSettingsOpen: (settingsOpen, tab) => {
      logAction('setSettingsOpen', { settingsOpen, tab });
      setStore((prev) => ({
        ...prev,
        settingsOpen,
        settingsTab: tab ?? prev.settingsTab,
      }));
    },

    setSettingsTab: (settingsTab) => {
      setStore((prev) => ({ ...prev, settingsTab }));
    },

    updateSettings: (patch) => {
      logAction('updateSettings', patch);
      setStore((prev) => ({
        ...prev,
        settings: { ...prev.settings, ...patch },
      }));
    },

    signInStub: (provider, email) => {
      logAction('signInStub', { provider, email });
      setStore((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          account: {
            signedIn: true,
            provider,
            email: email?.trim() || (provider === 'google' ? 'duncan@gmail.com' : 'duncan@icloud.com'),
            displayName: 'Duncan Lawson',
          },
        },
        lastActionNotice: `Signed in with ${provider}`,
      }));
    },

    signOutStub: () => {
      logAction('signOutStub');
      setStore((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          account: { signedIn: false },
        },
        lastActionNotice: 'Signed out — local offline editing remains active',
      }));
    },

    toggleAiProvider: (providerId) => {
      logAction('toggleAiProvider', { providerId });
      setStore((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          aiProviders: prev.settings.aiProviders.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  connected: !p.connected,
                  modelLabel: !p.connected ? 'Connected · Ready' : 'Not linked',
                }
              : p
          ),
        },
      }));
    },

    toggleStorageConnector: (connectorId) => {
      logAction('toggleStorageConnector', { connectorId });
      setStore((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          storageConnectors: prev.settings.storageConnectors.map((c) =>
            c.id === connectorId
              ? {
                  ...c,
                  status: c.status === 'connected' ? 'not-connected' : 'connected',
                  accountLabel: c.status === 'connected' ? undefined : 'Connected',
                }
              : c
          ),
        },
      }));
    },

    clearNotice: () => {
      setStore((prev) => ({ ...prev, lastActionNotice: null }));
    },
  }), [showNotice, updatePhotoById]);

  return { store, actions };
}
