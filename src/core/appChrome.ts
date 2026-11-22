/**
 * InFlight is an app, not a web page, so the browser's own right-click menu (Open Image in New Window, Download Image,
 * Inspect Element) is never shown. The one exception is text a person is typing, where Cut, Copy and Paste are useful.
 * The app's own menus (photo menu, info menu) still open: they handle the event first.
 */
export function keepsNativeMenu(target: { tagName?: string; isContentEditable?: boolean; type?: string } | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return !['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'image', 'color'].includes((target.type ?? 'text').toLowerCase());
}
