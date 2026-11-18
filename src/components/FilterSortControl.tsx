import { useEffect, useRef, useState } from 'react';
import { ListFilter, Search } from 'lucide-react';
import type { TagFilterOption } from '../core/cullingEngine';
import type { RatingFilter, SortOrder } from '../core/types';
import { RatingFilterControl } from './RatingFilterControl';

interface Props {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  ratingFilter: RatingFilter | null;
  onRatingFilterChange: (filter: RatingFilter | null) => void;
  cameraFilter: string | null;
  onCameraFilterChange: (camera: string | null) => void;
  lensFilter: string | null;
  onLensFilterChange: (lens: string | null) => void;
  tagFilter?: string[];
  onTagFilterChange?: (tags: string[]) => void;
  tagOptions?: TagFilterOption[];
  cameraOptions: string[];
  lensOptions: string[];
  sortOrder: SortOrder | undefined;
  onSortOrderChange: (order: SortOrder | undefined) => void;
  className?: string;
}

const sortLabels: Record<'default' | SortOrder, string> = {
  default: 'Date (as imported)',
  'captured-desc': 'Date, newest first',
  'captured-asc': 'Date, oldest first',
  'rating-desc': 'Rating, high to low',
  'name-asc': 'Name, A to Z',
  'confidence-desc': 'Culling confidence, high to low',
};

const field = 'mt-1 min-h-10 w-full rounded-md border border-white/10 bg-black/20 px-2 text-sm text-zinc-100';

/** One tidy place for search, rating, camera, lens and tag/species filters - replacing what used to be scattered across the
 * workspace menu and the collections bar. Sort lives next to it as its own control, since it isn't a filter. */
export function FilterSortControl(props: Props) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedTags = props.tagFilter ?? [];
  const activeCount =
    (props.searchQuery.trim() ? 1 : 0) +
    (props.ratingFilter ? 1 : 0) +
    (props.cameraFilter ? 1 : 0) +
    (props.lensFilter ? 1 : 0) +
    (selectedTags.length > 0 ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !popoverRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const clearAll = () => {
    props.onSearchChange('');
    props.onRatingFilterChange(null);
    props.onCameraFilterChange(null);
    props.onLensFilterChange(null);
    props.onTagFilterChange?.([]);
  };

  const toggleTag = (tag: string) => {
    if (!props.onTagFilterChange) return;
    const lower = tag.toLowerCase();
    const exists = selectedTags.some((t) => t.toLowerCase() === lower);
    if (exists) {
      props.onTagFilterChange(selectedTags.filter((t) => t.toLowerCase() !== lower));
    } else {
      props.onTagFilterChange([...selectedTags, tag]);
    }
  };

  return (
    <div className={`flex min-w-0 items-center gap-2 ${props.className ?? ''}`}>
      <div className="relative">
        <button ref={triggerRef} type="button" aria-expanded={open} aria-controls="filter-popover"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 aria-expanded:border-sky-300/60">
          <ListFilter className="h-4 w-4" aria-hidden="true" />Filter
          {activeCount > 0 && <span aria-hidden="true" className="min-w-4 rounded-sm bg-kestrel-copper px-1 text-center text-xs font-semibold text-zinc-950">{activeCount}</span>}
        </button>
        <span className="sr-only" role="status">{activeCount > 0 ? `${activeCount} filter${activeCount === 1 ? '' : 's'} active` : 'No filters active'}</span>
        {open && (
          <div ref={popoverRef} id="filter-popover" role="group" aria-label="Filter photos"
            className="absolute right-0 max-md:left-0 max-md:right-auto top-full z-40 mt-1 max-h-[75dvh] w-[min(21rem,calc(100vw-2.5rem))] space-y-3 overflow-y-auto rounded-xl border border-white/12 bg-kestrel-raised p-3 shadow-2xl">
            <label className="block text-xs font-medium text-zinc-400">
              Search
              <span className="relative mt-1 block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input type="search" value={props.searchQuery} onChange={(event) => props.onSearchChange(event.target.value)}
                  placeholder="Subject name or filename" className={`${field} pl-8`} />
              </span>
            </label>
            <div className="text-xs font-medium text-zinc-400">
              Rating
              <RatingFilterControl value={props.ratingFilter} onChange={props.onRatingFilterChange} className="mt-1 w-full" />
            </div>
            {(props.tagOptions?.length ?? 0) > 0 && props.onTagFilterChange && (
              <fieldset className="space-y-1 text-xs font-medium text-zinc-400">
                <legend>Tags &amp; species</legend>
                <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-md border border-white/10 bg-black/20 p-1.5">
                  {props.tagOptions!.map(({ tag, count }) => {
                    const checked = selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
                    return (
                      <label key={tag} className="flex min-h-8 cursor-pointer items-center justify-between gap-2 rounded px-1.5 text-sm font-normal text-zinc-200 hover:bg-white/8">
                        <span className="flex min-w-0 items-center gap-2">
                          <input type="checkbox" checked={checked} onChange={() => toggleTag(tag)} />
                          <span className="truncate">{tag}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-xs text-zinc-400">{count}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {props.cameraOptions.length > 1 && (
              <label className="block text-xs font-medium text-zinc-400">
                Camera
                <select aria-label="Filter by camera" value={props.cameraFilter ?? ''} className={field}
                  onChange={(event) => props.onCameraFilterChange(event.target.value || null)}>
                  <option value="">All cameras</option>
                  {props.cameraOptions.map((camera) => <option key={camera} value={camera}>{camera}</option>)}
                </select>
              </label>
            )}
            {props.lensOptions.length > 1 && (
              <label className="block text-xs font-medium text-zinc-400">
                Lens
                <select aria-label="Filter by lens" value={props.lensFilter ?? ''} className={field}
                  onChange={(event) => props.onLensFilterChange(event.target.value || null)}>
                  <option value="">All lenses</option>
                  {props.lensOptions.map((lens) => <option key={lens} value={lens}>{lens}</option>)}
                </select>
              </label>
            )}
            <button type="button" disabled={activeCount === 0} onClick={clearAll}
              className="min-h-9 w-full rounded-md border border-white/10 text-sm text-zinc-300 hover:bg-white/8 disabled:opacity-40">
              Clear filters
            </button>
          </div>
        )}
      </div>
      <label className="text-xs font-medium text-zinc-400">
        <span className="sr-only">Sort</span>
        <select aria-label="Sort photos" value={props.sortOrder ?? 'default'}
          onChange={(event) => props.onSortOrderChange(event.target.value === 'default' ? undefined : event.target.value as SortOrder)}
          className="min-h-10 rounded-md border border-white/10 bg-black/20 px-2 text-sm text-zinc-100">
          {Object.entries(sortLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}
