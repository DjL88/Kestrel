import React, { useState } from 'react';
import { STRINGS } from '../strings';
import {
  GESTURES, GESTURE_CONTEXTS, findGestureClashes, readSavedGestures, resolveGesture, withGesture, writeSavedGestures,
  type GestureAction, type GestureId,
} from '../../../core/gestureSettings';

const buttonClass = 'min-h-11 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs text-[var(--text-primary)] disabled:opacity-40 pointer-fine:min-h-9';

const NAME_KEY = {
  'canvas.doubleTap': 'canvasDoubleTap', 'canvas.longPress': 'canvasLongPress', 'crop.doubleTap': 'cropDoubleTap',
  'photoList.longPress': 'photoListLongPress', 'photoList.doubleTap': 'photoListDoubleTap',
} as const satisfies Record<GestureId, keyof typeof STRINGS.gestures.names>;

/**
 * Settings > Gestures: what each double-tap or press and hold does, in plain words, with only the actions that make sense
 * for it. Kept on this device, as keyboard shortcuts are, and applied the next time the gesture is made. Two gestures doing
 * the same thing in one place are said in words, never blocked.
 */
export default function GesturesSettings() {
  const t = STRINGS.gestures;
  const [saved, setSaved] = useState(() => readSavedGestures());
  const change = (next: typeof saved) => { setSaved(next); writeSavedGestures(next); };
  const nameOf = (id: GestureId) => t.names[NAME_KEY[id]];
  const clashes = findGestureClashes(saved);

  return (
    <div className="space-y-4" data-testid="gestures-settings">
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{t.intro}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass} disabled={Object.keys(saved).length === 0} onClick={() => change({})}>{t.resetAll}</button>
        <span className="text-xs text-[var(--text-secondary)]">{t.deviceNote}</span>
      </div>
      {GESTURE_CONTEXTS.map((context) => (
        <section key={context} aria-labelledby={`v2-gestures-${context}`} className="space-y-1">
          <h3 id={`v2-gestures-${context}`} className="text-xs font-semibold text-[var(--text-primary)]">{t.contexts[context]}</h3>
          <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
            {GESTURES.filter((gesture) => gesture.context === context).map((gesture) => {
              const changed = gesture.id in saved;
              return (
                <div key={gesture.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-xs">
                  <span className="text-[var(--text-primary)]">{nameOf(gesture.id)}{changed ? t.changedSuffix : ''}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <select
                      aria-label={t.actionFor(nameOf(gesture.id))}
                      data-testid={`gesture-${gesture.id}`}
                      value={resolveGesture(saved, gesture.id)}
                      onChange={(event) => change(withGesture(saved, gesture.id, event.target.value as GestureAction))}
                      className="h-11 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)] pointer-fine:h-9"
                    >
                      {gesture.actions.map((action) => <option key={action} value={action}>{t.actions[action]}</option>)}
                    </select>
                    {changed && <button type="button" className={buttonClass} aria-label={t.resetOne(nameOf(gesture.id))} onClick={() => change(withGesture(saved, gesture.id, gesture.actions[0]))}>{t.reset}</button>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {clashes.map((clash) => (
        <p key={`${clash.context}-${clash.action}`} role="alert" className="text-xs text-[var(--status-danger,#e5484d)]">
          {t.clash(clash.ids.map(nameOf).join(', '))}
        </p>
      ))}
      {clashes.length === 0 && <p className="text-xs text-[var(--text-secondary)]">{t.noClashes}</p>}
    </div>
  );
}
