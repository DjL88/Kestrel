import React, { useEffect, useRef, useState } from 'react';
import type { Photo } from '../contract';

interface Props {
  photo: Photo;
  className?: string;
  request?: (id: string) => () => void;
}

/** Observe the actual clipped viewport, including horizontal filmstrip
 * scrolling. Remove the image element when it leaves; cached URLs remain
 * owned by the preview provider, not by this component. */
export default function ViewportThumbnail({photo, className, request}: Props) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    let release: (() => void) | undefined;
    const update = (inside: boolean) => {
      setVisible(inside);
      if (inside && !release) release = request?.(photo.id);
      if (!inside && release) { release(); release = undefined; }
    };
    if (typeof IntersectionObserver === 'undefined') {
      // Older webviews still get browser lazy loading, without initiating
      // every engine read. Focus/selection remains an independent demand.
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      update(entries.some(entry => entry.isIntersecting));
    });
    observer.observe(node);
    return () => { observer.disconnect(); release?.(); };
  }, [photo.id, request]);
  return <span ref={element} className="absolute inset-0 block overflow-hidden">
    {visible && <img src={photo.thumbUrl} alt={photo.title} referrerPolicy="no-referrer"
      loading="lazy" decoding="async" draggable={false} className={className} />}
  </span>;
}
