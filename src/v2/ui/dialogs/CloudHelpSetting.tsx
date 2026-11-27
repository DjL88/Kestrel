import { useState } from 'react';
import type { CloudHelpChoice } from '../../../core/cloudHelp';
import { readCloudHelp, saveCloudHelp } from '../../../providers/cloudHelpSettings';
import { engineText } from '../../../i18n/areas/engine';

/** Settings → Account: when the cloud may take a Denoise job (cloud helps a busy device). Kept on this device only. */
export default function CloudHelpSetting() {
  const [choice, setChoice] = useState<CloudHelpChoice>(() => readCloudHelp().denoise);
  const t = engineText.cloudHelp;
  const options: { value: CloudHelpChoice; label: string }[] = [
    { value: 'off', label: t.off }, { value: 'when-busy', label: t.whenBusy }, { value: 'always', label: t.always },
  ];
  return (
    <section aria-labelledby="cloud-help-title" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
      <label id="cloud-help-title" htmlFor="cloud-help-denoise" className="block text-xs font-semibold text-[var(--text-primary)]">{t.title}</label>
      <p id="cloud-help-hint" className="text-xs leading-relaxed text-[var(--text-secondary)]">{t.hint}</p>
      <select id="cloud-help-denoise" aria-describedby="cloud-help-hint" value={choice}
        onChange={(event) => setChoice(saveCloudHelp('denoise', event.target.value as CloudHelpChoice))}
        className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-panel,var(--bg-input))] px-2 py-1.5 text-xs text-[var(--text-primary)]">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </section>
  );
}
