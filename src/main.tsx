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
import { manageOfflineWorker } from './providers/offlineWorker.ts';

applyDisplay(loadDisplay());
setGpuRenderer(renderEditOnGpu);

createRoot(document.getElementById('root')!).render(<><App /><Splash /></>);

void manageOfflineWorker(import.meta.env.PROD, isDesktopApp());
