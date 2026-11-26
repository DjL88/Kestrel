import { useEffect, useState, type CSSProperties } from 'react';
import { CROSSFADE_MS, runSlideshow, type SlideshowSnapshot, type SlideshowView } from '../../../core/welcomeSlideshow';
import { loadOfflinePreviewPair } from '../../../providers/offlinePreviewCache';

/**
 * The welcome-back slideshow: a slow crossfade through a few of the photographer's own flagged photos, behind the
 * welcome. Every picture is a preview InFlight already stored on this device (the offline preview cache), found by the
 * references the workspace remembered; nothing is downloaded or uploaded, and an original is never read.
 *
 * It never holds the welcome up: the welcome renders at once and the first photo fades in only when it has been read
 * and decoded. If none can be found the plain welcome simply stays. With reduced motion it is one still photo, and only
 * that one preview is read. At most two pictures are held at once (the one showing and the next), so a phone never
 * keeps eight decoded photos in memory.
 */

export type LoadPreview = (key: string, developVersion: number, narrow: boolean) => Promise<Blob | null>;

const usable = (blob: Blob | null | undefined): blob is Blob => Boolean(blob && blob.type.startsWith('image/') && blob.size > 0);

/** A phone-sized screen: the stored thumbnail (400 px) is enough behind an 80 % scrim, and far lighter to decode. */
const NARROW_PX = 768;

/**
 * The stored preview for one reference: the picture developed from the RAW when there is one, else the camera's.
 * On a narrow screen the thumbnail when one is stored, otherwise the review size (up to 2,200 px).
 */
export const loadStoredPreview: LoadPreview = async (key, developVersion, narrow) => {
  const developed = await loadOfflinePreviewPair(`developed-v${developVersion}:${key}`).catch(() => null);
  const pair = developed && (usable(developed.review) || usable(developed.thumbnail)) ? developed : await loadOfflinePreviewPair(key).catch(() => null);
  if (!pair) return null;
  if (narrow && usable(pair.thumbnail)) return pair.thumbnail;
  return usable(pair.review) ? pair.review : usable(pair.thumbnail) ? pair.thumbnail : null;
};

async function decoded(url: string): Promise<boolean> {
  const image = new Image();
  image.src = url;
  try { await image.decode(); return image.naturalWidth > 0; } catch { return false; }
}

const EMPTY: SlideshowView = { shown: null, incoming: null, fading: false, missing: [], moved: false };

/**
 * Runs the slideshow (see runSlideshow) after the welcome has painted. Each picture is read and decoded just before it
 * is needed, and its object URL is revoked as soon as it has left the screen, or when the welcome closes.
 */
export function useWelcomeSlideshow(snapshot: SlideshowSnapshot | null, reduced: boolean, load: LoadPreview = loadStoredPreview) {
  const [view, setView] = useState<SlideshowView>(EMPTY);

  useEffect(() => {
    setView(EMPTY);
    if (!snapshot) return;
    let live = true;
    const held = new Set<string>();
    const timers = new Set<number>();
    const narrow = window.innerWidth <= NARROW_PX;
    void runSlideshow({
      count: snapshot.keys.length,
      reduced,
      prepare: async (index) => {
        const blob = await load(snapshot.keys[index], snapshot.developVersion, narrow).catch(() => null);
        if (!live || !usable(blob)) return null;
        const url = URL.createObjectURL(blob);
        held.add(url);
        if (await decoded(url)) return url;
        held.delete(url);
        URL.revokeObjectURL(url);
        return null;
      },
      release: (url) => { held.delete(url); URL.revokeObjectURL(url); },
      wait: (ms) => new Promise((resolve) => {
        const timer = window.setTimeout(() => { timers.delete(timer); resolve(); }, ms);
        timers.add(timer);
      }),
      now: () => performance.now(),
      alive: () => live,
      update: (next) => { if (live) setView(next); },
    });
    return () => {
      live = false;
      for (const timer of timers) window.clearTimeout(timer);
      for (const url of held) URL.revokeObjectURL(url);
    };
  }, [snapshot, reduced, load]);

  return view;
}

/**
 * The scrim over the photos: the welcome's own surface colour at 80 %, so even over a pure white (dark theme) or pure
 * black (light theme) photo every text colour on the welcome keeps at least 4.5:1 (WCAG AA) with `SLIDESHOW_TEXT` below.
 * Worked out from the V2 tokens: dark worst case #3e4145 behind, light worst case #c8c6c2.
 */
const SCRIM = { dark: 'rgba(14, 17, 22, 0.8)', light: 'rgba(250, 247, 242, 0.8)' };

/**
 * While photos show, the welcome's quieter text colours are raised so they meet AA over the worst case (secondary and
 * muted 5.4–6.4:1, dark and light), and the soft accent behind the highlighted card and initial becomes solid.
 */
export const SLIDESHOW_TEXT: Record<'dark' | 'light', CSSProperties> = {
  dark: { '--text-secondary': '#d2cbc0', '--text-muted': '#c8c1b5', '--brand-accent-soft': '#2f201c' } as CSSProperties,
  light: { '--text-secondary': '#3a3f4b', '--text-muted': '#424754', '--brand-accent-soft': '#f4e4d9' } as CSSProperties,
};

/** The photos and their scrim, behind everything on the welcome. Decorative: hidden from assistive technology. */
export function SlideshowBackdrop({ view, reduced, light }: { view: SlideshowView; reduced: boolean; light: boolean }) {
  const [shown, setShown] = useState(false);
  const has = view.shown !== null;
  useEffect(() => {
    if (!has || shown) return;
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, [has, shown]);
  if (!view.shown) return null;
  const fade = reduced ? undefined : `opacity ${CROSSFADE_MS}ms ease-in-out`;
  // Only the photo showing and the one coming in are ever mounted; the incoming one sits on top and fades in.
  return (
    <div aria-hidden="true" data-testid="welcome-slideshow" data-current={view.shown.index}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ opacity: reduced || shown ? 1 : 0, transition: fade }}>
      <img key={view.shown.url} src={view.shown.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" style={{ transition: fade }} />
      {view.incoming && (
        <img key={view.incoming.url} src={view.incoming.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: view.fading ? 1 : 0, transition: fade }} />
      )}
      <div className="absolute inset-0" style={{ backgroundColor: light ? SCRIM.light : SCRIM.dark }} />
    </div>
  );
}

/** Small dots for where the slideshow is. Decorative: the current one is larger and filled, not only a different colour. */
export function SlideshowDots({ count, current }: { count: number; current: number }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, index) => (
        <i key={index} className={index === current
          ? 'block h-2 w-2 rounded-full bg-[var(--text-primary)]'
          : 'block h-1.5 w-1.5 rounded-full border border-[var(--text-secondary)]'} />
      ))}
    </span>
  );
}
