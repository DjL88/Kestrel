import { useEffect, useState } from 'react';
import { effectiveKeymap, loadKeymap, type Keymap } from './keymap';

/**
 * The one keymap both the editor's keyboard dispatcher (App.tsx) and any shortcut label
 * (TopBar's undo/redo tooltips, the shortcut guide) must agree on. Settings > Keyboard can
 * change the saved preset or an override while the studio stays mounted in the same tab —
 * the browser's `storage` event only fires in *other* tabs, so this also re-reads on focus
 * returning to the window, which covers the common same-tab case (leave Settings, click back
 * into the studio). Previously App.tsx read this once with `useMemo(..., [])` and never
 * refreshed, while TopBar refreshed live: a same-tab rebind could show a new shortcut in the
 * tooltip that the dispatcher would not actually run. Both now share this hook so they can't
 * drift apart again.
 */
export function useLiveKeymap(): Keymap {
  const [keymap, setKeymap] = useState<Keymap>(() => {
    const saved = loadKeymap();
    return effectiveKeymap(saved.preset, saved.overrides);
  });
  useEffect(() => {
    const refresh = () => {
      const saved = loadKeymap();
      setKeymap(effectiveKeymap(saved.preset, saved.overrides));
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('focusin', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('focusin', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return keymap;
}
