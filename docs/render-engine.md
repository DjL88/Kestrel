# Render engine

Edits render on the GPU (WebGL2) when available and fall back to the CPU path otherwise. Both read the same constants from `editParams()` in `src/core/photoEdits.ts`. The shader in `src/providers/webglEdit.ts` mirrors `applyPhotoEdit`, so change them together.

## Measured (Chromium in the Claude desktop app, one Mac, not a benchmark suite)
- Parity: GPU and CPU output differ by at most 1 of 255 levels across exposure, warmth, colour, contrast, shadows, highlights, whites, blacks, vibrance and a combined edit on a 1200x800 test image.
- Speed on a 6000x4000 canvas, including texture upload and readback: CPU 546 ms. GPU 13 ms warm, 162 ms on the first call (shader compile).

## Not done yet
- Rendering still runs on the main thread. Moving it to a Worker with OffscreenCanvas is next.
- Local detail controls (texture, clarity, sharpening), tone curve, histogram.
- Images larger than the GPU texture limit (16384 px here) fall back to the CPU path.
- No automated browser test for parity. Re-run the comparison by importing `applyPhotoEdit` and `renderEditOnGpu` in the browser console on a gradient-and-colour-patch canvas.
