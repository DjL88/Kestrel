import React from 'react';
import { STORAGE_PLANS, TOP_UP_PENCE, formatBytes, formatPence, photosThatFit, storageFull, usageSummary, type CloudUsage, type UsageMeter } from '../../../core/cloudPlan';
import { STRINGS } from '../strings';

/**
 * Settings → Account: this month's cloud allowances, what is charged beyond them and the cloud balance.
 * Display only: the control plane meters and authorises every cloud request. Local editing never uses any of this.
 */
export default function CloudUsagePanel({ usage, onTopUp, topUpBusy = false, topUpNote = null, consent }: {
  usage: CloudUsage;
  /** Starts a Paddle checkout for a prepaid top-up (useCloudTopUp). Absent: top-ups are not open on this build. */
  onTopUp?: (pence: number) => void;
  topUpBusy?: boolean;
  topUpNote?: { text: string; good: boolean } | null;
  /** The visible off switch for cloud edits on this device. Absent: not offered on this build. */
  consent?: { read: () => 'unasked' | 'yes' | 'no'; set: (answer: 'yes' | 'no') => 'unasked' | 'yes' | 'no' };
}) {
  const words = STRINGS.cloudUsage;
  const summary = usageSummary(usage);
  const [answer, setAnswer] = React.useState(() => consent?.read() ?? 'unasked');
  const resets = new Date(summary.resetsAtMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const label: Record<UsageMeter['id'], string> = { photos: words.photos, storage: words.storage, downloads: words.downloads };
  const amount = (m: UsageMeter) => m.id === 'photos'
    ? words.used(m.used.toLocaleString(), m.included.toLocaleString())
    : m.included === 0 ? formatBytes(m.used) : words.used(formatBytes(m.used), formatBytes(m.included));
  const holds = (bytes: number) => {
    const fit = photosThatFit(bytes);
    return words.storageHolds(formatBytes(bytes), fit.previews.toLocaleString(), fit.withRawOriginals.toLocaleString(), fit.withJpegOriginals.toLocaleString());
  };

  return (
    <section aria-labelledby="cloud-usage-title" data-testid="v2-cloud-usage" className="space-y-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="cloud-usage-title" className="text-sm font-semibold text-[var(--text-primary)]">{words.title}</h3>
        <span className="text-xs text-[var(--text-secondary)]">{words.resets(resets)}</span>
      </div>
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{words.intro}</p>
      {consent && (
        <label data-testid="cloud-consent-switch" className="flex min-h-9 cursor-pointer items-start gap-2 text-xs text-[var(--text-primary)]">
          <input type="checkbox" role="switch" checked={answer === 'yes'} onChange={(event) => setAnswer(consent.set(event.target.checked ? 'yes' : 'no'))} className="mt-0.5 h-4 w-4" />
          <span><span className="font-medium">{words.cloudSwitch}</span> <span className="text-[var(--text-secondary)]">{words.cloudSwitchBody}</span></span>
        </label>
      )}
      <ul className="space-y-3">
        {summary.meters.map((m) => (
          <li key={m.id} data-testid={`cloud-meter-${m.id}`} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-[var(--text-primary)]">{label[m.id]}</span>
              <span className="font-mono tabular-nums text-[var(--text-secondary)]">{amount(m)}{m.included > 0 && ` · ${m.percent}%`}</span>
            </div>
            {m.included > 0
              ? <progress aria-label={`${label[m.id]}: ${amount(m)}`} max={100} value={m.percent} className="block h-2 w-full" />
              : <p className="text-xs text-[var(--text-secondary)]">{words.storageNoneIncluded}</p>}
            {m.id === 'storage' && m.included > 0 && <p data-testid="cloud-storage-holds" className="text-xs text-[var(--text-muted)]">{holds(m.included)}</p>}
            {m.chargePence > 0 && <p className="text-xs text-[var(--text-secondary)]">{words.extra(formatPence(Math.ceil(m.chargePence)))}</p>}
            {m.id === 'storage' && storageFull(usage) && <p role="status" data-testid="cloud-storage-full" className="text-xs font-medium text-[var(--text-primary)]">{words.storageFull}</p>}
          </li>
        ))}
      </ul>
      <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
        <p className="text-xs font-medium text-[var(--text-primary)]">{words.balance(formatPence(usage.balancePence))}</p>
        {summary.paused && <p role="status" className="text-xs text-[var(--text-primary)]">{words.paused}</p>}
        <div className="flex flex-wrap gap-2">
          {TOP_UP_PENCE.map((pence) => (
            <button
              key={pence}
              type="button"
              disabled={!onTopUp || topUpBusy}
              onClick={() => onTopUp?.(pence)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {words.topUp(formatPence(pence))}
            </button>
          ))}
        </div>
        {!onTopUp && <p className="text-xs text-[var(--text-muted)]">{words.topUpSoon}</p>}
        {topUpNote && <p role={topUpNote.good ? 'status' : 'alert'} data-testid="cloud-top-up-note" className="break-all text-xs text-[var(--text-primary)]">{topUpNote.text}</p>}
        {STORAGE_PLANS.filter((p) => !p.available).map((p) => (
          <p key={p.id} data-testid="cloud-storage-plan" className="text-xs text-[var(--text-muted)]">{words.storagePlanSoon(formatBytes(p.bytes), formatPence(p.monthlyPence))} {holds(p.bytes)}</p>
        ))}
        <p className="text-xs text-[var(--text-muted)]">{words.ownStorage}</p>
      </div>
    </section>
  );
}
