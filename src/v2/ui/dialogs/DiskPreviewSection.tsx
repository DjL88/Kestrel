import { useEffect, useState } from 'react';
import { welcomeText } from '../../../i18n/areas/welcome';
import {
  DISK_PREVIEW_LIMIT_CHOICES_GB, defaultDiskPreviewLimitGB, formatPreviewBytes, parseDiskPreviewLimitGB, photosThatFit,
} from '../../../core/diskPreviewLimit';
import { deviceMemoryBudget } from '../../../providers/deviceBudget';
import {
  currentDiskPreviewLimitBytes, diskPreviewStore, saveDiskPreviewLimit, storedDiskPreviewLimit, type DiskPreviewUsage,
} from '../../../providers/diskPreviewCache';

/**
 * Settings → Storage, desktop app only (x-std-disk-previews): how much the preview folder on disk holds, its size
 * limit (suggested from this computer's memory tier, changeable here), and a way to remove every preview. Removing
 * previews never touches originals, projects or edits.
 */
export default function DiskPreviewSection() {
  if (!diskPreviewStore()) return null;
  return <DiskPreviews />;
}

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));

function DiskPreviews() {
  const t = welcomeText.diskPreviews;
  const store = diskPreviewStore()!;
  const suggested = defaultDiskPreviewLimitGB(deviceMemoryBudget());
  const [chosen, setChosen] = useState<number | undefined>(() => parseDiskPreviewLimitGB(storedDiskPreviewLimit()));
  const [usage, setUsage] = useState<DiskPreviewUsage | 'checking' | 'failed'>('checking');
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Reading the usage with the limit also holds the folder to it, so a smaller limit takes effect at once.
    store.usage(currentDiskPreviewLimitBytes()).then((next) => { if (mounted) setUsage(next); }, () => { if (mounted) setUsage('failed'); });
    return () => { mounted = false; };
  }, [store, chosen]);

  const limitGB = chosen ?? suggested;
  const choices = [...new Set([...DISK_PREVIEW_LIMIT_CHOICES_GB, suggested, limitGB])].sort((a, b) => a - b);

  const choose = (value: number) => {
    const next = value === suggested ? undefined : value;
    saveDiskPreviewLimit(next ?? null);
    setCleared(false);
    setChosen(next);
  };

  const clearAll = async () => {
    try {
      setUsage(await store.clear());
      setCleared(true);
    } catch {
      setUsage('failed');
    }
  };

  const status = usage === 'checking' ? t.checking : usage === 'failed' ? t.failed
    : fill(t.using, { used: formatPreviewBytes(usage.bytes), count: usage.entries });

  return (
    <section aria-labelledby="v2-disk-previews-title" data-testid="v2-disk-previews"
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
      <h3 id="v2-disk-previews-title" className="text-xs font-semibold text-[var(--text-primary)]">{t.title}</h3>
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{t.intro}</p>
      <p role="status" aria-live="polite" className="text-xs text-[var(--text-secondary)]">{cleared ? t.cleared : status}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-[var(--text-primary)]">{t.limitLabel}</span>
        <select value={limitGB} data-testid="v2-disk-preview-limit" aria-describedby="v2-disk-previews-hint"
          onChange={(event) => choose(Number(event.target.value))}
          className="block min-h-11 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
          {choices.map((gb) => (
            <option key={gb} value={gb}>{gb === suggested ? fill(t.limitDefault, { size: `${gb} GB` }) : `${gb} GB`}</option>
          ))}
        </select>
      </label>
      <p id="v2-disk-previews-hint" className="text-xs leading-relaxed text-[var(--text-secondary)]">
        {fill(t.limitHint, { count: photosThatFit(limitGB * 1024 ** 3).toLocaleString() })}
      </p>
      <button type="button" onClick={() => void clearAll()}
        className="min-h-11 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
        {t.clear}
      </button>
    </section>
  );
}
