/**
 * InFlight's own online helper (managed Gemini) is invite-only: a licence that includes it (`managedAi`) AND the
 * server's "Online photo helper" switch on. Owner, 27 Nov 2026: "If it's not added we shouldn't need the disable
 * button." So the app shows the helper's switch (Settings › Account) and its choice (Settings › AI providers) only when
 * the server says it is available for this account, and only while online. Otherwise nothing is shown: no greyed-out
 * switch, no "invited testers only" line.
 *
 * Pure rules only; the answer comes from GET /v1/me/entitlements (`onlineHelper`), which the app already reads.
 */

export type OnlineHelperAccess = 'available' | 'unavailable';

/** Only an explicit "available" from the server counts. Missing, malformed or an older server: unavailable. */
export function onlineHelperFromEntitlements(data: unknown): OnlineHelperAccess {
  return data !== null && typeof data === 'object' && (data as { onlineHelper?: unknown }).onlineHelper === 'available' ? 'available' : 'unavailable';
}

/** Shown only when the server said available and the device is online now. Not known yet (null): hidden. */
export function showOnlineHelper(access: OnlineHelperAccess | null | undefined, online: boolean): boolean {
  return online && access === 'available';
}

/** The AI provider choices to offer: InFlight's own helper only while it is shown. */
export function offeredProviderKinds<K extends string>(kinds: readonly K[], helperShown: boolean, helperKind: K): K[] {
  return kinds.filter((kind) => kind !== helperKind || helperShown);
}

/**
 * A saved provider choice that may be used now. A saved "InFlight's online helper" while it is hidden (not invited,
 * switched off, offline) is treated as not set up, so nothing is sent; the saved choice itself is kept and comes back
 * if access returns.
 */
export function usableProviderSettings<S extends { kind: string }>(saved: S | null, helperShown: boolean, helperKind: string): S | null {
  if (!saved) return null;
  return saved.kind === helperKind && !helperShown ? null : saved;
}
