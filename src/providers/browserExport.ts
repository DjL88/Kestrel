import { isRawPreviewFile } from '../core/rawFormats';
import { beforeAfterCanvasSize, beforeAfterPanelProfile } from '../core/beforeAfterPlan';
import { exportText as exportCopy } from '../i18n/areas/export';
import { embedRasterXmp } from '../core/rasterXmp';
import type { TiffExportMetadata } from '../core/tiffExportMetadata';
import { canDevelopRaw, developRaw } from './rawDevelop';
import { loadImage } from './loadImage';
import { applyCanvasExportEdit } from '../core/canvasEdit';
import { DEFAULT_EDIT } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../core/photoFraming';
import { exportFilename, type ExportProfile } from '../core/exportProfiles';
import { planExportFraming, type ExportFraming, type FocusPoint } from '../core/exportFraming';
import type { BarStyle } from '../core/exportFormats';
import { hasWatermark, watermarkSpots, watermarkFont, watermarkToneForPixels } from '../core/watermark';
import { photoOverlayLines, type OverlayOptions } from '../core/exportOverlay';
import { datedExport } from '../core/exportTimestamp';
import type { WatermarkOptions } from '../core/watermark';
import { fitScale, maxCanvasPixels } from '../core/exportLimits';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';
import { isDesktopApp, saveWithDialog } from './desktopShell';

/** Share an in-flight development between rapid slider redraws and export proofs. */
const pendingSensorDevelopments = new WeakMap<object, Map<string, Promise<void>>>();

/** Choose the source for an export. A review-cache image is never silently
 * treated as the original. If a RAW has no usable camera JPEG, Kestrel may
 * develop its own source bytes on demand rather than require a second app.
 * The fallback decoder argument is injectable so safety can be unit-tested
 * without a hardware decoder in Node.
 */
