import { BRAND_ICON_PATHS, type BrandIconId } from '../core/brandIcons';

/** A service's mark in the current text colour. It is decoration: the service's name is always written beside it. */
export function BrandIcon({ id, className = 'h-4 w-4' }: { id: BrandIconId; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d={BRAND_ICON_PATHS[id]} />
    </svg>
  );
}

/** "Works with" row: each name with its mark, so a person can tell at a glance their own NAS or storage is covered. */
export function WorksWith({ items }: { items: readonly { id?: BrandIconId; name: string }[] }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-300" aria-label="Works with">
      {items.map((item) => <li key={item.name} className="inline-flex items-center gap-1.5">{item.id && <BrandIcon id={item.id} className="h-3.5 w-3.5" />}{item.name}</li>)}
    </ul>
  );
}
