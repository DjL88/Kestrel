/**
 * Where a phone notice sits: just above whatever occupies the bottom of the screen (the filmstrip, the tool bar, an
 * open tool sheet), so it never covers a thumbnail or a control the person is using. The notice stays where it was
 * meant to be on desktop; this is the phone placement only.
 *
 * @param viewportHeight the visible height of the window (innerHeight)
 * @param tops the top edges of the visible bottom elements, in viewport pixels; hidden ones are left out
 * @param gap space between the notice and the element below it
 * @param minimum the inset when nothing is measured (the tool bar's usual height plus the gap)
 * @returns the CSS `bottom` inset, in pixels
 */
export function phoneNoticeBottom(viewportHeight: number, tops: readonly number[], gap = 8, minimum = 80): number {
  const visible = tops.filter((top) => Number.isFinite(top) && top > 0 && top < viewportHeight);
  if (!visible.length) return minimum;
  return Math.max(minimum, Math.round(viewportHeight - Math.min(...visible) + gap));
}