export async function loadExportSource(
  frame: PhotoFrame,
  provider: Pick<BrowserPreviewProvider, 'getFullPreviewUrl' | 'hasBlob'>
    & Partial<Pick<BrowserPreviewProvider, 'isOfflineFallback' | 'ensureOriginal' | 'isDeveloped' | 'getOriginal' | 'developFromOriginal'>>,
  priority: 'background' | 'visible' | 'selected' = 'selected',
  rawDecoder: ((original: Blob, extension: string) => Promise<Blob>) | null = canDevelopRaw() ? developRaw : null,
) {
  const url = await provider.getFullPreviewUrl(frame, priority);
  const cachedReviewOnly = !frame.isDemo && Boolean(provider.isOfflineFallback?.(frame.stableKey));
  // A RAW without an embedded JPEG must not be a dead end. Use the same
  // Kestrel sensor decoder that develops it in Edit; this is still an 8-bit
  // rendered picture, not an archival 16-bit sensor master.
  // A valid camera JPEG is a useful instant preview, not evidence that a RAW
  // was developed at sensor resolution. On the real provider, prefer the
  // original and Kestrel's decoder if no current full development exists.
  // Injected legacy providers without isDeveloped preserve their preview mode.
  const needsSensorDevelopment = !frame.isDemo && isRawPreviewFile(frame.filename)
    && provider.hasBlob(frame.stableKey) && rawDecoder && provider.ensureOriginal
    && (!url || cachedReviewOnly || provider.isDeveloped?.(frame.stableKey) === false);
  if (needsSensorDevelopment && provider.developFromOriginal && rawDecoder) {
    const key = frame.stableKey;
    let byOriginal = pendingSensorDevelopments.get(provider);
    if (!byOriginal) {
      byOriginal = new Map();
      pendingSensorDevelopments.set(provider, byOriginal);
    }
    let pending = byOriginal.get(key);
    if (!pending) {
      const develop = provider.developFromOriginal.bind(provider);
      const extension = frame.filename.split('.').at(-1)?.toLowerCase() ?? '';
      const decoder = rawDecoder;
      pending = (async () => {
        const state = await develop(key, async original => {
          const picture = await decoder(original, extension);
          if (picture.type !== 'image/jpeg' || !picture.size) {
            throw new Error('The RAW decoder returned no usable picture.');
          }
          return picture;
        });
        if (state !== 'ready') {
          throw new Error(`Reconnect ${frame.filename} before exporting: the original RAW changed or became unavailable.`);
        }
      })();
      byOriginal.set(key, pending);
      // Clean up both resolution and rejection. All concurrent viewers await
      // the same promise; none sees a separate 45MP decode per slider update.
      const thisRun = pending;
      void thisRun.finally(() => {
        if (byOriginal?.get(key) === thisRun) byOriginal.delete(key);
      }).catch(() => {});
    }
    try {
      await pending;
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Unknown RAW decoder failure.';
      throw new Error(`Kestrel could not develop ${frame.filename} from RAW sensor data: ${detail} The original is unchanged.`);
    }
    const developedUrl = await provider.getFullPreviewUrl(frame, priority);
    if (!developedUrl || provider.isOfflineFallback?.(key)) {
      throw new Error(`Reconnect ${frame.filename} before exporting. Full RAW development is unavailable.`);
    }
    return loadImage(developedUrl);
  }
  if (needsSensorDevelopment) {
    const original = await provider.ensureOriginal(frame.stableKey, priority);
    if (!original) throw new Error(`Reconnect ${frame.filename} before exporting. The original RAW file is not available.`);
    const extension = frame.filename.split('.').at(-1)?.toLowerCase() ?? '';
    let rendered: Blob;
    try {
      rendered = await rawDecoder(original, extension);
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'Unknown decoder failure.';
      throw new Error(`Kestrel could not develop ${frame.filename} from its RAW sensor data: ${detail} The original is unchanged.`);
    }
    // A relink or changed drive may have landed during a slow decode. Never
    // export pixels associated with a superseded original in that case.
    if (provider.getOriginal && provider.getOriginal(frame.stableKey) !== original) {
      throw new Error(`The original for ${frame.filename} changed during RAW development. Retry the export.`);
    }
    if (rendered.type !== 'image/jpeg' || rendered.size === 0) {
      throw new Error(`Kestrel's RAW decoder did not return a usable image for ${frame.filename}. The original is unchanged.`);
    }
    const objectUrl = URL.createObjectURL(rendered);
    try { return await loadImage(objectUrl); }
    finally { URL.revokeObjectURL(objectUrl); }
  }
  if (cachedReviewOnly) {
    throw new Error(`Reconnect ${frame.filename} before exporting. The offline review image is not the original photograph.`);
  }
  if (!url && !frame.isDemo && isRawPreviewFile(frame.filename) && provider.hasBlob(frame.stableKey)) {
    throw new Error(`${frame.filename} has no usable embedded JPEG, and this build cannot develop it from RAW sensor data. The original is unchanged.`);
  }
  if (!url) throw new Error(`Reconnect ${frame.filename} to export it.`);
  return loadImage(url);
}

export interface ExportExtras {
  /** Where to centre a crop. Falls back to the photo's saved focus point, then the middle. */
  focus?: FocusPoint;
  /** What goes in the borders when the whole photo is kept inside a fixed shape. */
  bars?: BarStyle;
  /** A file name to use instead of the photo's own, without the extension. */
  stem?: string;
  /** Shooting details printed on the picture. */
  overlay?: OverlayOptions;
  /** How far in the crop looks, from 1 (as much as the shape allows) to 4. */
  zoom?: number;
  /** Limit the long edge of the generated preview. */
  previewEdge?: number;
  /** XMP fields explicitly chosen for the exported file, never copied from original EXIF. */
  metadata?: TiffExportMetadata | null;
}

/**
 * Draw one export: crop or fit as planned, apply the edit, and add borders. Previews and real exports both come
 * through here, so a preview shows exactly the crop the file will have.
 */
