/**
 * Draws an element of the page, as the person sees it, into a PNG. No library: the element is cloned with every
 * computed style written in, each <canvas> (the edited photograph) and each picture is turned into an inline image, the
 * copy is wrapped in an SVG <foreignObject>, and the browser paints that SVG onto a canvas at the chosen scale.
 * Anything marked data-capture-ignore (the floating controls) is left out. Nothing leaves the device.
 *
 * Limits, said plainly: fonts that are loaded from files are drawn from the copy's own font names, so a font the browser
 * only has as a web font may be replaced by a default one in the picture; the picture is of what is on screen, not of the
 * original file at full size (use Export for that).
 */

/** The scale to draw at: at least 2x for a sharp result, up to 4x, and never more than `maxEdge` pixels on the long side. */
export function captureScale(width: number, height: number, devicePixelRatio = 1, maxEdge = 4800): number {
  const long = Math.max(1, width, height);
  const wanted = Math.min(4, Math.max(2, devicePixelRatio));
  return Math.max(1, Math.min(wanted, maxEdge / long));
}

export function screenshotName(title: string, at: Date): string {
  const safe = title.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'photo';
  return `inflight-screenshot-${safe}-${at.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
}

async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('A picture on screen could not be read.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

const URL_IN_CSS = /url\((['"]?)(.*?)\1\)/;

/** Writes every computed style onto the copy. Icons are drawn with a CSS mask picture; the isolated drawing cannot fetch
 * files, so those pictures are turned into inline data first. */
async function copyStyles(from: Element, to: Element) {
  const computed = getComputedStyle(from);
  let css = '';
  for (let i = 0; i < computed.length; i += 1) {
    const name = computed[i];
    let value = computed.getPropertyValue(name);
    if ((name === 'mask-image' || name === '-webkit-mask-image' || name === 'background-image') && URL_IN_CSS.test(value) && !value.includes('data:')) {
      const url = URL_IN_CSS.exec(value)![2];
      try { value = value.replace(URL_IN_CSS, `url("${await toDataUrl(new URL(url, document.baseURI).href)}")`); } catch { /* the picture is left out, not guessed */ }
    }
    css += `${name}:${value};`;
  }
  (to as HTMLElement).setAttribute('style', css);
}

/** The first solid background behind an element, so the picture is not transparent. */
export function solidBackdrop(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (colour && colour !== 'transparent' && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(colour)) return colour;
  }
  return '#ffffff';
}

async function cloneWithStyles(source: Element): Promise<Element | null> {
  if (source instanceof HTMLElement && source.hasAttribute('data-capture-ignore')) return null;
  let clone: Element;
  if (source instanceof HTMLCanvasElement) {
    const image = document.createElement('img');
    try { image.src = source.toDataURL('image/png'); } catch { return null; }
    clone = image;
  } else if (source instanceof HTMLImageElement) {
    const image = document.createElement('img');
    const url = source.currentSrc || source.src;
    try { image.src = url ? await toDataUrl(url) : ''; } catch { image.src = ''; }
    clone = image;
  } else {
    clone = source.cloneNode(false) as Element;
  }
  await copyStyles(source, clone);
  if (!(source instanceof HTMLCanvasElement) && !(source instanceof HTMLImageElement) && !(source instanceof SVGElement && source.tagName.toLowerCase() === 'svg')) {
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) clone.appendChild(child.cloneNode(true));
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const copy = await cloneWithStyles(child as Element);
        if (copy) clone.appendChild(copy);
      }
    }
  } else if (source instanceof SVGElement) {
    clone = source.cloneNode(true) as Element; // an inline drawing (grid lines, icons) keeps its own shapes
    await copyStyles(source, clone);
  }
  return clone;
}

export async function captureElement(element: HTMLElement, options: { scale?: number } = {}): Promise<Blob> {
  const width = element.clientWidth, height = element.clientHeight;
  if (!width || !height) throw new Error('There is nothing on screen to capture.');
  const scale = options.scale ?? captureScale(width, height, window.devicePixelRatio);
  const backdrop = solidBackdrop(element);
  const copy = await cloneWithStyles(element);
  if (!copy) throw new Error('There is nothing on screen to capture.');
  const holder = document.createElement('div');
  holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  holder.setAttribute('style', `width:${width}px;height:${height}px;overflow:hidden;position:relative;`);
  const inner = copy as HTMLElement;
  inner.style.transform = `translate(${-element.scrollLeft}px, ${-element.scrollTop}px)`;
  inner.style.overflow = 'visible';
  inner.style.width = `${element.scrollWidth}px`;
  inner.style.height = `${element.scrollHeight}px`;
  holder.appendChild(inner);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${new XMLSerializer().serializeToString(holder)}</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The screenshot could not be drawn.')); image.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The screenshot could not be drawn.');
  context.fillStyle = backdrop;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0; canvas.height = 0;
  if (!blob) throw new Error('The screenshot could not be saved.');
  return blob;
}
