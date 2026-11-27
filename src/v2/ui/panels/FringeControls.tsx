import React from 'react';
import type { EditRecipe, LensProfileOutcome } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';

const T = STRINGS.adjust.fringe;
const L = STRINGS.adjust.lens;
type Outcome = 'corrected' | 'clean' | 'unclear';

interface Props {
  recipe: EditRecipe;
  calmView: boolean;
  showAdvanced: boolean;
  onChange: (patch: Partial<EditRecipe>) => void;
  onDetect: () => Promise<Outcome>;
}

function Slider({ id, label, help, value, min, calmView, onChange, leftHint, rightHint }: { id: string; label: string; help: string; value: number; min: number; calmView: boolean; onChange: (v: number) => void; leftHint?: string; rightHint?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <label htmlFor={id} className="text-xs font-medium text-[var(--text-primary)]">{label}</label>
          <InfoPopover title={label} body={help} />
        </div>
        {!calmView && (
          <button type="button" onClick={() => onChange(0)} className="font-mono text-[0.6875rem] text-[var(--text-secondary)] tabular-nums hover:text-[var(--brand-accent)]">
            {`${value > 0 && min < 0 ? '+' : ''}${Math.round(value)}`}
          </button>
        )}
      </div>
      <input id={id} type="range" min={min} max={100} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="inflight-slider" />
      {(leftHint || rightHint) && (
        <div className="flex items-center justify-between text-[0.625rem] text-[var(--text-muted)]"><span>{leftHint}</span><span>{rightHint}</span></div>
      )}
    </div>
  );
}

/** Lens colour fringes: measured lateral correction (manual in Advanced) and purple/green fringe removal. */
export function FringeControls({ recipe, calmView, showAdvanced, onChange, onDetect }: Props) {
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const red = recipe.caRed ?? 0, blue = recipe.caBlue ?? 0;
  const corrected = red !== 0 || blue !== 0;
  const detect = async () => {
    setBusy(true);
    setOutcome(null);
    try { setOutcome(await onDetect()); } finally { setBusy(false); }
  };
  const status = outcome === 'clean' ? T.clean : outcome === 'unclear' ? T.unclear : corrected ? (outcome === 'corrected' ? T.corrected : T.active) : null;
  return (
    <div className="space-y-3" data-testid="fringe">
      <div className="flex items-center gap-1">
        <h4 className="text-xs font-medium text-[var(--text-primary)]">{T.heading}</h4>
        <InfoPopover title={T.heading} body={T.help} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <button type="button" onClick={detect} disabled={busy} aria-describedby="fringe-status"
            className="min-h-8 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:border-[var(--brand-accent)] disabled:opacity-60">
            {busy ? T.detecting : T.detect}
          </button>
          <InfoPopover title={T.detect} body={T.detectHelp} />
        </div>
        <p id="fringe-status" role="status" className="text-[0.6875rem] leading-snug text-[var(--text-muted)]">
          {status}
          {corrected && (
            <button type="button" onClick={() => { setOutcome(null); onChange({ caRed: 0, caBlue: 0 }); }}
              className="ml-2 inline-flex items-center gap-1 font-medium text-[var(--text-secondary)] hover:text-[var(--brand-accent)]">
              <BrandIcon name="restore" size={12} /><span>{T.undo}</span>
            </button>
          )}
        </p>
      </div>
      {showAdvanced && (
        <>
          <Slider id="slider-ca-red" label={T.red} help={T.redHelp} value={red} min={-100} calmView={calmView} onChange={(v) => onChange({ caRed: v })} />
          <Slider id="slider-ca-blue" label={T.blue} help={T.blueHelp} value={blue} min={-100} calmView={calmView} onChange={(v) => onChange({ caBlue: v })} />
        </>
      )}
      <Slider id="slider-defringe-purple" label={T.purple} help={T.purpleHelp} value={recipe.defringePurple ?? 0} min={0} calmView={calmView} onChange={(v) => onChange({ defringePurple: v })} />
      <Slider id="slider-defringe-green" label={T.green} help={T.greenHelp} value={recipe.defringeGreen ?? 0} min={0} calmView={calmView} onChange={(v) => onChange({ defringeGreen: v })} />
    </div>
  );
}

