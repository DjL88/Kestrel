import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { applyTheme, loadTheme } from './providers/browserTheme.ts';

applyTheme(loadTheme());

createRoot(document.getElementById('root')!).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const worker = new URL(`${import.meta.env.BASE_URL}offline.js`, location.href);
  void navigator.serviceWorker.register(worker).catch(() => {
    // Some embedded previews forbid service workers; local editing still works after load.
  });
}
