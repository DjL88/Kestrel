import { useState, useTransition } from 'react';

/**
 * A slider that never waits for the editor. Each step shows on the slider at once (a small render of the slider alone),
 * and the edit itself reaches the rest of the workspace as a React transition, which React works through in small pieces
 * and drops when a newer step overtakes it. So dragging stays smooth however much the workspace has to redraw, and the
 * value saved is always the last one the person chose.
 *
 * Until the workspace has caught up, the slider shows the value it was moved to; after that, the workspace's value again
 * (so a reset or an undo elsewhere still moves it).
 */
export function useSliderValue(value: number, onChange: (value: number) => void): [number, (value: number) => void] {
  const [pending, startTransition] = useTransition();
  const [held, setHeld] = useState(value);
  const change = (next: number) => {
    setHeld(next);
    startTransition(() => onChange(next));
  };
  return [pending ? held : value, change];
}
