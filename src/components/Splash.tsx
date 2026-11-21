import { useEffect, useMemo, useRef, useState } from 'react';
import splashFile from '../assets/splash/kestrel-k-splash.json';
import kestrelMark from '../assets/kestrel-mark.svg';
import { parseLottie, type SplashAnimation, type Track } from '../core/lottieLite';
import { FADE_MS, HOLD_MS, STILL_MS, shouldShowSplash } from '../core/splashRules';

const SEEN_KEY = 'kestrel-splash-v1';

function shouldShow(): boolean {
  let alreadyShown = false;
  try { alreadyShown = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* Without storage it simply shows each time. */ }
  return shouldShowSplash({ automated: navigator.webdriver === true, alreadyShown, forced: new URLSearchParams(location.search).has('splash') });
}

const first = (track: Track) => ('still' in track ? track.still : track.keyframes[0].value);
const last = (track: Track) => ('still' in track ? track.still : track.keyframes[track.keyframes.length - 1].value);
const translate = (value: number[]) => `translate(${value[0]}px, ${value[1]}px)`;
const scaleOf = (value: number[]) => `scale(${value[0]}, ${value[1]})`;

/**
 * The launch animation: the Kestrel K draws itself in. It is plain SVG moved by the browser's own animation support,
 * so it needs no library and costs a few kilobytes. A tap or key skips it, and with reduced motion it is a still logo.
 */
export function Splash() {
  const [open, setOpen] = useState(shouldShow);
  const [leaving, setLeaving] = useState(false);
  const animation = useMemo<SplashAnimation | null>(() => parseLottie(splashFile), []);
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
  const groups = useRef<{ opacity: SVGGElement | null; position: SVGGElement | null; scale: SVGGElement | null }[]>([]);

  useEffect(() => { if (open) { try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* Not remembered. */ } } }, [open]);

  // Play, hold the finished logo for a moment, then fade away.
  useEffect(() => {
    if (!open) return;
    const players: Animation[] = [];
    if (animation && !reduced) {
      animation.layers.forEach((layer, index) => {
        const refs = groups.current[index];
        const play = (element: SVGGElement | null, track: Track, build: (value: number[]) => Keyframe) => {
          if (!element || 'still' in track) return;
          players.push(element.animate(track.keyframes.map((frame) => ({ ...build(frame.value), offset: frame.offset, easing: frame.easing })), { duration: animation.durationMs, fill: 'both' }));
        };
        play(refs?.opacity ?? null, layer.opacity, (value) => ({ opacity: value[0] }));
        play(refs?.position ?? null, layer.position, (value) => ({ transform: translate(value) }));
        play(refs?.scale ?? null, layer.scale, (value) => ({ transform: scaleOf(value) }));
      });
    }
    const playing = animation && !reduced ? animation.durationMs : 0;
    const leave = window.setTimeout(() => setLeaving(true), playing + (animation && !reduced ? HOLD_MS : STILL_MS));
    return () => { window.clearTimeout(leave); players.forEach((player) => player.cancel()); };
  }, [open, animation, reduced]);

  useEffect(() => {
    if (!leaving) return;
    const done = window.setTimeout(() => setOpen(false), reduced ? 0 : FADE_MS);
    return () => window.clearTimeout(done);
  }, [leaving, reduced]);

  // Any tap or key skips it.
  useEffect(() => {
    if (!open) return;
    const skip = () => setLeaving(true);
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
    return () => { window.removeEventListener('pointerdown', skip); window.removeEventListener('keydown', skip); };
  }, [open]);

  if (!open) return null;
  return (
    <div data-testid="splash" aria-hidden="true" className="fixed inset-0 z-[1000] grid place-items-center bg-[#1c2027]"
      style={{ opacity: leaving ? 0 : 1, transition: reduced ? undefined : `opacity ${FADE_MS}ms ease-out` }}>
      {animation ? (
        <svg viewBox={`0 0 ${animation.width} ${animation.height}`} className="h-[min(56vmin,18rem)] w-[min(56vmin,18rem)]">
          {animation.layers.map((layer, index) => {
            const startOpacity = reduced ? last(layer.opacity)[0] : first(layer.opacity)[0];
            const position = reduced ? last(layer.position) : first(layer.position);
            const scale = reduced ? last(layer.scale) : first(layer.scale);
            groups.current[index] ??= { opacity: null, position: null, scale: null };
            return (
              <g key={`${layer.name}-${index}`} ref={(element) => { groups.current[index].opacity = element; }} style={{ opacity: startOpacity }}>
                <g ref={(element) => { groups.current[index].position = element; }} style={{ transform: translate(position), transformOrigin: '0 0' }}>
                  <g ref={(element) => { groups.current[index].scale = element; }} style={{ transform: scaleOf(scale), transformOrigin: '0 0' }}>
                    <g transform={`translate(${-layer.anchor[0]} ${-layer.anchor[1]})`}>
                      {layer.rect && <rect x={layer.rect.x} y={layer.rect.y} width={layer.rect.width} height={layer.rect.height} rx={layer.rect.radius} fill={layer.fill} fillOpacity={layer.fillOpacity} />}
                      {layer.path && <path d={layer.path} fill={layer.fill} fillOpacity={layer.fillOpacity} fillRule={layer.evenOdd ? 'evenodd' : 'nonzero'} />}
                    </g>
                  </g>
                </g>
              </g>
            );
          })}
        </svg>
      ) : <img src={kestrelMark} alt="" className="h-40 w-40" />}
    </div>
  );
}
