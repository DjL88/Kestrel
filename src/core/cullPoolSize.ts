/**
 * How many background workers look at photos for culling (x-std-parallel-preflight).
 *
 * Every logical core but one, so the interface thread always keeps a core of its own. Phones and tablets stop at 4,
 * because each worker holds its own copy of the subject detector. Desktops stop at 8 for the same reason until the
 * shared memory budget decides from the machine's RAM. Unknown or odd core counts count as 2 (one worker).
 */
export const CULL_POOL_LIMITS = { phone: 4, desktop: 8 } as const;

export function cullPoolSize(cores: number | undefined, phone: boolean): number {
  const known = typeof cores === 'number' && Number.isFinite(cores) && cores >= 1 ? Math.floor(cores) : 2;
  return Math.max(1, Math.min(phone ? CULL_POOL_LIMITS.phone : CULL_POOL_LIMITS.desktop, known - 1));
}

/** Phones and tablets, by the same user-agent test the app shell uses (src/providers/desktopShell.ts). */
export function looksLikePhone(userAgent: string | undefined): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent ?? '');
}
