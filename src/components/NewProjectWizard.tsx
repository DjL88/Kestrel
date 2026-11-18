import { useState } from 'react';
import { DEFAULT_TARGET, TARGET_CHOICES, WIZARD_DEFAULTS, parseTarget, type ProjectSettings } from '../core/projectSettings';

interface Props {
  loading: boolean;
  onCancel: () => void;
  onCreate: (name: string, options: { keeperTarget: number; settings: ProjectSettings }) => void;
}

export function NewProjectWizard({ loading, onCancel, onCreate }: Props) {
  const [name, setName] = useState('');
  const [targetText, setTargetText] = useState(String(DEFAULT_TARGET));
  const [settings, setSettings] = useState<ProjectSettings>(WIZARD_DEFAULTS);
  const target = parseTarget(targetText);
  const valid = Boolean(name.trim()) && target !== null;

  const choice = 'flex min-h-11 items-start gap-3 rounded-lg border border-white/10 p-3 text-sm hover:bg-white/5';

  return (
    <form className="mb-4 space-y-4 rounded-xl border border-white/10 bg-kestrel-raised p-4" aria-labelledby="wizard-title"
      onSubmit={(event) => { event.preventDefault(); if (valid && !loading && target !== null) onCreate(name.trim(), { keeperTarget: target, settings }); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}>
      <h2 id="wizard-title" className="text-lg font-semibold">New project</h2>
      <label className="block text-sm">
        Project name
        <input autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-black/20 px-3" />
      </label>
      <p className="text-xs text-zinc-400">Keeper target: {target ?? 'invalid'}. Auto-cull {settings.autoCull ? 'on' : 'off'}. Auto-edit {settings.autoEdit ? 'on' : 'off'}.</p>
      <details className="rounded-lg border border-white/10 px-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Project options</summary>
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">Kestrel shows progress toward this number as you choose keepers. You can change it later.</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Common targets">
            {TARGET_CHOICES.map((choiceValue) => (
              <button key={choiceValue} type="button" aria-pressed={target === choiceValue} onClick={() => setTargetText(String(choiceValue))}
                className="min-h-11 min-w-16 rounded-lg border border-white/15 px-3 text-sm hover:bg-white/8 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15">{choiceValue}</button>
            ))}
          </div>
          <label className="block text-sm">
            Or type a number
            <input inputMode="numeric" value={targetText} onChange={(event) => setTargetText(event.target.value)} aria-invalid={target === null}
              aria-describedby="target-help" className="mt-1 min-h-11 w-32 rounded-lg border border-white/15 bg-black/20 px-3 tabular-nums" />
          </label>
          <p id="target-help" role={target === null ? 'alert' : undefined} className={`text-xs ${target === null ? 'font-semibold text-orange-200' : 'text-zinc-400'}`}>
            {target === null ? 'Enter a whole number from 1 to 9999.' : `Aim for ${target} ${target === 1 ? 'photo' : 'photos'}.`}
          </p>
        </div>
        <div className="space-y-2 py-3">
          <p className="text-sm text-zinc-300">Everything runs on this device. Nothing is deleted, and you can turn these off later in Workspace options.</p>
          <label className={choice}>
            <input type="checkbox" className="mt-1 h-5 w-5" checked={settings.autoCull} onChange={(event) => setSettings({ ...settings, autoCull: event.target.checked })} />
            <span><strong className="block">Auto-cull</strong>
              After import, a cancellable local task reviews your photos while you browse. High-confidence keepers and exact duplicates are sorted automatically; uncertain photos stay for review. Originals are untouched.</span>
          </label>
          <label className={choice}>
            <input type="checkbox" className="mt-1 h-5 w-5" checked={settings.autoEdit} onChange={(event) => setSettings({ ...settings, autoEdit: event.target.checked })} />
            <span><strong className="block">Auto-edit</strong>
              After culling, untouched keepers receive a conservative starting edit automatically when the preview passes quality checks. Your own edits and crops are never overwritten; more suggestions stay behind Auto → Suggest a look.</span>
          </label>
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm hover:bg-white/8">
          Cancel
        </button>
        <button type="submit" disabled={!valid || loading}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-kestrel-copper hover:bg-kestrel-copper-hover! px-4 text-sm font-semibold text-zinc-950 disabled:opacity-40">
          Create project
        </button>
      </div>
    </form>
  );
}
