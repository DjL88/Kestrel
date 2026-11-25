import { useState } from 'react';
import { SPECIES_REGIONS, readSpeciesRegions, writeSpeciesRegions } from '../../../core/speciesRegions';
import { regionWords, speciesAreaText as t } from '../../../i18n/areas/speciesArea';

/**
 * Settings → Assistance: the home region species names are matched against, for every project that has not chosen
 * its own place ("Where were these taken?" in the photo's Info).
 */
export default function HomeRegionSetting() {
  const [home, setHome] = useState(() => readSpeciesRegions()[0]);
  return (
    <section aria-labelledby="home-region-title" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
      <label id="home-region-title" htmlFor="home-region" className="block text-xs font-semibold text-[var(--text-primary)]">{t.homeSetting}</label>
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{t.homeSettingHint}</p>
      <select id="home-region" value={home} onChange={(event) => { setHome(event.target.value); writeSpeciesRegions([event.target.value]); }}
        className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-panel,var(--bg-input))] px-2 py-1.5 text-xs text-[var(--text-primary)]">
        {SPECIES_REGIONS.map((region) => <option key={region.id} value={region.id}>{regionWords([region.id])}</option>)}
      </select>
    </section>
  );
}