/** Lens corrections: a measured profile for the photo's lens (downloaded only when asked), then distortion and lens
 * vignetting by hand on top. */
export function LensControls({ recipe, calmView, onChange, onUseProfile }: { recipe: EditRecipe; calmView: boolean; onChange: (patch: Partial<EditRecipe>) => void; onUseProfile: (download: boolean) => Promise<LensProfileOutcome> }) {
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<LensProfileOutcome | null>(null);
  const profile = recipe.lensProfile ?? null;
  const run = async (download: boolean) => {
    setBusy(true);
    setOutcome(null);
    try { setOutcome(await onUseProfile(download)); } catch { setOutcome('failed'); } finally { setBusy(false); }
  };
  const buttonClass = 'min-h-8 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:border-[var(--brand-accent)] disabled:opacity-60';
  const message = outcome === 'no-lens' ? L.noLens : outcome === 'not-found' ? L.notFound : outcome === 'no-focal' ? L.noFocal : outcome === 'failed' ? L.failed : null;
  const notes = (profile?.notes ?? []).map((note) => (note === 'no-aperture' ? L.noteAperture : note === 'no-vignetting' ? L.noteVignetting : note === 'no-distortion' ? L.noteDistortion : L.noteSensor));
  return (
    <div className="space-y-3" data-testid="lens">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h4 className="text-xs font-medium text-[var(--text-primary)]">{L.heading}</h4>
          <InfoPopover title={L.heading} body={L.help} />
        </div>
        <button type="button" onClick={() => { setOutcome(null); onChange({ lensDistortion: 0, lensVignetting: 0, lensProfile: null }); }}
          className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]">
          <BrandIcon name="restore" size={12} /><span>{L.reset}</span>
        </button>
      </div>
      <div className="space-y-1.5" data-testid="lens-profile">
        {profile ? (
          <div className="space-y-1 text-[0.6875rem] leading-snug">
            <p className="text-[var(--text-primary)]">{L.using.replace('{lens}', profile.name)}</p>
            {notes.map((note) => <p key={note} className="text-[var(--text-muted)]">{note}</p>)}
            <button type="button" onClick={() => { setOutcome(null); onChange({ lensProfile: null }); }}
              className="inline-flex items-center gap-1 font-medium text-[var(--text-secondary)] hover:text-[var(--brand-accent)]">
              <BrandIcon name="restore" size={12} /><span>{L.removeProfile}</span>
            </button>
          </div>
        ) : outcome === 'needs-download' ? (
          <div className="space-y-1.5">
            <p className="text-[0.6875rem] leading-snug text-[var(--text-secondary)]">{L.downloadAsk}</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => run(true)} disabled={busy} className={buttonClass}>{busy ? L.downloading : L.download}</button>
              <button type="button" onClick={() => setOutcome(null)} disabled={busy}
                className="min-h-8 rounded-[var(--radius-sm)] px-2 text-[0.6875rem] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]">{L.notNow}</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => run(false)} disabled={busy} aria-describedby="lens-profile-status" className={buttonClass}>{busy ? L.finding : L.useProfile}</button>
            <InfoPopover title={L.useProfile} body={L.useProfileHelp} />
          </div>
        )}
        <p id="lens-profile-status" role="status" className="text-[0.6875rem] leading-snug text-[var(--text-muted)]">{profile ? null : message}</p>
      </div>
      <Slider id="slider-lens-distortion" label={L.distortion} help={L.distortionHelp} value={recipe.lensDistortion ?? 0} min={-100} calmView={calmView}
        leftHint={L.pincushion} rightHint={L.barrel} onChange={(v) => onChange({ lensDistortion: v })} />
      <Slider id="slider-lens-vignetting" label={L.vignetting} help={L.vignettingHelp} value={recipe.lensVignetting ?? 0} min={0} calmView={calmView}
        onChange={(v) => onChange({ lensVignetting: v })} />
    </div>
  );
}
