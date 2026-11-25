import { createElement, lazy, type ComponentType, type ReactElement } from 'react';

/** A part of the interface whose code loads on demand. Until its code has arrived it renders through React.lazy (so
 * the nearest Suspense boundary waits for it); once it has arrived, by `preload()` or a first render, it renders the
 * component directly. React.lazy alone suspends for one tick on every first render, even when the code is already
 * downloaded, which hid the editor for a moment whenever a layout change showed a part for the first time. */
export type LazyPart<P extends object> = ((props: P) => ReactElement) & { preload: () => Promise<unknown>; isReady: () => boolean };

export function lazyPart<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): LazyPart<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const fetch = () => {
    pending ??= load().then((module) => { loaded = module.default; return module; }, (reason) => { pending = null; throw reason; });
    return pending;
  };
  const Lazy = lazy(fetch);
  function Part(props: P): ReactElement {
    return loaded ? createElement(loaded, props) : createElement(Lazy as unknown as ComponentType<P>, props);
  }
  return Object.assign(Part, { preload: fetch, isReady: () => loaded !== null });
}
