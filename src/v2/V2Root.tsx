import './ui/v2.css';
import V2App from './ui/App';

/** The Version 2 workspace. Loaded only behind `?v2` (see src/v2/switch.ts); until the engine is wired it runs on the
 * UI's own stub store (src/v2/ui/stub.ts), so it shows sample photos and never touches a real project or original. */
export default function V2Root() {
  return <V2App />;
}
