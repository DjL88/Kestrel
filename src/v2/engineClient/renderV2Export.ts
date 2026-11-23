import { applyCanvasExportEdit } from '../../core/canvasEdit';
import { fitScale, maxCanvasPixels } from '../../core/exportLimits';
import { exportFilename, type ExportProfile } from '../../core/exportProfiles';
import { datedExport } from '../../core/exportTimestamp';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../../core/photoFraming';
import { isRawPreviewFile } from '../../core/rawFormats';
import type { PhotoFrame } from '../../core/types';
import type { CropTransform, OverlaySettings } from '../ui/contract';
import { effectiveOutputSize } from '../ui/utils/studioMath';
import { anchoredBox, cropPlacement, referenceScale, watermarkBox } from './exportLayout';
import { cappedContinuousLayout, continuousExportLayout, numberedSectionFilename } from './continuousExport';

/** Everything the overlay needs, resolved by the caller from the same description the canvas draws. */
export interface OverlayDraw {
  overlay: OverlaySettings;
  /** Draw the text rows (the request asked for it and the plan allows it). */
  text: boolean;
  /** Draw the watermark (the request asked for it and the plan allows it). */
  watermark: boolean;
  rows: { text: string; family: string; weight: number; sizePx: number; letterSpacing: number }[];
  mark: { kind: 'text'; text: string; subtext?: string } | { kind: 'image'; image: HTMLImageElement } | null;
  contrast: 'light-on-dark' | 'dark-on-light';
}

export interface V2RenderResult { file: File; width: number; height: number; capped: boolean; /** Files in left-to-right order when exporting a continuous split. */ sections?: File[] }

const LINE = 1.375; // Tailwind `leading-snug`, as the canvas uses.

function draw(canvas: HTMLCanvasElement, picture: HTMLCanvasElement, crop: CropTransform) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const place = cropPlacement(canvas.width, canvas.height, { width: picture.width, height: picture.height }, crop);
  context.save();
  context.beginPath();
  context.rect(place.clip.x, place.clip.y, place.clip.width, place.clip.height);
  context.clip();
  context.translate(canvas.width / 2 + place.translateX, canvas.height / 2 + place.translateY);
  context.rotate(place.rotateRad);
  context.scale(place.scaleX, place.scaleY);
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, -place.drawWidth / 2, -place.drawHeight / 2, place.drawWidth, place.drawHeight);
  context.restore();
}

/** The format's border: a band of the chosen colour just inside the edge, as a share of the width, the same rule the canvas uses. */
export function drawBorder(canvas: HTMLCanvasElement, crop: CropTransform) {
  const percent = crop.borderWidth ?? 0;
  if (!(percent > 0)) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const t = Math.min(Math.round(canvas.width * percent / 100), Math.floor(Math.min(canvas.width, canvas.height) / 2));
  if (t < 1) return;
  context.save();
  context.fillStyle = crop.borderColour ?? '#ffffff';
  context.fillRect(0, 0, canvas.width, t);
  context.fillRect(0, canvas.height - t, canvas.width, t);
  context.fillRect(0, t, t, canvas.height - 2 * t);
  context.fillRect(canvas.width - t, t, t, canvas.height - 2 * t);
  context.restore();
}

function setSpacing(context: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in context) (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  const rounded = context as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
  if (r > 0 && rounded.roundRect) rounded.roundRect(x, y, w, h, r); else context.rect(x, y, w, h);
}

