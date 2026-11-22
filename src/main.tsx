import { lazy, Suspense } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { Splash } from './components/Splash.tsx';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import './index.css';
import { setGpuRenderer } from './core/canvasEdit.ts';
import { renderEditOnGpu } from './providers/webglEdit.ts';
import { applyDisplay, loadDisplay } from './providers/browserTheme.ts';
import { isDesktopApp } from './providers/desktopShell.ts';
import { keepsNativeMenu } from './core/appChrome.ts';
import { manageOfflineWorker } from './providers/offlineWorker.ts';
import { v2Enabled } from './v2/switch.ts';

// Version 2 workspace, behind ?v2 while it is built. Its code and sample photos load only when the switch is on.
const V2Root = lazy(() => import('./v2/V2Root.tsx'));

// No browser right-click menu in the app (Open Image in New Window, Download Image, Inspect Element), except in text fields.
document.addEventListener('contextmenu', (event) => { if (!keepsNativeMenu(event.target as HTMLElement | null)) event.preventDefault(); });

applyDisplay(loadDisplay());
setGpuRenderer(renderEditOnGpu);

createRoot(document.getElementById('root')!).render(
  v2Enabled() ? <Suspense fallback={null}><V2Root /></Suspense> : <><App /><Splash /></>,
);

void manageOfflineWorker(import.meta.env.PROD, isDesktopApp());
