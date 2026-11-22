import './ui/v2.css';
import V2App from './ui/App';
import { useWorkspace } from './ui/stub';
import { useEngineWorkspace } from './engineClient/useEngineWorkspace';

/** The Version 2 workspace, behind `?v2` (see src/v2/switch.ts). It runs on the real catalogue: projects, import,
 * thumbnails, flag, rating and tasks. `?v2&stub=1` keeps the UI's sample-data store for design work. Edit-type
 * actions are not connected yet and say so. */
const useSampleStore = new URLSearchParams(window.location.search).get('stub') === '1';

export default function V2Root() {
  return <V2App useStore={useSampleStore ? useWorkspace : useEngineWorkspace} />;
}