function drawText(canvas: HTMLCanvasElement, input: OverlayDraw) {
  const context = canvas.getContext('2d');
  if (!context || !input.rows.length) return;
  const { overlay } = input;
  const k = referenceScale(canvas.width);
  const light = overlay.textColour === 'light';
  const rows = input.rows.map((row) => ({ ...row, px: row.sizePx * k }));
  const measure = (row: (typeof rows)[number]) => {
    context.font = `${row.weight} ${row.px}px ${row.family}`;
    setSpacing(context, row.letterSpacing * k);
    return context.measureText(row.text).width;
  };
  const textWidth = Math.max(...rows.map(measure));
  const textHeight = rows.reduce((sum, row) => sum + row.px * LINE, 0);
  const cover = overlay.textLayoutMode === 'cover-full';
  const padX = (cover ? 24 : 12) * k, padY = (cover ? 24 : 8) * k;
  const box = cover
    ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
    : anchoredBox(canvas, overlay.textX, overlay.textY, { width: textWidth + padX * 2, height: textHeight + padY * 2 });
  context.save();
  if (overlay.textScrim) {
    context.fillStyle = cover ? (light ? 'rgba(10, 12, 16, 0.48)' : 'rgba(246, 244, 238, 0.56)') : (light ? 'rgba(10, 12, 16, 0.62)' : 'rgba(246, 244, 238, 0.72)');
    roundRect(context, box.x, box.y, box.width, box.height, cover ? 0 : 4 * k);
    context.fill();
  }
  context.fillStyle = light ? '#F8F6F2' : '#14171F';
  context.textBaseline = 'middle';
  let y = cover ? (box.height - textHeight) / 2 : box.y + padY;
  for (const row of rows) {
    context.font = `${row.weight} ${row.px}px ${row.family}`;
    setSpacing(context, row.letterSpacing * k);
    const lineHeight = row.px * LINE;
    const width = context.measureText(row.text).width;
    context.textAlign = 'left';
    context.fillText(row.text, cover ? (box.width - width) / 2 : box.x + padX, y + lineHeight / 2);
    y += lineHeight;
  }
  context.restore();
}

function drawMark(canvas: HTMLCanvasElement, input: OverlayDraw) {
  const context = canvas.getContext('2d');
  if (!context || !input.mark) return;
  const { overlay } = input;
  const k = referenceScale(canvas.width);
  const lightMark = input.contrast === 'light-on-dark';
  const padX = 10 * k, padY = 4 * k;
  context.save();
  context.globalAlpha = overlay.watermarkOpacity / 100;
  if (input.mark.kind === 'image') {
    const { image } = input.mark;
    const height = 36 * k, width = Math.min(180 * k, height * (image.naturalWidth / image.naturalHeight));
    const box = watermarkBox(canvas, overlay, { width: width + padX * 2, height: height + padY * 2 });
    const s = overlay.watermarkScale / 100;
    context.drawImage(image, box.x + padX * s, box.y + padY * s, width * s, height * s);
  } else {
    const { text, subtext } = input.mark;
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    const big = 11 * k, small = 9 * k;
    context.font = `700 ${big}px ${family}`;
    setSpacing(context, 0.14 * big);
    const bigWidth = context.measureText(text).width;
    let smallWidth = 0;
    if (subtext) { context.font = `400 ${small}px ${family}`; setSpacing(context, 0.18 * small); smallWidth = context.measureText(subtext).width; }
    const width = Math.max(bigWidth, smallWidth) + padX * 2;
    const height = big * 1.5 + (subtext ? small * 1.5 : 0) + padY * 2;
    const box = watermarkBox(canvas, overlay, { width, height });
    const s = overlay.watermarkScale / 100;
    context.fillStyle = lightMark ? 'rgba(9, 11, 15, 0.36)' : 'rgba(248, 246, 242, 0.54)';
    roundRect(context, box.x, box.y, box.width, box.height, 4 * k * s);
    context.fill();
    context.fillStyle = lightMark ? '#F8F6F2' : '#14171F';
    context.textBaseline = 'middle';
    context.textAlign = 'right';
    const right = box.x + box.width - padX * s;
    context.font = `700 ${big * s}px ${family}`;
    setSpacing(context, 0.14 * big * s);
    context.fillText(text, right, box.y + (padY + big * 0.75) * s);
    if (subtext) {
      context.globalAlpha *= 0.8;
      context.font = `400 ${small * s}px ${family}`;
      setSpacing(context, 0.18 * small * s);
      context.fillText(subtext, right, box.y + (padY + big * 1.5 + small * 0.75) * s);
    }
  }
  context.restore();
}

