/**
 * An offline portfolio: one self-contained web page made on this device from photos as they are developed now.
 * Nothing is uploaded. The page loads nothing from the network (its Content-Security-Policy forbids it), runs no
 * script, and opens from a file in any browser. The photographer chooses whether and with whom to share the file.
 */

/** A portfolio holds at most this many photos, so the file stays a size that opens and sends comfortably. */
export const MAX_PORTFOLIO_PHOTOS = 50;

export interface PortfolioPhoto {
  /** The sized JPEG (or PNG/WebP) preview as a base64 data URL. */
  image: string;
  /** Shown under the photo when given. */
  caption?: string;
  width?: number;
  height?: number;
}

export interface PortfolioLabels {
  /** "Photo 3 of 12", also the picture's description when it has no caption. */
  photo: (n: number, total: number) => string;
  /** One line at the foot of the page. */
  footer: string;
}

export interface PortfolioPage {
  title: string;
  byline?: string;
  /** The page's language, such as en-GB. */
  lang: string;
  photos: PortfolioPhoto[];
  labels: PortfolioLabels;
}

const DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A file name from the portfolio title, safe on Windows, macOS and phones. */
export function portfolioFileName(title: string): string {
  const base = title.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80).trim();
  return `${base || 'Portfolio'} - portfolio.html`;
}

const STYLE = `
:root{--bg:#f6f5f2;--fg:#1d1d1b;--muted:#5c5b57;--line:#d9d7d1;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe7;--muted:#a9a8a3;--line:#34332f}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header,footer{max-width:72rem;margin:0 auto;padding:2.5rem 1rem 1.5rem}
h1{margin:0;font-size:1.75rem;font-weight:600;letter-spacing:-0.01em}
header p{margin:.25rem 0 0;color:var(--muted)}
main{max-width:72rem;margin:0 auto;padding:0 1rem}
figure{margin:0 0 3rem}
img{display:block;max-width:100%;max-height:88vh;width:auto;height:auto;margin:0 auto;background:var(--line)}
figcaption{margin-top:.5rem;text-align:center;color:var(--muted);font-size:.9rem}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:.85rem;padding-top:1rem;padding-bottom:2.5rem}
@media print{figure{break-inside:avoid}img{max-height:none}}
`.trim();

/** The whole portfolio as one HTML document. Throws when a photo is not an embedded image. */
export function buildPortfolioHtml(page: PortfolioPage): string {
  if (!page.photos.length) throw new Error('A portfolio needs at least one photo.');
  if (page.photos.length > MAX_PORTFOLIO_PHOTOS) throw new Error(`A portfolio holds at most ${MAX_PORTFOLIO_PHOTOS} photos.`);
  const total = page.photos.length;
  const title = escapeHtml(page.title.trim() || 'Portfolio');
  const figures = page.photos.map((photo, index) => {
    if (!DATA_URL.test(photo.image)) throw new Error(`Photo ${index + 1} is not an embedded image.`);
    const position = page.labels.photo(index + 1, total);
    const caption = photo.caption?.trim();
    const size = photo.width && photo.height ? ` width="${Math.round(photo.width)}" height="${Math.round(photo.height)}"` : '';
    return `<figure id="photo-${index + 1}"><img src="${photo.image}" alt="${escapeHtml(caption || position)}"${size} decoding="async"${index > 1 ? ' loading="lazy"' : ''}>`
      + `<figcaption>${escapeHtml(caption ? `${position} · ${caption}` : position)}</figcaption></figure>`;
  }).join('\n');
  const byline = page.byline?.trim() ? `<p>${escapeHtml(page.byline.trim())}</p>` : '';
  return `<!doctype html>
<html lang="${escapeHtml(page.lang || 'en-GB')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>${title}</h1>${byline}</header>
<main>
${figures}
</main>
<footer>${escapeHtml(page.labels.footer)}</footer>
</body>
</html>
`;
}
