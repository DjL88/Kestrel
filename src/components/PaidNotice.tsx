import { Lock } from 'lucide-react';
import { projectsText as t } from '../i18n/areas/projects';

/** A calm, honest note where a Pro tool would be. It says what is free, never nags, and there is nothing to buy yet. */
export function PaidNotice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section aria-label={t.paid.label(title)} className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
      <h3 className="flex items-center gap-2 font-medium text-zinc-100"><Lock className="h-4 w-4 shrink-0" aria-hidden="true" />{t.paid.heading(title)}</h3>
      {children && <p>{children}</p>}
      <p className="text-xs text-zinc-400">{t.paid.free}</p>
    </section>
  );
}