async function composeExport(
  source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile, signal: AbortSignal | undefined,
  mode: ExportFraming, longEdge: number | undefined, extras: ExportExtras,
) {
  signal?.throwIfAborted();
  // A failed RAW/embedded-preview decoder may resolve with zero or invalid dimensions.
  // Fail before crop maths or allocating a canvas; never substitute a smaller image.
  if (!Number.isSafeInteger(source.naturalWidth) || !Number.isSafeInteger(source.naturalHeight)
      || source.naturalWidth <= 0 || source.naturalHeight <= 0) {
    throw new Error(`Cannot export ${frame.filename}: the decoded source has invalid pixel dimensions. Reconnect or redevelop the original.`);
  }
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width, height } = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const plan = planExportFraming(width, height, profile, mode, extras.focus ?? frame.focusPoint, longEdge, extras.zoom);
  const { region } = plan;
  let { scale, border } = plan;
  {
    const finalWidth = Math.max(1, Math.round(border ? border.width : region.width * scale));
    const finalHeight = Math.max(1, Math.round(border ? border.height : region.height * scale));
    const limit = maxCanvasPixels({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
    if (!extras.previewEdge && finalWidth * finalHeight > limit) {
      throw new Error(`This device cannot safely export ${finalWidth} × ${finalHeight} px. Choose a smaller size or export on a desktop. No smaller file was substituted.`);
    }
    // Only the on-screen preview may shrink automatically, never the requested export.
    const shrink = Math.min(extras.previewEdge ? Math.min(1, extras.previewEdge / Math.max(finalWidth, finalHeight)) : 1,
      fitScale(finalWidth, finalHeight, limit));
    if (shrink < 1) {
      scale *= shrink;
      if (border) border = { width: Math.max(1, Math.round(border.width * shrink)), height: Math.max(1, Math.round(border.height * shrink)) };
    }
  }
  const canvas = document.createElement('canvas');
  const output = border ? document.createElement('canvas') : canvas;
  drawFramedPhoto(source, canvas, framing, { scale, region });
  // The crop shows only part of the framed photo, so tell the edit which part. Masks and detail then match the full photo.
  await applyCanvasExportEdit(canvas, frame.edit ?? DEFAULT_EDIT, signal, Math.max(width, height) * scale, {
    aspect: height / width,
    view: { x: region.x / width, y: region.y / height, w: region.width / width, h: region.height / height },
  });
  signal?.throwIfAborted();
  if (border) {
    output.width = border.width;
    output.height = border.height;
    const context = output.getContext('2d')!;
    const style = extras.bars ?? 'white';
    if (style === 'blur' && 'filter' in context) {
      // A blurred, darkened copy of the photo fills the borders. Nothing is invented: it is the same picture.
      const cover = Math.max(output.width / canvas.width, output.height / canvas.height) * 1.15;
      context.filter = `blur(${Math.max(2, Math.round(output.width / 40))}px)`;
      context.drawImage(canvas, (output.width - canvas.width * cover) / 2, (output.height - canvas.height * cover) / 2, canvas.width * cover, canvas.height * cover);
      context.filter = 'none';
      context.fillStyle = 'rgba(0, 0, 0, 0.28)';
      context.fillRect(0, 0, output.width, output.height);
    } else {
      context.fillStyle = style === 'black' ? '#000000' : '#ffffff';
      context.fillRect(0, 0, output.width, output.height);
    }
    context.drawImage(canvas, Math.floor((output.width - canvas.width) / 2), Math.floor((output.height - canvas.height) / 2));
  }
  if (extras.overlay?.on) {
    const lines = photoOverlayLines(frame, extras.overlay);
    if (lines.length) {
      const font = extras.overlay.font;
      const family = watermarkFont(font);
      const weights = font === 'jakarta' ? [400, 600] : font === 'atkinson' ? [400, 700] : [400, 500];
      await Promise.all(weights.map(weight => document.fonts?.load(`${weight} 16px ${family}`).catch(() => [])));
      signal?.throwIfAborted();
      drawOverlay(output, lines, extras.overlay, weights[1]);
    }
  }
  const mark = extras.overlay?.watermark;
  if (mark && hasWatermark(mark)) await drawWatermark(output, mark);
  return { canvas, output, bordered: Boolean(border) };
}

let markPicture: { data: string; image: HTMLImageElement } | undefined;

/** Draw the person's text or picture mark. Sizes follow the picture, so a preview and the full export look the same. */
async function drawWatermark(target: HTMLCanvasElement, mark: WatermarkOptions) {
  const context = target.getContext('2d');
  if (!context) return;
  const { width, height } = target;
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0.05, mark.opacity));
  let markWidth: number, markHeight: number, paint: (x: number, y: number) => void;
  if (mark.kind === 'image' && mark.imageData) {
    if (markPicture?.data !== mark.imageData) markPicture = { data: mark.imageData, image: await loadImage(mark.imageData) };
    const image = markPicture.image;
    markWidth = Math.max(8, Math.round(Math.max(width, height) * mark.size));
    markHeight = Math.round(markWidth * (image.naturalHeight / image.naturalWidth));
    paint = (x, y) => context.drawImage(image, x, y, markWidth, markHeight);
  } else {
    const size = Math.max(10, Math.round(Math.min(width, height) * mark.size));
    context.font = `600 ${size}px ${watermarkFont(mark.font)}`;
    context.textBaseline = 'top';
    markWidth = Math.ceil(context.measureText(mark.text).width);
    markHeight = Math.ceil(size * 1.2);
    paint = (x, y) => {
      // Each tile/batch image uses its own pixels. A local sample works for bright skies,
      // dark backgrounds and repeated watermarks without manual per-photo placement.
      let tone = mark.tone;
      if (tone === 'auto') {
        const px = Math.max(0, Math.floor(x - size * 0.15));
        const py = Math.max(0, Math.floor(y - size * 0.15));
        const pw = Math.min(width - px, Math.max(1, Math.ceil(markWidth + size * 0.3)));
        const ph = Math.min(height - py, Math.max(1, Math.ceil(markHeight + size * 0.3)));
        try { tone = watermarkToneForPixels(context.getImageData(px, py, pw, ph).data, pw, ph); }
        catch { tone = 'light'; }
      }
      context.fillStyle = tone === 'dark' ? '#111111' : '#ffffff';
      context.shadowColor = tone === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
      context.shadowBlur = size / 6;
      context.fillText(mark.text, x, y);
    };
  }
  for (const spot of watermarkSpots(width, height, markWidth, markHeight, mark.position)) paint(Math.round(spot.x), Math.round(spot.y));
  context.restore();
}

