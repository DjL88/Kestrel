import { Settings2 } from 'lucide-react';
import { libraryText as t } from '../i18n/areas/library';

/** Settings, always in the top right corner, on every page and every screen size. */
export function SettingsButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={t.settingsButton.label} aria-haspopup="dialog" aria-expanded={open}
      title={t.settingsButton.title}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-white/15 text-zinc-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
      <Settings2 className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
