import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CROSSFADE_MS, SLIDE_MS, nextSlide, type SlideshowSnapshot } from '../../../core/welcomeSlideshow';
import { loadOfflinePreviewPair } from '../../../providers/offlinePreviewCache';

/**
 * The welcome-back slideshow: a slow crossfade through a few of the photographer's own flagged photos, behind the
 * welcome. Every picture is a preview InFlight already stored on this device (the offline preview cache), found by the
 * references the workspace remembered; nothing is downloaded or uploaded, and an original is never read.
 *
 * It never holds the welcome up: the welcome renders at once and the first photo fades in only when it has been read
 * and decoded. If none can be found the plain welcome simply stays. With reduced motion it is one still photo.
 */

export type LoadPreview = (key: string, developVersion: number) => Promise<Blob | null>;

const usable = (blob: Blob | null | undefined): blob is Blob => Boolean(blob && blob.type.startsWith('image/') && blob.size > 0);

/** The stored preview for one reference: the picture developed from the RAW when there is one, else the camera's; review size. */
export const loadStoredPreview: LoadPreview = async (key, developVersion) => {
  const developed = await loadOfflinePreviewPair(`developed-v${developVersion}:${key}`).catch(() => null);
  const pair = developed && usable(developed.review) ? developed : await loadOfflinePreviewPair(key).catch(() => null);
  if (!pair) return null;
  return usable(pair.review) ? pair.review : usable(pair.thumbnail) ? pair.thumbnail : null;
};

async function decoded(url: string): Promise<boolean> {
  const image = new Image();
  image.src = url;
  try { await image.decode(); return image.naturalWidth > 0; } catch { return false; }
}

/**
 * Reads the remembered previews one after another, after the welcome has painted, and moves through them every SLIDE_MS.
 * `slides` grows as pictures are ready; `done` says every reference has been tried.
 */
export function useWelcomeSlideshow(snapshot: SlideshowSnapshot | null, reduced: boolean, load: LoadPreview = loadStoredPreview) {
  const [slides, setSlides] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [current, setCurrent] = useState(0);
  const count = useRef(0);
  count.current = slides.length;

  useEffect(() => {
    setSlides([]);
    setCurrent(0);
    if (!snapshot) { setDone(true); return; }
    setDone(false);
    let live = true;
    const urls: string[] = [];
    void (async () => {
      for (const key of snapshot.keys) {
        // With reduced motion only one still photo is ever shown, so only one is read.
        if (!live || (reduced && urls.length > 0)) break;
        const blob = await load(key, snapshot.developVersion).catch(() => null);
        if (!live || !usable(blob)) continue;
        const url = URL.createObjectURL(blob);
        if (!(await decoded(url)) || !live) { URL.revokeObjectURL(url); continue; }
        urls.push(url);
        setSlides([...urls]);
      }
      if (live) setDone(true);
    })();
    return () => { live = false; for (const url of urls) URL.revokeObjectURL(url); };
  }, [snapshot, reduced, load]);

  const moving = !reduced && slides.length > 1;
  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(() => setCurrent((was) => nextSlide(was, count.current, reduced)), SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [moving, reduced]);

  return { slides, current: slides.length ? Math.min(current, slides.length - 1) : 0, done };
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
export function SlideshowBackdrop({ slides, current, reduced, light }: { slides: string[]; current: number; reduced: boolean; light: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!slides.length || shown) return;
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, [slides.length, shown]);
  if (!slides.length) return null;
  const fade = reduced ? undefined : `opacity ${CROSSFADE_MS}ms ease-in-out`;
  return (
    <div aria-hidden="true" data-testid="welcome-slideshow" data-slides={slides.length} data-current={current}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ opacity: reduced || shown ? 1 : 0, transition: fade }}>
      {slides.map((url, index) => (
        <img key={url} src={url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: index === current ? 1 : 0, transition: fade }} />
      ))}
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
