import type { AiProviderConfig } from '../ui/contract';

/**
 * Real V2 must never claim a sample provider is connected. The current BYO AI
 * buttons change only src/v2/ui/stub.ts; no credential is verified or attached
 * to the actual provider. Keep them visible for discoverability but unavailable
 * until a real connection flow exists.
 */
export function aiProviderControl(provider: AiProviderConfig, realWorkspace: boolean) {
  const local = provider.id === 'local';
  return {
    connected: realWorkspace ? local : provider.connected,
    disabled: realWorkspace || local,
    buttonText: local
      ? 'Built-in'
      : realWorkspace
        ? 'Unavailable'
        : provider.connected
          ? 'Disconnect'
          : 'Connect',
    modelLabel: realWorkspace && !local ? 'Not connected in this workspace' : provider.modelLabel,
  };
}

/**
 * A saved number alone is not a cache limit: real V2 does not enforce
 * localCacheLimitGb and parseSavedUi intentionally drops it on reload.
 */
export function cacheCapControl(realWorkspace: boolean) {
  return {
    disabled: realWorkspace,
    description: realWorkspace
      ? 'A storage cap is not yet enforced in V2. This setting is unavailable until it controls the actual cache.'
      : '',
  };
}
