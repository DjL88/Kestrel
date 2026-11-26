import React, { useEffect, useId, useMemo, useState } from 'react';
import { searchSpecies, type SpeciesHit } from '../../../core/speciesSearch';
import { loadSpeciesSearchData, type SpeciesSearchData } from '../../../providers/speciesSearchData';

interface SpeciesNameFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}

/**
 * The species name box with suggestions: English and scientific names, and four-letter banding codes (type AMRO for
 * American Robin). Choosing a suggestion fills in the English name; the person still presses Save, and any typed name
 * is still accepted. Arrow keys move through the list, Enter picks, Escape closes it.
 */
export default function SpeciesNameField({ value, onChange, label, className }: SpeciesNameFieldProps) {
  const listId = useId();
  const [data, setData] = useState<SpeciesSearchData | null>(null);
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    let live = true;
    void loadSpeciesSearchData().then((loaded) => { if (live) setData(loaded); });
    return () => { live = false; };
  }, []);

  const hits: SpeciesHit[] = useMemo(() => (data ? searchSpecies(value, data.entries, data.codes) : []), [data, value]);
  const showing = open && hits.length > 0 && !(hits.length === 1 && hits[0].common === value);

  const pick = (hit: SpeciesHit) => {
    onChange(hit.common);
    setOpen(false);
    setActive(-1);
  };

  return (
    <span className="relative min-w-0 max-w-40">
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={listId}
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        autoFocus
        maxLength={120}
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={(event) => {
          if (!showing) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setActive((at) => (at + 1) % hits.length); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); setActive((at) => (at <= 0 ? hits.length - 1 : at - 1)); }
          else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); event.stopPropagation(); pick(hits[active]); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        }}
        className={className}
      />
      {showing && (
        <ul id={listId} role="listbox" aria-label={label} data-testid="species-suggestions"
          className="absolute right-0 z-20 mt-1 max-h-60 w-64 overflow-auto rounded border border-[var(--border-default)] bg-[var(--bg-elevated,var(--bg-input))] py-1 text-left shadow-lg">
          {hits.map((hit, index) => (
            <li key={hit.scientific} id={`${listId}-${index}`} role="option" aria-selected={index === active}
              onMouseDown={(event) => { event.preventDefault(); pick(hit); }}
              className={`cursor-pointer px-2 py-1 ${index === active ? 'bg-[var(--bg-hover,var(--border-subtle))] underline' : ''}`}>
              <span className="block text-[var(--text-primary)]">
                {hit.common}
                {hit.code && <span className="font-mono text-[var(--text-secondary)]">{` · ${hit.code}`}</span>}
              </span>
              {hit.common !== hit.scientific && <span className="block italic text-[var(--text-secondary)]">{hit.scientific}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
