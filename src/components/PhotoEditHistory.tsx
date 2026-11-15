import { messages as m } from '../i18n/messages';
import type { PhotoFrame } from '../core/types';

const button = 'min-h-11 rounded-md px-3 text-sm hover:bg-white/8 disabled:opacity-45';

export function PhotoEditHistory({ frame, onHistoryStep }: { frame: PhotoFrame; onHistoryStep: (direction: -1 | 1) => void }) {
  return !frame.editHistory?.steps.length ? <p className="pb-2 text-sm text-zinc-400">{m.emptyHistory}</p> : (
            <>
              <div className="flex gap-2">
                <button type="button" className={button} disabled={!frame.editHistory.cursor} onClick={() => onHistoryStep(-1)}>{m.undo}</button>
                <button type="button" className={button} disabled={frame.editHistory.cursor >= frame.editHistory.steps.length}
                  onClick={() => onHistoryStep(1)}>{m.redo}</button>
              </div>
              <ol className="max-h-48 overflow-y-auto pb-2 text-sm">
                {frame.editHistory.steps.map((step, index) => <li key={index}
                  aria-current={index === frame.editHistory!.cursor - 1 ? 'step' : undefined}
                  className={`rounded px-2 py-1 ${index >= frame.editHistory!.cursor ? 'text-zinc-500' : 'text-zinc-200'} aria-[current=step]:bg-white/10`}>
                  {m.historyStep[step.kind]}
                </li>)}
              </ol>
            </>
          );
}
