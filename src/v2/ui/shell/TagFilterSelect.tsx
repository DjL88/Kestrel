import { photoTagsText } from '../../../i18n/areas/photoTags';
import type { TagFacet } from '../../../core/photoTags';
import type { Photo } from '../contract';
import { tagChoices } from '../utils/studioMath';

/**
 * Show only photos with one tag InFlight found (golden hour, fog, birds, a place). Lists only tags some photo in the
 * project has, grouped by kind, with how many photos have each. Hidden when no photo has a tag yet.
 */
export function TagFilterSelect({ photos, value, onChange }: { photos: readonly Photo[]; value: string | null; onChange: (id: string | null) => void }) {
  const groups = tagChoices(photos);
  if (!groups.length && !value) return null;
  const t = photoTagsText;
  return (
    <label className="flex items-center gap-1 text-[0.6875rem] text-[var(--text-secondary)]">
      <span>{t.filterLabel}</span>
      <select
        aria-label={t.filterLabel}
        data-testid="tag-filter"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-8 max-w-[11rem] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-1 text-xs text-[var(--text-primary)]"
      >
        <option value="">{t.allTags}</option>
        {groups.map((group) => (
          <optgroup key={group.facet} label={(t.facets as Record<TagFacet, string>)[group.facet]}>
            {group.tags.map((tag) => <option key={tag.id} value={tag.id}>{`${tag.label} (${tag.count})`}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
