import { Lock } from 'lucide-react';

/** A calm, honest note where a Pro tool would be. It says what is free, never nags, and there is nothing to buy yet. */
export function PaidNotice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section aria-label={`${title}, part of Kestrel Pro`} className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
      <h3 className="flex items-center gap-2 font-medium text-zinc-100"><Lock className="h-4 w-4 shrink-0" aria-hidden="true" />{title} is part of Kestrel Pro</h3>
      {children && <p>{children}</p>}
      <p className="text-xs text-zinc-400">Importing, editing and exporting your photos stay free, on this device. Pro is not available to buy yet.</p>
    </section>
  );
}