/**
 * Draw one V2 export: the edited picture placed the way the canvas shows it (cover, zoom, pan, flips, rotation, edge insets),
 * then the overlay from the same description. The edit is applied to the whole framed picture first, so masks stay in place
 * whatever the crop. The output is never larger than the picture can fill (the size cap), and the result reports that.
 */
export async function renderV2Export(
  source: HTMLImageElement, frame: PhotoFrame, size: { width: number; height: number }, crop: CropTransform,
  profile: ExportProfile, overlay: OverlayDraw | null, date: Date, signal?: AbortSignal, sectionCount: 1 | 2 = 1,
): Promise<V2RenderResult> {
  signal?.throwIfAborted();
  if (!(source.naturalWidth > 0) || !(source.naturalHeight > 0)) throw new Error(`Cannot export ${frame.filename}: the decoded source has invalid pixel dimensions. Reconnect or redevelop the original.`);
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width: fw, height: fh } = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const requested = continuousExportLayout(size.width, size.height, sectionCount);
  const out = effectiveOutputSize({ width: requested.width, height: requested.height, crop }, { width: fw, height: fh });
  const layout = cappedContinuousLayout(out.width, out.height, sectionCount);
  const wasCapped = out.capped || layout.width !== requested.width || layout.height !== requested.height;
  const limit = maxCanvasPixels({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
  if (layout.width * layout.height > limit) throw new Error(`This device cannot safely export ${layout.width} × ${layout.height} px. Choose a smaller size or export on a desktop. No smaller file was substituted.`);
  // Edit only as many pixels as the output can show: the cover fit times the zoom, never above the picture's own size.
  const needed = Math.max(layout.width / fw, layout.height / fh) * crop.zoom;
  const scale = Math.min(1, needed, fitScale(fw, fh, limit));
  const picture = document.createElement('canvas');
  const output = document.createElement('canvas');
  try {
    drawFramedPhoto(source, picture, framing, { scale });
    await applyCanvasExportEdit(picture, frame.edit ?? DEFAULT_EDIT, signal, Math.max(fw, fh) * scale, { aspect: fh / fw, view: { x: 0, y: 0, w: 1, h: 1 } });
    signal?.throwIfAborted();
    output.width = layout.width; output.height = layout.height;
    draw(output, picture, crop);
    drawBorder(output, crop);
    if (overlay) {
      await Promise.all(overlay.rows.map((row) => document.fonts?.load(`${row.weight} 16px ${row.family}`).catch(() => [])));
      signal?.throwIfAborted();
      if (overlay.text) drawText(output, overlay);
      if (overlay.watermark) drawMark(output, overlay);
    }
    const name = exportFilename(frame.filename, profile, !frame.isDemo && isRawPreviewFile(frame.filename));
    const mimeType = profile.format === 'png' ? 'image/png' : 'image/jpeg';
    // Every section is cut from this SAME fully edited canvas. Never develop or
    // crop the photograph separately for each side of the seam.
    const sections: File[] = [];
    for (const section of layout.sections) {
      signal?.throwIfAborted();
      const piece = document.createElement('canvas');
      try {
        piece.width = section.width; piece.height = section.height;
        const context = piece.getContext('2d');
        if (!context) throw new Error('Canvas unavailable for split export.');
        context.drawImage(output, section.x, 0, section.width, section.height, 0, 0, section.width, section.height);
        const blob = await new Promise<Blob | null>((resolve) => piece.toBlob(resolve, mimeType, profile.format === 'jpeg' ? profile.quality : undefined));
        signal?.throwIfAborted();
        if (!blob || blob.type !== mimeType || blob.size === 0) {
          throw new Error(`Could not encode split section ${section.index} at ${section.width} × ${section.height} pixels.`);
        }
        const sectionName = numberedSectionFilename(name, section.index, sectionCount);
        sections.push(datedExport(blob, sectionName, date));
      } finally {
        piece.width = 0; piece.height = 0;
      }
    }
    return { file: sections[0], width: layout.sectionWidth, height: layout.height, capped: wasCapped,
      ...(sectionCount === 2 ? { sections } : {}) };
  } finally {
    picture.width = 0; picture.height = 0; output.width = 0; output.height = 0;
  }
}
