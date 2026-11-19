import { useState } from 'react';
import { Bird, Check, Mountain, Plus, Tag, UserRound, X } from 'lucide-react';
import { STARTER_TAGS, SUBJECT_KINDS, addTags, parseTagInput, removeTag, type SubjectKind } from '../core/subjectTags';

const ICONS: Record<SubjectKind, typeof Bird> = { wildlife: Bird, people: UserRound, landscape: Mountain, other: Tag };

interface Props {
  kind: SubjectKind | undefined;
  tags: string[];
  /** Tags the app added by itself and the user has not kept yet. They are marked, and can be kept or removed. */
  autoTags?: string[];
  disabled?: boolean;
  onKeep?: (tag: string) => void;
  onChange: (tags: string[], kind: SubjectKind | undefined) => void;
}

/**
 * What a photo is of, in the user's own words. Choose a kind, then add tags by typing or tapping a quick word.
 * Tags stay on this device and make photos easy to find from the search boxes.
 */
export function SubjectPanel({ kind, tags, autoTags = [], disabled, onKeep, onChange }: Props) {
  const [text, setText] = useState('');
  const add = (incoming: string[]) => {
    const next = addTags(tags, incoming);
    if (next.length !== tags.length) onChange(next, kind);
  };
  const quick = kind ? STARTER_TAGS[kind].filter((word) => !tags.some((tag) => tag.toLowerCase() === word.toLowerCase())) : [];
  return (
    <section aria-label="What is in this photo" className="@container space-y-2 px-1 pb-2">
      <h3 className="text-sm font-medium text-zinc-100">What is this a photo of?</h3>
      {/* Four across when the panel has room for the words, two by two when it is narrow: labels are never cut off. */}
      <div role="group" aria-label="Kind of photo" className="grid grid-cols-2 gap-1 @[19rem]:grid-cols-4">
        {SUBJECT_KINDS.map((entry) => {
          const Icon = ICONS[entry.id];
          return (
            <button key={entry.id} type="button" disabled={disabled} aria-pressed={kind === entry.id} title={entry.hint}
              onClick={() => onChange(tags, kind === entry.id ? undefined : entry.id)}
              className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border border-white/10 px-1 text-center text-xs leading-tight text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-45 aria-pressed:border-sky-300 aria-pressed:bg-sky-300/15">
              <Icon className="h-5 w-5" aria-hidden="true" />{entry.label}
            </button>
          );
        })}
      </div>
      {tags.length > 0 && (
        <ul aria-label="Tags" className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <li key={tag} className={`inline-flex items-center rounded-full pl-3 text-sm text-zinc-100 ${autoTags.some((entry) => entry.toLowerCase() === tag.toLowerCase()) ? 'border border-dashed border-sky-300/60 bg-sky-300/10' : 'bg-white/10'}`}>
              {tag}
              {autoTags.some((entry) => entry.toLowerCase() === tag.toLowerCase()) && (
                <>
                  <span className="ml-1.5 rounded bg-sky-300/20 px-1.5 text-[11px] font-medium uppercase tracking-wide text-sky-100" title="Added automatically because the model was sure. Keep it or remove it.">Auto</span>
                  <button type="button" disabled={disabled} aria-label={`Keep tag ${tag}`} title={`Keep ${tag}`} onClick={() => onKeep?.(tag)}
                    className="grid h-9 w-9 place-items-center rounded-full text-emerald-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><Check className="h-3.5 w-3.5" aria-hidden="true" /></button>
                </>
              )}
              <button type="button" disabled={disabled} aria-label={`Remove tag ${tag}`} title={`Remove ${tag}`} onClick={() => onChange(removeTag(tags, tag), kind)}
                className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); add(parseTagInput(text)); setText(''); }}>
        <label className="sr-only" htmlFor="photo-tag-input">Add a tag</label>
        <input id="photo-tag-input" type="text" value={text} disabled={disabled} maxLength={80} enterKeyHint="done"
          placeholder={kind === 'wildlife' ? 'e.g. Red Kite' : kind === 'landscape' ? 'e.g. Glen Coe' : kind === 'people' ? 'e.g. Sam' : 'Add a tag'}
          onChange={(event) => setText(event.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-white/15 bg-black/20 px-2 text-base lg:text-sm" />
        <button type="submit" disabled={disabled || !parseTagInput(text).length} aria-label="Add tag" title="Add tag"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-white/15 hover:bg-white/10 disabled:opacity-45"><Plus className="h-4 w-4" aria-hidden="true" /></button>
      </form>
      {quick.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Quick tags">
          {quick.map((word) => (
            <button key={word} type="button" disabled={disabled} onClick={() => add([word])}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-white/12 px-2.5 text-xs text-zinc-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
              <Plus className="h-3 w-3" aria-hidden="true" />{word}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-zinc-400">{kind ? 'Tags stay on this device and make photos easy to find in the search box.' : 'Pick a kind to see quick tags. Tags make photos easy to find later.'}</p>
    </section>
  );
}
