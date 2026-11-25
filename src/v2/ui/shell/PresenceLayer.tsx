import { useEffect, useState } from 'react';
import { photoToScreen, type Peer } from '../../../core/editingSequence';
import { STRINGS } from '../strings';
import { frameElement } from './usePresence';

/**
 * Other people's cursors on the photo you are both looking at. Each carries the person's name and initials, so it is
 * never told apart by colour alone. Positions are relative to the photograph and follow your own zoom and pan.
 * Movement eases unless reduced motion is on. Purely visual: it never takes focus or blocks a click.
 */
export function PresenceCursors({ peers, photoId, hidden }: { peers: Peer[]; photoId: string | null; hidden: boolean }) {
  const here = hidden || !photoId ? [] : peers.filter((peer) => peer.photoId === photoId && peer.point);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!here.length) return;
    let frame = 0;
    const tick = () => { const element = frameElement(); setRect(element ? element.getBoundingClientRect() : null); frame = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [here.length]);
  if (!here.length || !rect) return null;
  return (
    <div aria-hidden="true" data-testid="presence-cursors" className="pointer-events-none fixed inset-0 z-[60]">
      {here.map((peer) => {
        const at = photoToScreen(peer.point!, rect);
        return (
          <div key={peer.uid} data-testid="presence-cursor" className="absolute left-0 top-0 motion-safe:transition-transform motion-safe:duration-100 motion-safe:ease-out"
            style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
            <svg width="14" height="18" viewBox="0 0 14 18" className="drop-shadow"><path d="M1 1 L1 15 L5 11 L8 17 L10 16 L7 10 L13 10 Z" fill="var(--bg-surface)" stroke="var(--text-primary)" strokeWidth="1.5" /></svg>
            <span className="ml-3 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-primary)]">
              <span className="font-semibold">{peer.initials}</span>{peer.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Initials of everyone here, in the top bar. Choosing one goes to the photo they are viewing; it never moves anyone else. */
export function PresenceAvatars({ peers, hidden, onToggleHidden, onGoTo }: { peers: Peer[]; hidden: boolean; onToggleHidden: () => void; onGoTo: (photoId: string) => void }) {
  const t = STRINGS.share;
  if (!peers.length) return null;
  return (
    <div role="group" aria-label={t.peopleHere} data-testid="presence-avatars" className="flex items-center gap-1">
      {peers.slice(0, 5).map((peer) => (
        <button key={peer.uid} type="button" disabled={!peer.photoId} onClick={() => peer.photoId && onGoTo(peer.photoId)}
          title={peer.photoId ? t.goTo(peer.name) : peer.name} aria-label={peer.photoId ? t.goTo(peer.name) : peer.name}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] text-[10px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
          {peer.initials}
        </button>
      ))}
      {peers.length > 5 && <span className="text-[10px] text-[var(--text-secondary)]">+{peers.length - 5}</span>}
      <button type="button" onClick={onToggleHidden} aria-pressed={hidden}
        className="h-8 rounded-[var(--radius-sm)] px-2 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]">
        {hidden ? t.showCursors : t.hideCursors}
      </button>
    </div>
  );
}
