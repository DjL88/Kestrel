import { useSyncExternalStore } from 'react';
import { AI_PROVIDER_KINDS, DEFAULT_AI_MODEL, type AiProviderSettings } from './aiProviders';

/** On this device only. Never included in a project backup or sync. */
const KEY = 'kestrel.ai.v1';

export function readAiSettings(): AiProviderSettings | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AiProviderSettings> | null;
    if (!raw || typeof raw !== 'object' || !AI_PROVIDER_KINDS.includes(raw.kind as never)) return null;
    return {
      kind: raw.kind!,
      key: typeof raw.key === 'string' ? raw.key : '',
      model: typeof raw.model === 'string' ? raw.model : DEFAULT_AI_MODEL[raw.kind!],
      ...(typeof raw.baseUrl === 'string' ? { baseUrl: raw.baseUrl } : {}),
      consent: typeof raw.consent === 'string' ? raw.consent : null,
    };
  } catch { return null; }
}

export function saveAiSettings(settings: AiProviderSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* kept for this visit only */ }
  notify();
}

/** Removes the key and the agreement from this device. */
export function forgetAiSettings(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
  notify();
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let snapshot = readAiSettings();
let snapshotRaw: string | null = null;
function current() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return snapshot; }
  if (raw !== snapshotRaw) { snapshotRaw = raw; snapshot = readAiSettings(); }
  return snapshot;
}

export const useAiSettings = (): AiProviderSettings | null => useSyncExternalStore(subscribe, current, current);
