/**
 * A task's elapsed or remaining time as people say it: "45 s", "27 min 5 s", "10 h 27 min". Never "627m": a long
 * import reads in hours and minutes. Under an hour the seconds stay, so a short task visibly counts.
 */
export function taskDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(ms) ? ms / 1000 : 0));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
