import { useEffect, useRef } from 'react';

/**
 * Lets the system Back (the iOS edge swipe, the Android back button, a browser's Back) close a dialog instead of doing
 * nothing or leaving the screen behind it. Opening adds one history entry; Back removes it and closes the dialog; closing
 * the dialog any other way takes its entry away again, so Back afterwards behaves as it did before.
 */
export function useBackToClose(onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (typeof history === 'undefined') return;
    const marker = { kestrelDialog: Math.random() };
    history.pushState(marker, '');
    let closedByBack = false;
    const onPop = () => { closedByBack = true; close.current(); };
    window.addEventListener('popstate', onPop, { once: true });
    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed by a button or Escape: drop the entry this dialog added (only if it is still the current one).
      if (!closedByBack && history.state === marker) history.back();
    };
  }, []);
}