/** Print lines of text over the bottom or top of a picture, on a soft fade so they stay readable on any photo. */
function drawOverlay(target: HTMLCanvasElement, lines: string[], options: OverlayOptions, titleWeight: number) {
  const context = target.getContext('2d');
  if (!context) return;
  const { width, height } = target;
  let size = Math.max(10, Math.round(Math.min(width, height) * 0.032 * (options.scale ?? 1)));
  const family = watermarkFont(options.font);
  // Shrink the text if the longest line would not fit.
  context.font = `${titleWeight} ${size}px ${family}`;
  const widest = Math.max(...lines.map((line) => context.measureText(line).width));
  if (widest > width * 0.92 - size * 2) size = Math.max(8, Math.floor(size * ((width * 0.92 - size * 2) / widest)));
  const lineHeight = size * 1.4, pad = size * 1.1;
  const block = lines.length * lineHeight + pad * 2;
  const bottom = options.place === 'bottom';
  const fade = context.createLinearGradient(0, bottom ? height - block * 1.6 : 0, 0, bottom ? height : block * 1.6);
  const shade = options.tone === 'light' ? '0, 0, 0' : '255, 255, 255';
  fade.addColorStop(bottom ? 0 : 1, `rgba(${shade}, 0)`);
  fade.addColorStop(bottom ? 1 : 0, `rgba(${shade}, ${options.shade ?? 0.62})`);
  context.fillStyle = fade;
  context.fillRect(0, bottom ? height - block * 1.6 : 0, width, block * 1.6);
  context.fillStyle = options.tone === 'light' ? '#ffffff' : '#111111';
  context.textBaseline = 'alphabetic';
  const alignment = options.align ?? 'left';
  context.textAlign = alignment === 'centre' ? 'center' : alignment;
  const x = alignment === 'centre' ? width / 2 : alignment === 'right' ? width - pad : pad;
  lines.forEach((line, index) => {
    context.font = `${index === 0 ? titleWeight : 400} ${size}px ${family}`;
    const y = bottom ? height - pad - (lines.length - 1 - index) * lineHeight : pad + size + index * lineHeight;
    context.fillText(line, x, y, width - pad * 2);
  });
}

/**
 * A quick, unedited draw of the crop, for while a picture is being dragged. It is cheap enough to run on every frame.
 * The finished preview, with the edit applied, replaces it a moment after the drag stops.
 */
