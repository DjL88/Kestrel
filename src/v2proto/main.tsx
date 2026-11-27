import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '../index.css';
import { setGpuRenderer } from '../core/canvasEdit';
import { prepareGpu, renderEditOnGpu } from '../providers/webglEdit';
import V2Root from '../v2/V2Root';

setGpuRenderer(renderEditOnGpu);
// The graphics-card shaders are compiled once the app is up and the page is idle, never in the middle of an action.
const whenIdle = (globalThis as { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
if (whenIdle) whenIdle(prepareGpu, { timeout: 5000 }); else setTimeout(prepareGpu, 3000);
createRoot(document.getElementById('root')!).render(<Suspense fallback={null}><V2Root /></Suspense>);
