import { applyCanvasExportEdit } from '../../core/canvasEdit';
import { tagSrgb } from '../../core/iccEmbed';
import { applyFrameLayers, applyFrameLayers16 } from '../../core/layerAssetVault';
import { fitScale, maxCanvasPixels } from '../../core/exportLimits';
import { exportFilename, type ExportProfile } from '../../core/exportProfiles';
import { datedExport } from '../../core/exportTimestamp';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize, lensCentre } from '../../core/photoFraming';
import type { PhotoFrame } from '../../core/types';
import type { CropTransform, OverlaySettings } from '../ui/contract';
import { effectiveUpscaleOutputSize } from '../ui/utils/studioMath';
import type { SplitFrameCount } from './formatSplitOps';
import { cropPlacement, fitWatermarkArtwork, referenceScale } from './exportLayout';
import { alignForAnchor, layoutOverlays, type Box } from '../ui/utils/overlayLayout';
import { planBorderFrame } from './borderFrameLayout';
import { upscaleCanvasInPlace } from './upscaleCanvas';
import { cappedContinuousLayout, continuousExportLayout, numberedSectionFilename } from './continuousExport';
import type { Rgb16Image } from '../../core/master16';
import { ditherRgb16ToRgba8, downscaleRgb16 } from '../../core/rgb16Output';
import { blankRgb16, copyRgb16, cropRgb16, drawRgb16, enlargeRgb16, fillRgb16, overlayRgba8OnRgb16, rgb8To16 } from '../../core/compose16';
import { encodePng16, provePng } from '../../core/png16';

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

export interface V2RenderResult {
  file: File; width: number; height: number; capped: boolean;
  /**
   * 'rgb16': edited, layered, enlarged, framed (crop, border, overlays, split) and written at 16 bits; a PNG is 16-bit,
   * a JPEG is rounded to 8 bits once, as it is encoded. '8-bit': the canvas path throughout.
   */
  precision: 'rgb16' | '8-bit';
  /** Bits per channel in the written file(s): 16 only for a PNG from the 16-bit path. */
  bitsPerChannel: 8 | 16;
  /** Files in left-to-right order when exporting a continuous split. */
  sections?: File[];
}

const LINE = 1.375; // Tailwind `leading-snug`, as the canvas uses.
const MARK_LINE = 1.5; // the text watermark's line height on the canvas