export function drawCropQuickly(source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile, extras: ExportExtras, target: HTMLCanvasElement) {
  // The drag-time preview bypasses composeExport. Apply the same decoder guard
  // before calculating a crop or resizing the caller's canvas.
  if (!Number.isSafeInteger(source.naturalWidth) || !Number.isSafeInteger(source.naturalHeight)
      || source.naturalWidth <= 0 || source.naturalHeight <= 0) {
    throw new Error(`Cannot preview ${frame.filename}: the decoded source has invalid pixel dimensions.`);
  }
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width, height } = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const plan = planExportFraming(width, height, profile, 'focus', extras.focus ?? frame.focusPoint, undefined, extras.zoom);
  const finalWidth = plan.region.width * plan.scale, finalHeight = plan.region.height * plan.scale;
  const shrink = Math.min(1, 240 / Math.max(finalWidth, finalHeight));
  drawFramedPhoto(source, target, framing, { scale: plan.scale * shrink, region: plan.region });
}

/**
 * Compose authentic before/after panels from the SAME photographic source.
 * Both halves use Kestrel's ordinary crop and tone/mask renderer. The left
 * half has neutral edits, the right has the saved reversible adjustments.
 * The photo's framing is identical, so the photographer compares like for like.
 * Text and watermarks are composited on the pair once, after the image pixels.
 */
async function composeBeforeAfter(
  source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile,
  signal: AbortSignal | undefined, extras: ExportExtras,
) {
  signal?.throwIfAborted();
  const panelProfile = beforeAfterPanelProfile(profile);
  // Preview size caps the whole composite, not each half independently.
  const panelExtras: ExportExtras = {
    ...extras, overlay: undefined,
    previewEdge: extras.previewEdge ? Math.max(1, Math.floor(extras.previewEdge / 2)) : undefined,
  };
  const beforeFrame: PhotoFrame = { ...frame, edit: DEFAULT_EDIT };
  const before = await composeExport(source, beforeFrame, panelProfile, signal, 'fit', undefined, panelExtras);
  let after: Awaited<ReturnType<typeof composeExport>> | null = null;
  try {
    after = await composeExport(source, frame, panelProfile, signal, 'fit', undefined, panelExtras);
    signal?.throwIfAborted();
    if (before.output.width !== after.output.width || before.output.height !== after.output.height) {
      throw new Error('Before and after were rendered at different dimensions. No export was made.');
    }
    const limit = maxCanvasPixels({
      userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    });
    const { width, height } = beforeAfterCanvasSize(before.output.width, before.output.height, limit);
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d');
    if (!context) throw new Error('This device cannot draw the before-and-after export.');
    context.drawImage(before.output, 0, 0);
    context.drawImage(after.output, before.output.width, 0);
    // These labels describe the real neutral/edited halves; they are not a
    // generative content change to either photographic region.
    const fontSize = Math.max(10, Math.round(Math.min(width / 2, height) * 0.034));
    const pad = Math.max(7, Math.round(fontSize * 0.55));
    context.font = `600 ${fontSize}px ${watermarkFont('inter')}`;
    context.textBaseline = 'top';
    for (const [text, startX] of [
      [exportCopy.comparison.before, 0], [exportCopy.comparison.after, before.output.width],
    ] as const) {
      const labelWidth = Math.ceil(context.measureText(text).width) + pad * 2;
      context.fillStyle = 'rgba(0,0,0,0.65)';
      context.fillRect(startX, 0, labelWidth, fontSize + pad * 2);
      context.fillStyle = '#ffffff';
      context.fillText(text, startX + pad, pad);
    }
    if (extras.overlay?.on) {
      const lines = photoOverlayLines(frame, extras.overlay);
      if (lines.length) {
        const font = extras.overlay.font;
        const family = watermarkFont(font);
        const weights = font === 'jakarta' ? [400, 600] : font === 'atkinson' ? [400, 700] : [400, 500];
        await Promise.all(weights.map(weight => document.fonts?.load(`${weight} 16px ${family}`).catch(() => [])));
        signal?.throwIfAborted();
        drawOverlay(output, lines, extras.overlay, weights[1]);
      }
    }
    const mark = extras.overlay?.watermark;
    if (mark && hasWatermark(mark)) {
      signal?.throwIfAborted();
      await drawWatermark(output, mark);
    }
    signal?.throwIfAborted();
    return { canvas: output, output, bordered: false };
  } finally {
    before.canvas.width = 0; before.canvas.height = 0;
    if (before.bordered) { before.output.width = 0; before.output.height = 0; }
    if (after) {
      after.canvas.width = 0; after.canvas.height = 0;
      if (after.bordered) { after.output.width = 0; after.output.height = 0; }
    }
  }
}

