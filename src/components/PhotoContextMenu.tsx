import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { photoMenuItems, type PhotoAction, type PhotoMenuItem, type PhotoMenuState } from '../core/photoMenu';

interface Props {
  x: number;
  y: number;
  state: PhotoMenuState;
  /** What the menu is about, for screen readers. */
  label: string;
  onChoose: (action: PhotoAction) => void;
  onClose: () => void;
}

/**
 * The menu that opens on right-click (or the Menu key) on a photo. Keyboard: Up and Down move, Home and End jump, Enter or
 * Space chooses, Escape closes and puts focus back where it was. It stays inside the window.
 */
export function PhotoContextMenu({ x, y, state, label, onChoose, onClose }: Props) {
  const items = photoMenuItems(state);
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const [place, setPlace] = useState({ left: x, top: y });

  // Keep the whole menu on screen.
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) });
  }, [x, y]);

  const enabled = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
  useEffect(() => {
    enabled()[0]?.focus({ preventScroll: true });
    const keep = previous.current;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    const away = () => onClose();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', away);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', away);
      window.removeEventListener('resize', away);
      if (keep && document.contains(keep)) keep.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    // Menu keys belong to the menu, even when they are bound to a culling shortcut.
    event.stopPropagation();
    const all = enabled();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => { event.preventDefault(); all[(to + all.length) % all.length]?.focus(); };
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') move(at + 1);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Tab') { event.preventDefault(); onClose(); }
  }

  const groups = items.reduce<PhotoMenuItem[][]>((all, item) => { (all[item.group] ??= []).push(item); return all; }, []).filter(Boolean);
  const button = (item: PhotoMenuItem, compact = false) => (
    <button key={item.action} type="button" role="menuitem" disabled={item.disabled} aria-label={item.label} title={item.label}
      onClick={() => onChoose(item.action)}
      className={`${compact ? 'grid min-h-9 min-w-9 place-items-center' : 'flex min-h-9 w-full items-center'} rounded-md px-3 text-left text-sm text-zinc-100 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:text-zinc-500 disabled:hover:bg-transparent`}>
      {compact ? `${item.action.slice(-1)}★` : item.label}
    </button>
  );

  return (
    <div ref={root} role="menu" aria-label={label} onKeyDown={onKeyDown} onContextMenu={(event) => event.preventDefault()}
      style={{ left: place.left, top: place.top, maxHeight: 'calc(100dvh - 16px)' }}
      className="fixed z-[80] w-60 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-white/15 bg-kestrel-raised p-1 shadow-2xl">
      {groups.map((group, index) => (
        <div key={index} role="group" className={index > 0 ? 'mt-1 border-t border-white/10 pt-1' : undefined}>
          {group.some((item) => item.inline) ? (
            <>
              <p className="px-3 pb-0.5 pt-1 text-xs text-zinc-400" aria-hidden="true">Rating</p>
              <div className="flex gap-0.5 px-1">{group.filter((item) => item.inline).map((item) => button(item, true))}</div>
              {group.filter((item) => !item.inline).map((item) => button(item))}
            </>
          ) : group.map((item) => button(item))}
        </div>
      ))}
    </div>
  );
}
