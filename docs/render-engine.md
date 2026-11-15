# Render engine

Edits render on the GPU (WebGL2) when available and fall back to the CPU path otherwise. Both read the same constants from `editParams()` in `src/core/photoEdits.ts`. The shader in `src/providers/webglEdit.ts` mirrors `applyPhotoEdit`, so change them together.

## Measured (Chromium in the Claude desktop app, one Mac, not a benchmark suite)
- Parity: GPU and CPU output differ by at most 1 of 255 levels across exposure, warmth, colour, contrast, shadows, highlights, whites, blacks, vibrance and a combined edit on a 1200x800 test image.
- Speed on a 6000x4000 canvas, including texture upload and readback: CPU 546 ms. GPU 13 ms warm, 162 ms on the first call (shader compile).

## Detail controls and histogram
- Texture, clarity and sharpening are luminance-only. Scales are fractions of the whole image's long edge (0.15%, 0.6%, 0.04%), so the fit preview, zoomed detail and export agree.
- On the GPU a second pass reads mipmaps of the tone result as its blurs. The CPU fallback uses true box blurs. On a 1200x800 test image the two differ by 0.3 to 0.7 of 255 on average and by up to 15 to 30 at hard edges. They are close, not identical, so an oversized image that falls back to the CPU on export can differ slightly from the preview.
- The histogram reads a 256 px copy of the edited preview, so it reflects the edit, not the original. Clipping counts a pixel when any channel is 0 or 255, and is stated in words and arrows, not colour.

## Not done yet
- Rendering still runs on the main thread. Moving it to a Worker with OffscreenCanvas is next.
- Tone curve.
- Noise reduction, and any masked version of these controls.
- Images larger than the GPU texture limit (16384 px here) fall back to the CPU path.
- No automated browser test for parity. Re-run the comparison by importing `applyPhotoEdit` and `renderEditOnGpu` in the browser console on a gradient-and-colour-patch canvas.
