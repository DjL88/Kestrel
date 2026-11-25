import './ui/v2.css';
// The favourite fonts, bundled (SIL OFL) so a font looks the same offline and in exports. Inter and Plus Jakarta Sans load with the app.
import '@fontsource/playfair-display/latin-400.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-700.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-700.css';
import '@fontsource/oswald/latin-400.css';
import '@fontsource/oswald/latin-700.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-700.css';

import { parseControlPlaneUrl } from '../core/licenceOnline';
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { AccountAndLicenceSettings } from '../components/AccountAndLicenceSettings';
import { loadPublicFlags } from '../providers/featureFlagsStore';
import { loadLicence } from '../providers/licenceStore';
import V2App from './ui/App';
import { useWorkspace } from './ui/stub';
import { useEngineWorkspace } from './engineClient/useEngineWorkspace';
import { STRINGS } from './ui/strings';

/** The Version 2 workspace, behind `?v2` (see src/v2/switch.ts). It runs on the real catalogue: projects, import,
 * thumbnails, flag, rating and tasks. `?v2&stub=1` keeps the UI's sample-data store for design work. Edit-type
 * actions are not connected yet and say so. */
const useSampleStore = new URLSearchParams(window.location.search).get('stub') === '1';

export default function V2Root() {
  useEffect(() => {
    if (!useSampleStore) {
      void loadLicence();
      void loadPublicFlags();
    }
  }, []);

  return <V2ErrorBoundary><V2App
    useStore={useSampleStore ? useWorkspace : useEngineWorkspace}
    accountPanel={useSampleStore ? undefined : <AccountAndLicenceSettings />}
    serviceBase={useSampleStore ? undefined : parseControlPlaneUrl(import.meta.env.VITE_KESTREL_CONTROL_PLANE_URL) ?? undefined}
  /></V2ErrorBoundary>;
}

/**
 * Without this, any error while drawing the studio unmounts everything and leaves a blank dark window, with nothing
 * to say what happened (owner report, 24 Nov 2026: "added 2 photos and have a black screen"). The catalogue is saved
 * as it changes, so a reload carries on from the last change; the details help find the cause.
 */
export class V2ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[InFlight V2] The studio stopped drawing', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const words = STRINGS.crash;
    return (
      <div className="inflight-v2" role="alert" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-app, #12141a)', color: 'var(--text-primary, #f2f2f2)' }}>
        <div style={{ maxWidth: 560 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{words.title}</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 16 }}>{words.body}</p>
          <button type="button" onClick={() => window.location.reload()}
            style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--brand-accent, #f07a3a)', color: '#111', fontWeight: 600 }}>
            {words.reload}
          </button>
          <details style={{ marginTop: 16, fontSize: 12 }}>
            <summary>{words.details}</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 8 }}>{`${error.name}: ${error.message}\n${error.stack ?? ''}`}</pre>
          </details>
        </div>
      </div>
    );
  }
}