function draw(canvas: HTMLCanvasElement, picture: HTMLCanvasElement, crop: CropTransform) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  // Keep the chosen output size constant. The border occupies its OWN area,
  // and the photograph's crop/pan/flip/rotate is applied inside the smaller viewport.
  const border = crop.borderWidth ?? 0;
  const geometry = planBorderFrame(canvas.width, canvas.height, picture.width, picture.height,
    { placement: crop.borderPlacement ?? 'all', borderPercent: border, fit: crop.borderPlacement === 'auto' ? 'contain' : 'cover' });
  if (border > 0 || crop.borderPlacement === 'auto') {
    context.fillStyle = crop.borderColour ?? '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const inner = geometry.inner;
  const place = cropPlacement(inner.width, inner.height, { width: picture.width, height: picture.height }, crop);
  context.save();
  context.beginPath();
  context.rect(inner.x + place.clip.x, inner.y + place.clip.y, place.clip.width, place.clip.height);
  context.clip();
  context.translate(inner.x + inner.width / 2 + place.translateX, inner.y + inner.height / 2 + place.translateY);
  context.rotate(place.rotateRad);
  context.scale(place.scaleX, place.scaleY);
  context.imageSmoothingQuality = 'high';
  // Automatic fit is letterboxing, not an image crop. Keep the entire source
  // visible and allow unused frame space to show the selected border colour.
  const drawWidth = crop.borderPlacement === 'auto' ? geometry.photo.width : place.drawWidth;
  const drawHeight = crop.borderPlacement === 'auto' ? geometry.photo.height : place.drawHeight;
  context.drawImage(picture, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

/** Each split output is a complete frame with its own non-occluding border.
 * First render ONE uninterrupted photograph across the two INNER viewports;
 * then distribute adjacent halves into the reserved image areas. The border
 * never obscures pixels and no photo is developed twice at the seam. */
function drawContinuousInsideBorders(output: HTMLCanvasElement, picture: HTMLCanvasElement, crop: CropTransform, sectionCount: SplitFrameCount) {
  if (sectionCount === 1 || (!(crop.borderWidth && crop.borderWidth > 0) && crop.borderPlacement !== 'auto')) {
    draw(output, picture, crop);
    return;
  }
  const sectionWidth = output.width / sectionCount;
  const geometry = planBorderFrame(sectionWidth, output.height, picture.width, picture.height,
    { placement: crop.borderPlacement ?? 'all', borderPercent: crop.borderWidth, fit: crop.borderPlacement === 'auto' ? 'contain' : 'cover' });
  const { inner } = geometry;
  const joined = document.createElement('canvas');
  try {
    joined.width = inner.width * sectionCount;
    joined.height = inner.height;
    draw(joined, picture, { ...crop, borderWidth: 0 });
    const context = output.getContext('2d');
    if (!context) throw new Error('Continuous border canvas is unavailable');
    context.fillStyle = crop.borderColour ?? '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    for (let i = 0; i < sectionCount; i += 1) {
      context.drawImage(joined, i * inner.width, 0, inner.width, inner.height,
        i * sectionWidth + inner.x, inner.y, inner.width, inner.height);
    }
  } finally {
    joined.width = 0;
    joined.height = 0;
  }
}

/** One split section of a finished 8-bit canvas, encoded. Every section is cut from the same canvas. */
async function encodeCanvasSection(output: HTMLCanvasElement, section: { x: number; width: number; height: number }, mimeType: string, profile: ExportProfile): Promise<Blob | null> {
  const piece = document.createElement('canvas');
  try {
    piece.width = section.width; piece.height = section.height;
    const context = piece.getContext('2d');
    if (!context) throw new Error('Canvas unavailable for split export.');
    context.drawImage(output, section.x, 0, section.width, section.height, 0, 0, section.width, section.height);
    return await new Promise<Blob | null>((resolve) => piece.toBlob(resolve, mimeType, profile.format === 'jpeg' ? profile.quality : undefined));
  } finally {
    piece.width = 0; piece.height = 0;
  }
}

/** A CSS colour as 16-bit sRGB, read through the canvas so every colour the 8-bit path accepts means the same here. */
function cssColour16(colour: string): [number, number, number] {
  const probe = document.createElement('canvas');
  probe.width = 1; probe.height = 1;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.fillStyle = '#ffffff';
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  probe.width = 0; probe.height = 0;
  return rgb8To16([r, g, b]);
}

/** `draw`, in 16 bits: the same border plan and the same placement, on RGB16 pixels. */
function draw16(target: Rgb16Image, picture: Rgb16Image, crop: CropTransform) {
  const border = crop.borderWidth ?? 0;
  const geometry = planBorderFrame(target.width, target.height, picture.width, picture.height,
    { placement: crop.borderPlacement ?? 'all', borderPercent: border, fit: crop.borderPlacement === 'auto' ? 'contain' : 'cover' });
  if (border > 0 || crop.borderPlacement === 'auto') fillRgb16(target, cssColour16(crop.borderColour ?? '#ffffff'));
  const inner = geometry.inner;
  const place = cropPlacement(inner.width, inner.height, { width: picture.width, height: picture.height }, crop);
  drawRgb16(target, picture, {
    centreX: inner.x + inner.width / 2 + place.translateX, centreY: inner.y + inner.height / 2 + place.translateY,
    rotateRad: place.rotateRad, scaleX: place.scaleX, scaleY: place.scaleY,
    drawWidth: crop.borderPlacement === 'auto' ? geometry.photo.width : place.drawWidth,
    drawHeight: crop.borderPlacement === 'auto' ? geometry.photo.height : place.drawHeight,
    clip: { x: inner.x + place.clip.x, y: inner.y + place.clip.y, width: place.clip.width, height: place.clip.height },
  });
}

/** `drawContinuousInsideBorders`, in 16 bits: one picture across the inner viewports, then shared out between the frames. */
function drawContinuousInsideBorders16(output: Rgb16Image, picture: Rgb16Image, crop: CropTransform, sectionCount: SplitFrameCount) {
  if (sectionCount === 1 || (!(crop.borderWidth && crop.borderWidth > 0) && crop.borderPlacement !== 'auto')) {
    draw16(output, picture, crop);
    return;
  }
  const sectionWidth = output.width / sectionCount;
  const geometry = planBorderFrame(sectionWidth, output.height, picture.width, picture.height,
    { placement: crop.borderPlacement ?? 'all', borderPercent: crop.borderWidth, fit: crop.borderPlacement === 'auto' ? 'contain' : 'cover' });
  const { inner } = geometry;
  const joined = blankRgb16(inner.width * sectionCount, inner.height);
  draw16(joined, picture, { ...crop, borderWidth: 0 });
  fillRgb16(output, cssColour16(crop.borderColour ?? '#ffffff'));
  for (let i = 0; i < sectionCount; i += 1) {
    copyRgb16(joined, { x: i * inner.width, y: 0, width: inner.width, height: inner.height }, output, i * sectionWidth + inner.x, inner.y);
  }
}

function setSpacing(context: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in context) (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  const rounded = context as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
  if (r > 0 && rounded.roundRect) rounded.roundRect(x, y, w, h, r); else context.rect(x, y, w, h);
}

/** How a box's contents line up: the text follows its own setting; the watermark follows its side when anchored. */
const markAlign = (overlay: OverlaySettings): 'left' | 'center' | 'right' => (overlay.watermarkPlacement === 'anchor' ? alignForAnchor(overlay.watermarkPosition) : 'center');

interface Measured { width: number; height: number }

function measureText(context: CanvasRenderingContext2D, input: OverlayDraw, k: number) {
  const rows = input.rows.filter((row) => row.text).map((row) => ({ ...row, px: row.sizePx * k }));
  if (!rows.length) return null;
  const widths = rows.map((row) => {
    context.font = `${row.weight} ${row.px}px ${row.family}`;
    setSpacing(context, row.letterSpacing * k);
    return context.measureText(row.text).width;
  });
  const cover = input.overlay.textLayoutMode === 'cover-full';
  const padX = (cover ? 24 : 12) * k, padY = (cover ? 24 : 8) * k;
  const textWidth = Math.max(...widths);
  const textHeight = rows.reduce((sum, row) => sum + row.px * LINE, 0);
  return { rows, widths, padX, padY, textHeight, size: { width: textWidth + padX * 2, height: textHeight + padY * 2 } };
}

function drawText(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, input: OverlayDraw, measured: NonNullable<ReturnType<typeof measureText>>, at: Box | undefined, k: number) {
  const { overlay } = input;
  const light = overlay.textColour === 'light';
  const cover = overlay.textLayoutMode === 'cover-full';
  const box = cover ? { x: 0, y: 0, width: canvas.width, height: canvas.height } : at!;
  const { rows, widths, padX, padY, textHeight } = measured;
  context.save();
  if (overlay.textScrim) {
    context.fillStyle = cover ? (light ? 'rgba(10, 12, 16, 0.48)' : 'rgba(246, 244, 238, 0.56)') : (light ? 'rgba(10, 12, 16, 0.62)' : 'rgba(246, 244, 238, 0.72)');
    roundRect(context, box.x, box.y, box.width, box.height, cover ? 0 : 4 * k);
    context.fill();
  }
  context.fillStyle = light ? '#F8F6F2' : '#14171F';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  const align = cover ? 'center' : overlay.textAlign;
  let y = cover ? (box.height - textHeight) / 2 : box.y + padY;
  rows.forEach((row, index) => {
    context.font = `${row.weight} ${row.px}px ${row.family}`;
    setSpacing(context, row.letterSpacing * k);
    const lineHeight = row.px * LINE;
    const inner = box.width - padX * 2;
    const x = box.x + padX + (align === 'left' ? 0 : align === 'right' ? inner - widths[index] : (inner - widths[index]) / 2);
    context.fillText(row.text, x, y + lineHeight / 2);
    y += lineHeight;
  });
  context.restore();
}

type MarkPlan =
  | { kind: 'image'; image: HTMLImageElement; width: number; height: number; padX: number; padY: number; size: Measured }
  | { kind: 'text'; text: string; subtext?: string; family: string; big: number; small: number; widths: [number, number]; padX: number; padY: number; size: Measured };

function measureMark(context: CanvasRenderingContext2D, input: OverlayDraw, k: number): MarkPlan | null {
  if (!input.mark) return null;
  const s = input.overlay.watermarkScale / 100;
  const padX = 10 * k * s, padY = 4 * k * s;
  if (input.mark.kind === 'image') {
    const { image } = input.mark;
    const fitted = fitWatermarkArtwork(k * 660, image.naturalWidth, image.naturalHeight);
    if (!fitted.width || !fitted.height) return null;
    const width = fitted.width * s, height = fitted.height * s;
    return { kind: 'image', image, width, height, padX, padY, size: { width: width + padX * 2, height: height + padY * 2 } };
  }
  const { text, subtext } = input.mark;
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const big = 11 * k * s, small = 9 * k * s;
  context.font = `700 ${big}px ${family}`;
  setSpacing(context, 0.14 * big);
  const bigWidth = context.measureText(text).width;
  let smallWidth = 0;
  if (subtext) { context.font = `400 ${small}px ${family}`; setSpacing(context, 0.18 * small); smallWidth = context.measureText(subtext).width; }
  const size = { width: Math.max(bigWidth, smallWidth) + padX * 2, height: big * MARK_LINE + (subtext ? small * MARK_LINE : 0) + padY * 2 };
  return { kind: 'text', text, ...(subtext ? { subtext } : {}), family, big, small, widths: [bigWidth, smallWidth], padX, padY, size };
}

function drawMark(context: CanvasRenderingContext2D, input: OverlayDraw, plan: MarkPlan, box: Box, k: number) {
  const { overlay } = input;
  const lightMark = input.contrast === 'light-on-dark';
  context.save();
  context.globalAlpha = overlay.watermarkOpacity / 100;
  if (plan.kind === 'image') {
    context.drawImage(plan.image, box.x + plan.padX, box.y + plan.padY, plan.width, plan.height);
  } else {
    const s = overlay.watermarkScale / 100;
    context.fillStyle = lightMark ? 'rgba(9, 11, 15, 0.36)' : 'rgba(248, 246, 242, 0.54)';
    roundRect(context, box.x, box.y, box.width, box.height, 4 * k * s);
    context.fill();
    context.fillStyle = lightMark ? '#F8F6F2' : '#14171F';
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    const align = markAlign(overlay);
    const inner = box.width - plan.padX * 2;
    const xFor = (width: number) => box.x + plan.padX + (align === 'left' ? 0 : align === 'right' ? inner - width : (inner - width) / 2);
    context.font = `700 ${plan.big}px ${plan.family}`;
    setSpacing(context, 0.14 * plan.big);
    context.fillText(plan.text, xFor(plan.widths[0]), box.y + plan.padY + (plan.big * MARK_LINE) / 2);
    if (plan.subtext) {
      context.globalAlpha *= 0.8;
      context.font = `400 ${plan.small}px ${plan.family}`;
      setSpacing(context, 0.18 * plan.small);
      context.fillText(plan.subtext, xFor(plan.widths[1]), box.y + plan.padY + plan.big * MARK_LINE + (plan.small * MARK_LINE) / 2);
    }
  }
  context.restore();
}

/** Text and watermark, placed by the same rule the canvas uses (overlayLayout.ts): anchored to an edge margin, or stacked. */
function drawOverlay(canvas: HTMLCanvasElement, input: OverlayDraw) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const k = referenceScale(canvas.width);
  const text = input.text ? measureText(context, input, k) : null;
  const mark = input.watermark ? measureMark(context, input, k) : null;
  const cover = input.overlay.textLayoutMode === 'cover-full';
  const boxes = layoutOverlays(canvas, input.overlay, { ...(text && !cover ? { text: text.size } : {}), ...(mark ? { mark: mark.size } : {}) }, k);
  if (text) drawText(context, canvas, input, text, boxes.text, k);
  if (mark && boxes.mark) drawMark(context, input, mark, boxes.mark, k);
}