/** A small picture of what an export will look like, as a canvas the caller can draw. */
export async function renderExportPreview(
  source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile, mode: ExportFraming, extras: ExportExtras = {}, signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
  const { canvas, output, bordered } = profile.id === 'before-after'
    ? await composeBeforeAfter(source, frame, profile, signal, { previewEdge: 240, ...extras })
    : await composeExport(source, frame, profile, signal, mode, undefined, { previewEdge: 240, ...extras });
  if (bordered) { canvas.width = 0; canvas.height = 0; }
  return output;
}

export async function renderExport(
  source: HTMLImageElement, frame: PhotoFrame, profile: ExportProfile, date: Date, signal?: AbortSignal,
  mode: ExportFraming = 'fit', longEdge?: number, extras: ExportExtras = {},
) {
  const mime = profile.format === 'png' ? 'image/png' : 'image/jpeg';
  const { canvas, output, bordered } = profile.id === 'before-after'
    ? await composeBeforeAfter(source, frame, profile, signal, { ...extras, previewEdge: undefined })
    : await composeExport(source, frame, profile, signal, mode, longEdge, { ...extras, previewEdge: undefined });
  try {
    const raw = !frame.isDemo && isRawPreviewFile(frame.filename);
    const name = exportFilename(extras.stem ? `${extras.stem}.${profile.format}` : frame.filename, profile, raw);
    for (const quality of profile.maxBytes ? [profile.quality, ...[0.88, 0.82, 0.74, 0.65].filter((value) => value < profile.quality)] : [profile.quality]) {
      signal?.throwIfAborted();
      const encoded = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, mime, quality));
      signal?.throwIfAborted();
      if (!encoded || encoded.type !== mime || encoded.size === 0) throw new Error(`Could not encode ${name} at ${output.width} × ${output.height} px.`);
      // This is a metadata-only byte insertion after canvas encoding, not a
      // second lossy JPEG compression pass or a copy of private camera EXIF.
      const annotated = await embedRasterXmp(encoded, profile.format, extras.metadata);
      signal?.throwIfAborted();
      const file = datedExport(annotated, name, date);
      if (!profile.maxBytes || file.size <= profile.maxBytes) return file;
    }
    throw new Error(`${name} is above the preset’s file-size limit. Choose smaller export dimensions.`);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    if (bordered) { output.width = 0; output.height = 0; }
  }
}

export function downloadExport(blob: Blob, name: string) {
  if (isDesktopApp()) {
    // The desktop app has no browser download bar, so it asks where to save. If that fails, fall back to a browser download.
    saveWithDialog(blob, name).catch(() => downloadInBrowser(blob, name));
    return;
  }
  downloadInBrowser(blob, name);
}

export function downloadInBrowser(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function archiveExports(files: File[]) {
  const { Zip, ZipPassThrough } = await import('fflate');
  const chunks: BlobPart[] = [];
  let result: Blob | undefined;
  let failure: Error | undefined;
  const zip = new Zip((error, chunk, done) => {
    if (error) { failure = error; return; }
    chunks.push(new Uint8Array(chunk));
    if (done) result = new Blob(chunks, { type: 'application/zip' });
  });
  const names = new Set<string>();
  for (const file of files) {
    let name = file.name;
    let number = 2;
    const dot = name.lastIndexOf('.');
    while (names.has(name)) name = `${file.name.slice(0, dot)}-${number++}${file.name.slice(dot)}`;
    names.add(name);
    const entry = new ZipPassThrough(name);
    const date = new Date(file.lastModified);
    entry.mtime = date.getFullYear() >= 1980 && date.getFullYear() <= 2099 ? date : undefined;
    zip.add(entry);
    const reader = file.stream().getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        entry.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    entry.push(new Uint8Array(), true);
  }
  zip.end();
  if (failure || !result) throw failure ?? new Error('Could not create the export archive.');
  return result;
}
