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

import { useEffect } from 'react';
import { AccountAndLicenceSettings } from '../components/AccountAndLicenceSettings';
import { loadPublicFlags } from '../providers/featureFlagsStore';
import { loadLicence } from '../providers/licenceStore';
import V2App from './ui/App';
import { useWorkspace } from './ui/stub';
import { useEngineWorkspace } from './engineClient/useEngineWorkspace';

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

  return <V2App
    useStore={useSampleStore ? useWorkspace : useEngineWorkspace}
    accountPanel={useSampleStore ? undefined : <AccountAndLicenceSettings />}
  />;
}
