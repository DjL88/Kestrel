/** The OS/browser link hint is not a probe of the internet or any service. */
export type LinkState = 'offline' | 'unverified';
export function linkState(online: boolean | undefined): LinkState {
  return online === false ? 'offline' : 'unverified';
}
export function remoteActionsAllowed(state: LinkState): boolean {
  return state !== 'offline';
}
