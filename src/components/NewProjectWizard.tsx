import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { DEFAULT_TARGET, TARGET_CHOICES, WIZARD_DEFAULTS, parseTarget, type ProjectSettings } from '../core/projectSettings';

interface Props {
  loading: boolean;
  onCancel: () => void;
  onCreate: (name: string, options: { keeperTarget: number; settings: ProjectSettings }) => void;
}

const STEPS = 3;

/** One question per step, with a way back at every step. Nothing is created until the last button. */
export function NewProjectWizard({ loading, onCancel, onCreate }: Props) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [targetText, setTargetText] = useState(String(DEFAULT_TARGET));
  const [settings, setSettings] = useState<ProjectSettings>(WIZARD_DEFAULTS);
  const heading = useRef<HTMLHeadingElement>(null);
  const target = parseTarget(targetText);
  const valid = step === 1 ? !!name.trim() : step === 2 ? target !== null : true;

  useEffect(() => { heading.current?.focus(); }, [step]);

  const next = () => {
    if (!valid) return;
    if (step < STEPS) setStep(step + 1);
    else if (target !== null) onCreate(name.trim(), { keeperTarget: target, settings });
  };
  const choice = 'flex min-h-11 items-start gap-3 rounded-lg border border-white/10 p-3 text-sm hover:bg-white/5';

  return (
    <form className="mb-4 space-y-4 rounded-xl border border-white/10 bg-kestrel-raised p-4" aria-labelledby="wizard-title"
      onSubmit={(event) => { event.preventDefault(); next(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }}>
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>Step {step} of {STEPS}</span>
        <div className="flex gap-1" aria-hidden="true">
          {Array.from({ length: STEPS }, (_, index) => (
            <span key={index} className={`h-1.5 w-8 rounded-full ${index < step ? 'bg-kestrel-copper' : 'bg-white/15'}`} />
          ))}
        </div>
      </div>
      <h2 id="wizard-title" ref={heading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
        {step === 1 ? 'What is this project called?' : step === 2 ? 'How many photos do you want to end up with?' : 'How much help would you like?'}
      </h2>

      {step === 1 && (
        <label className="block text-sm">
          Project name
          <input autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-black/20 px-3" />
        </label>
      )}

      {step === 2 && (
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
      )}

      {step === 3 && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">Everything runs on this device. Nothing is deleted, and you can turn these off later in Workspace options.</p>
          <label className={choice}>
            <input type="checkbox" className="mt-1 h-5 w-5" checked={settings.autoCull} onChange={(event) => setSettings({ ...settings, autoCull: event.target.checked })} />
            <span><strong className="block">Auto-cull</strong>
              After you add photos, Kestrel scans them and suggests keepers and rejects. Clear-cut results move for you. Trash is reversible and never touches your files.</span>
          </label>
          <label className={choice}>
            <input type="checkbox" className="mt-1 h-5 w-5" checked={settings.autoEdit} onChange={(event) => setSettings({ ...settings, autoEdit: event.target.checked })} />
            <span><strong className="block">Auto-edit</strong>
              The first time you open a photo to edit, Kestrel suggests colour and tone and says why. You can undo it or reset the photo.</span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={step === 1 ? onCancel : () => setStep(step - 1)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm hover:bg-white/8">
          {step === 1 ? 'Cancel' : <><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</>}
        </button>
        <button type="submit" disabled={!valid || loading}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-kestrel-copper hover:bg-kestrel-copper-hover! px-4 text-sm font-semibold text-zinc-950 disabled:opacity-40">
          {step < STEPS ? <>Next<ArrowRight className="h-4 w-4" aria-hidden="true" /></> : 'Create project'}
        </button>
      </div>
    </form>
  );
}