/**
 * Draw one V2 export: the edited picture placed the way the canvas shows it (cover, zoom, pan, flips, rotation, edge insets),
 * then the overlay from the same description. The edit is applied to the whole framed picture first, so masks stay in place
 * whatever the crop. The output is never larger than the picture can fill (the size cap), and the result reports that.
 */
export async function renderV2Export(
  source: HTMLImageElement, frame: PhotoFrame, size: { width: number; height: number }, crop: CropTransform,
  profile: ExportProfile, overlay: OverlayDraw | null, date: Date, signal?: AbortSignal, sectionCount: SplitFrameCount = 1,
  /** The photo already framed and edited at 16 bits, full size (renderRaw16). When given, the picture comes from it, not `source`. */
  precise?: Rgb16Image,
): Promise<V2RenderResult> {
  signal?.throwIfAborted();
  if (!(source.naturalWidth > 0) || !(source.naturalHeight > 0)) throw new Error(`Cannot export ${frame.filename}: the decoded source has invalid pixel dimensions. Reconnect or redevelop the original.`);
  const framing = frame.framing ?? DEFAULT_FRAMING;
  const { width: fw, height: fh } = precise ? { width: precise.width, height: precise.height } : framedSize(source.naturalWidth, source.naturalHeight, framing);
  const requested = continuousExportLayout(size.width, size.height, sectionCount);
  const limit = maxCanvasPixels({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
  // Upscale (2x or 4x, chosen on the photo) lifts the "never larger than the picture" cap by that factor, only when the size asks for more pixels.
  const out = effectiveUpscaleOutputSize({ width: requested.width, height: requested.height, crop }, { width: fw, height: fh }, frame.edit?.upscale, limit);
  const up = out.factor;
  const layout = cappedContinuousLayout(out.width, out.height, sectionCount);
  const wasCapped = out.capped || layout.width !== requested.width || layout.height !== requested.height;
  if (layout.width * layout.height > limit) throw new Error(`This device cannot safely export ${layout.width} × ${layout.height} px. Choose a smaller size or export on a desktop. No smaller file was substituted.`);
  // Edit only as many pixels as the output can show: the cover fit times the zoom, never above the picture's own size.
  const needed = Math.max(layout.width / fw, layout.height / fh) * crop.zoom;
  const scale = Math.min(1, needed, fitScale(fw, fh, limit));
  // Not marked '-preview': a V2 export of a RAW is always drawn from its sensor develop (fullSource refuses the camera's
  // embedded JPEG and stored review copies), and the word made people think a preview had been exported.
  const name = exportFilename(frame.filename, profile, false);
  const mimeType = profile.format === 'png' ? 'image/png' : 'image/jpeg';
  if (precise) {
    let sized = downscaleRgb16(precise, Math.max(1, Math.round(fw * scale)), Math.max(1, Math.round(fh * scale)));
    signal?.throwIfAborted();
    // Picture layers, on the whole framed picture as the canvas path does, blended into the 16-bit pixels.
    await applyFrameLayers16(sized, frame.overlay, true, frame.edit?.masks);
    signal?.throwIfAborted();
    // Output scale: the same Lanczos-3 resampler as the 8-bit path, on 16-bit samples.
    if (up !== 1 && scale >= 1) sized = enlargeRgb16(sized, up as 2 | 4, signal);
    signal?.throwIfAborted();
    const output16 = blankRgb16(layout.width, layout.height);
    drawContinuousInsideBorders16(output16, sized, crop, sectionCount);
    signal?.throwIfAborted();
    if (overlay) {
      await Promise.all(overlay.rows.map((row) => document.fonts?.load(`${row.weight} 16px ${row.family}`).catch(() => [])));
      signal?.throwIfAborted();
      // Text and watermark on a clear sheet, then laid over the 16-bit picture: only the pixels they cover change.
      const sheet = document.createElement('canvas');
      try {
        sheet.width = layout.width; sheet.height = layout.height;
        drawOverlay(sheet, overlay);
        const context = sheet.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas unavailable');
        overlayRgba8OnRgb16(output16, context.getImageData(0, 0, sheet.width, sheet.height).data);
      } finally {
        sheet.width = 0; sheet.height = 0;
      }
    }
    // A JPEG is 8-bit by definition: round the finished frame once, with the deterministic dither, and cut from that.
    const output8 = profile.format === 'png' ? null : document.createElement('canvas');
    try {
      if (output8) {
        output8.width = layout.width; output8.height = layout.height;
        const context = output8.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.putImageData(new ImageData(ditherRgb16ToRgba8(output16), layout.width, layout.height), 0, 0);
      }
      const sections: File[] = [];
      for (const section of layout.sections) {
        signal?.throwIfAborted();
        let blob: Blob | null;
        if (!output8) {
          const piece = cropRgb16(output16, { x: section.x, y: 0, width: section.width, height: section.height });
          blob = await encodePng16(piece);
          // Read the written header back: a 16-bit RGB PNG of exactly this size, or nothing is saved.
          const proof = provePng(new Uint8Array(await blob.arrayBuffer()));
          if (proof.bitDepth !== 16 || proof.colourType !== 2 || proof.width !== section.width || proof.height !== section.height || !proof.srgb)
            throw new Error(`The 16-bit PNG for section ${section.index} did not read back as 16-bit RGB at ${section.width} × ${section.height} pixels. Nothing was saved.`);
        } else {
          blob = await encodeCanvasSection(output8, section, mimeType, profile);
        }
        signal?.throwIfAborted();
        if (!blob || blob.type !== mimeType || blob.size === 0) throw new Error(`Could not encode split section ${section.index} at ${section.width} × ${section.height} pixels.`);
        const tagged = await tagSrgb(blob, profile.format === 'png' ? 'png' : 'jpeg');
        signal?.throwIfAborted();
        sections.push(datedExport(tagged, numberedSectionFilename(name, section.index, sectionCount), date, frame.exif?.captureStamp));
      }
      return { file: sections[0], width: layout.sectionWidth, height: layout.height, capped: wasCapped, precision: 'rgb16',
        bitsPerChannel: profile.format === 'png' ? 16 : 8, ...(sectionCount > 1 ? { sections } : {}) };
    } finally {
      if (output8) { output8.width = 0; output8.height = 0; }
    }
  }
  const picture = document.createElement('canvas');
  const output = document.createElement('canvas');
  try {
    drawFramedPhoto(source, picture, framing, { scale });
    await applyCanvasExportEdit(picture, frame.edit ?? DEFAULT_EDIT, signal, Math.max(fw, fh) * scale, { aspect: fh / fw, view: { x: 0, y: 0, w: 1, h: 1 }, lensCentre: lensCentre(source.naturalWidth, source.naturalHeight, framing) });
    signal?.throwIfAborted();
    await applyFrameLayers(picture, frame.overlay, true, frame.edit?.masks);
    signal?.throwIfAborted();
    if (up !== 1 && scale >= 1) await upscaleCanvasInPlace(picture, up, signal);
    signal?.throwIfAborted();
    output.width = layout.width; output.height = layout.height;
    drawContinuousInsideBorders(output, picture, crop, sectionCount);
    if (overlay) {
      await Promise.all(overlay.rows.map((row) => document.fonts?.load(`${row.weight} 16px ${row.family}`).catch(() => [])));
      signal?.throwIfAborted();
      drawOverlay(output, overlay);
    }
    // Every section is cut from this SAME fully edited canvas. Never develop or
    // crop the photograph separately for each side of the seam.
    const sections: File[] = [];
    for (const section of layout.sections) {
      signal?.throwIfAborted();
      const blob = await encodeCanvasSection(output, section, mimeType, profile);
      signal?.throwIfAborted();
      if (!blob || blob.type !== mimeType || blob.size === 0) {
        throw new Error(`Could not encode split section ${section.index} at ${section.width} × ${section.height} pixels.`);
      }
      // The canvas is sRGB but toBlob writes no colour tag; say so in the file (iccEmbed.ts).
      const tagged = await tagSrgb(blob, profile.format === 'png' ? 'png' : 'jpeg');
      signal?.throwIfAborted();
      const sectionName = numberedSectionFilename(name, section.index, sectionCount);
      sections.push(datedExport(tagged, sectionName, date, frame.exif?.captureStamp));
    }
    return { file: sections[0], width: layout.sectionWidth, height: layout.height, capped: wasCapped, precision: '8-bit',
      bitsPerChannel: 8,
      ...(sectionCount > 1 ? { sections } : {}) };
  } finally {
    picture.width = 0; picture.height = 0; output.width = 0; output.height = 0;
  }
}
