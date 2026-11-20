import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronDown, ChevronUp, Focus, Maximize2, Minimize2, GripHorizontal, Columns2 } from 'lucide-react';
import { clampFilmstripHeight, FILMSTRIP_SIZE_KEY, parseFilmstripHeight } from '../core/filmstripGeometry';
import { libraryText as t } from '../i18n/areas/library';

interface FilmstripDockProps {
  expanded: boolean;
  onToggle: () => void;
  onBeforeAfter?: () => void;
  /** Photo only: hide every bar and pane (F). Beside full screen, its companion. */
  onPhotoOnly?: () => void;
  children: React.ReactNode;
}

/** Section F: the filmstrip is a sibling BELOW all side panels; it owns the
 * entire window width, regardless of tool handedness or the Info pane.
 * Drag its top grip to resize. Resize never overlays the photograph.
 * Arrow toggles the strip. Height belongs only to the local device.
 */
export function FilmstripDock({ expanded, onToggle, onPhotoOnly, onBeforeAfter, children }: FilmstripDockProps) {
  const [height, setHeight] = useState(() => {
    try { return parseFilmstripHeight(window.localStorage.getItem(FILMSTRIP_SIZE_KEY), window.innerHeight); }
    catch { return parseFilmstripHeight(null, typeof window === 'undefined' ? 800 : window.innerHeight); }
  });
  const [fullscreen, setFullscreen] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  const drag = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    try { window.localStorage.setItem(FILMSTRIP_SIZE_KEY, JSON.stringify(height)); }
    catch { /* Private/restricted storage must not prevent browsing. */ }
  }, [height]);
  useEffect(() => {
    const resize = () => setHeight((value) => clampFilmstripHeight(value, window.innerHeight));
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('resize', resize);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('fullscreenchange', syncFullscreen);
    };
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!expanded || event.button !== 0) return;
    drag.current = { y: event.clientY, height };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setHeight(clampFilmstripHeight(drag.current.height + drag.current.y - event.clientY, window.innerHeight));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const toggleFullscreen = () => {
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    void request.catch(() => { /* The browser may not support fullscreen. */ });
  };

  return (
    <section aria-label={t.filmstripDock.label} data-filmstrip-dock
      className="relative z-10 flex w-full min-w-0 shrink-0 flex-col overflow-hidden border-t border-white/12 bg-[#121418]"
      style={{ height: expanded ? height + 36 : 36 }}>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-2 sm:px-4">
          <button type="button" onClick={onToggle} aria-expanded={expanded}
            aria-label={expanded ? t.filmstripDock.collapse : t.filmstripDock.expand}
            title={expanded ? t.filmstripDock.collapse : t.filmstripDock.expand}
            className="grid h-11 w-11 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
            {expanded ? <ChevronDown className="h-5 w-5" aria-hidden="true"/> : <ChevronUp className="h-5 w-5" aria-hidden="true"/>}
          </button>
        <div role="separator" tabIndex={expanded ? 0 : -1} aria-label={t.filmstripDock.resize} aria-orientation="horizontal"
          aria-valuemin={80} aria-valuemax={clampFilmstripHeight(9999, typeof window === 'undefined' ? 800 : window.innerHeight)}
          aria-valuenow={height}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault();
            const delta = event.shiftKey ? 40 : 12;
            setHeight((value) => clampFilmstripHeight(event.key === 'ArrowUp' ? value + delta
              : event.key === 'ArrowDown' ? value - delta
              : event.key === 'Home' ? 80 : 9999, window.innerHeight));
          }}
          title={t.filmstripDock.resizeTitle}
          className={`inline-flex h-9 min-w-0 flex-1 items-center gap-2 text-xs text-zinc-300 focus-visible:outline-2 focus-visible:outline-sky-300 ${expanded ? 'cursor-ns-resize touch-none' : ''}`}>
          <GripHorizontal className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true"/>
          <span>{t.filmstripDock.filmstrip}</span>
          {expanded && <span className="hidden text-zinc-500 sm:inline">{t.filmstripDock.dragToResize}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onBeforeAfter && (
            <button type="button" onClick={onBeforeAfter} aria-label="Before and after" title="Compare before and after"
              className="grid h-11 w-11 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
              <Columns2 className="h-4 w-4" aria-hidden="true"/>
            </button>
          )}
          {onPhotoOnly && (
            <button type="button" onClick={onPhotoOnly} aria-label={t.filmstripDock.showPhotoOnly} title={t.filmstripDock.photoOnlyTitle}
              className="grid h-11 w-11 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
              <Focus className="h-4 w-4" aria-hidden="true"/>
            </button>
          )}
          {typeof document !== 'undefined' && document.fullscreenEnabled && (
            <button type="button" aria-pressed={fullscreen} title={fullscreen ? t.filmstripDock.leaveFullScreenTitle : t.filmstripDock.fullScreenTitle}
              aria-label={fullscreen ? t.filmstripDock.leaveFullScreen : t.filmstripDock.fullScreen} onClick={toggleFullscreen}
              className="grid h-11 w-11 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
              {fullscreen ? <Minimize2 className="h-4 w-4" aria-hidden="true"/> : <Maximize2 className="h-4 w-4" aria-hidden="true"/>}
            </button>
          )}

        </div>
      </div>
      {expanded && <div className="min-h-0 flex-1 overflow-hidden">{children}</div>}
    </section>
  );
}
