/**
 * Which gestures do what, and the person's own choices. The defaults follow the convention in Apple Photos, Google Photos,
 * Lightroom mobile and Photoshop on iPad (a double-tap zooms in on the spot tapped and again back to Fit; a long press on a
 * photo in a list opens its menu; holding the photo shows the original). Each device keeps its own choices, as with keyboard
 * shortcuts, and Reset puts the defaults back. No gesture is ever the only way to do something: every action here also has
 * a visible button or a key.
 *
 * A gesture belongs to one context (where it is made), and each gesture lists only the actions that make sense for it, so a
 * choice can never leave a gesture doing something that cannot happen there.
 */
export type GestureContext = 'canvas' | 'crop' | 'photoList';
export type GestureAction = 'zoom' | 'openCrop' | 'showOriginal' | 'resetCrop' | 'exitCrop' | 'menu' | 'select' | 'open' | 'off';
export type GestureId = 'canvas.doubleTap' | 'canvas.longPress' | 'crop.doubleTap' | 'photoList.longPress' | 'photoList.doubleTap';

export interface GestureDefinition {
  id: GestureId;
  context: GestureContext;
  /** What the person does with a finger; the pane says it in words. */
  gesture: 'doubleTap' | 'longPress';
  /** The actions on offer, the default first. */
  actions: readonly GestureAction[];
}

export const GESTURES: readonly GestureDefinition[] = [
  { id: 'canvas.doubleTap', context: 'canvas', gesture: 'doubleTap', actions: ['zoom', 'openCrop', 'off'] },
  { id: 'canvas.longPress', context: 'canvas', gesture: 'longPress', actions: ['showOriginal', 'off'] },
  { id: 'crop.doubleTap', context: 'crop', gesture: 'doubleTap', actions: ['resetCrop', 'exitCrop', 'off'] },
  { id: 'photoList.longPress', context: 'photoList', gesture: 'longPress', actions: ['menu', 'select', 'off'] },
  { id: 'photoList.doubleTap', context: 'photoList', gesture: 'doubleTap', actions: ['open', 'menu', 'off'] },
];
export const GESTURE_CONTEXTS: readonly GestureContext[] = ['canvas', 'crop', 'photoList'];

export type SavedGestures = Partial<Record<GestureId, GestureAction>>;

export const GESTURES_KEY = 'inflight.v2.gestures';

const definitionOf = (id: GestureId) => GESTURES.find((gesture) => gesture.id === id);
export const defaultAction = (id: GestureId): GestureAction => definitionOf(id)?.actions[0] ?? 'off';

/** The saved choices, with anything unknown or not on offer for that gesture dropped (an older build, a damaged value). */
export function sanitiseGestures(raw: unknown): SavedGestures {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const saved: SavedGestures = {};
  for (const gesture of GESTURES) {
    const value = (raw as Record<string, unknown>)[gesture.id];
    if (typeof value === 'string' && gesture.actions.includes(value as GestureAction) && value !== gesture.actions[0]) saved[gesture.id] = value as GestureAction;
  }
  return saved;
}

export function readSavedGestures(storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): SavedGestures {
  try {
    const text = storage?.getItem(GESTURES_KEY);
    return text ? sanitiseGestures(JSON.parse(text)) : {};
  } catch { return {}; }
}

/** Remembered on this device only; if storage is blocked the choice lasts for this session. */
export function writeSavedGestures(saved: SavedGestures, storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    const clean = sanitiseGestures(saved);
    if (Object.keys(clean).length === 0) storage?.removeItem(GESTURES_KEY);
    else storage?.setItem(GESTURES_KEY, JSON.stringify(clean));
  } catch { /* lasts for this session */ }
}

export const resolveGesture = (saved: SavedGestures, id: GestureId): GestureAction => saved[id] ?? defaultAction(id);

/** What a gesture does now, read from this device's storage each time it is made so a change in Settings applies at once. */
export const readGesture = (id: GestureId, storage?: Pick<Storage, 'getItem'> | null): GestureAction =>
  resolveGesture(storage === undefined ? readSavedGestures() : readSavedGestures(storage), id);

/** One gesture set to an action. Choosing the default removes the override; an action not on offer is ignored. */
export function withGesture(saved: SavedGestures, id: GestureId, action: GestureAction): SavedGestures {
  const definition = definitionOf(id);
  if (!definition || !definition.actions.includes(action)) return saved;
  const { [id]: _removed, ...rest } = saved;
  return action === definition.actions[0] ? rest : { ...rest, [id]: action };
}

export interface GestureClash { context: GestureContext; action: GestureAction; ids: GestureId[] }

/**
 * Two gestures in the same context set to the same action (long press and double-tap on a photo both opening its menu).
 * It still works, so it is said in words, never blocked. "Do nothing" is never a clash.
 */
export function findGestureClashes(saved: SavedGestures): GestureClash[] {
  const clashes: GestureClash[] = [];
  for (const context of GESTURE_CONTEXTS) {
    const byAction = new Map<GestureAction, GestureId[]>();
    for (const gesture of GESTURES.filter((g) => g.context === context)) {
      const action = resolveGesture(saved, gesture.id);
      if (action === 'off') continue;
      byAction.set(action, [...(byAction.get(action) ?? []), gesture.id]);
    }
    for (const [action, ids] of byAction) if (ids.length > 1) clashes.push({ context, action, ids });
  }
  return clashes;
}
