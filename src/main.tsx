import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { Splash } from './components/Splash.tsx';
import { V2Workspace } from './v2/V2Workspace.tsx';
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

// No browser right-click menu in the app (Open Image in New Window, Download Image, Inspect Element), except in text fields.
document.addEventListener('contextmenu', (event) => { if (!keepsNativeMenu(event.target as HTMLElement | null)) event.preventDefault(); });

applyDisplay(loadDisplay());
setGpuRenderer(renderEditOnGpu);

// docs/V2-WORKSPACE.md build order step 1: the native V2 workspace shell, behind a `?v2` switch so the
// existing Library/Editor pages are completely untouched for everyone else. Not linked from the app yet.
const showV2 = new URLSearchParams(window.location.search).has('v2');

createRoot(document.getElementById('root')!).render(
  showV2 ? <V2Workspace onExit={() => { window.location.search = ''; }} /> : <><App /><Splash /></>,
);

void manageOfflineWorker(import.meta.env.PROD, isDesktopApp());
