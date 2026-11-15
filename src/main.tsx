import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import '@fontsource/plus-jakarta-sans/latin-400.css';
import '@fontsource/plus-jakarta-sans/latin-600.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import './index.css';
import { applyDisplay, loadDisplay } from './providers/browserTheme.ts';

applyDisplay(loadDisplay());

createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const worker = new URL(`${import.meta.env.BASE_URL}offline.js`, location.href);
  void navigator.serviceWorker.register(worker).catch(() => {
    // Some embedded previews forbid service workers; local editing still works after load.
  });
}
