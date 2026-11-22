/**
 * Central runtime and original-file policy. Detect the Tauri runtime before user-agent
 * hints: desktop webviews often identify themselves as ordinary browsers.
 * Never infer that a browser can silently read a local path or that mobile can
 * access a desktop/NAS share. Remote upload always requires an explicit action.
 */
export type KestrelRuntime = 'desktop' | 'mobile' | 'browser';
export type OriginalLocation = 'local' | 'network' | 'remote';

export interface RuntimeSignals {
  tauri: boolean;
  tauriPlatform?: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | string;
  mobileUserAgent?: boolean;
}

export function detectRuntime(signals: RuntimeSignals): KestrelRuntime {
  if (signals.tauri) {
    if (signals.tauriPlatform === 'android' || signals.tauriPlatform === 'ios') return 'mobile';
    // Tauri without platform metadata is a native app, not a browser.
    return 'desktop';
  }
  return signals.mobileUserAgent ? 'mobile' : 'browser';
}

export interface OriginalAccessPolicy {
  /** How InFlight opens the original, not how a thumbnail is rendered. */
  mode: 'native-path' | 'user-granted-file' | 'explicit-remote';
  retainOriginalInPlace: boolean;
  automaticUpload: false;
  canRetrySavedPath: boolean;
  requiresUserGrant: boolean;
}

export function originalAccessPolicy(runtime: KestrelRuntime, location: OriginalLocation): OriginalAccessPolicy {
  if (location === 'remote') {
    return { mode: 'explicit-remote', retainOriginalInPlace: true, automaticUpload: false, canRetrySavedPath: false, requiresUserGrant: true };
  }
  if (runtime === 'desktop') {
    // Local disks, mounted drives and SMB/NAS paths share the same read-only
    // original policy. A disconnected mount is a recoverable state, not deletion.
    return { mode: 'native-path', retainOriginalInPlace: true, automaticUpload: false, canRetrySavedPath: true, requiresUserGrant: false };
  }
  return { mode: 'user-granted-file', retainOriginalInPlace: true, automaticUpload: false, canRetrySavedPath: false, requiresUserGrant: true };
}

/** Safe sync runtime classification for existing UI entry points. */
export function currentRuntime(): KestrelRuntime {
  if (typeof window === 'undefined') return 'browser';
  const tauri = '__TAURI_INTERNALS__' in window;
  const platform = (window as Window & { __KESTREL_NATIVE_PLATFORM__?: string }).__KESTREL_NATIVE_PLATFORM__;
  const mobileUserAgent = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return detectRuntime({ tauri, tauriPlatform: platform, mobileUserAgent });
}
