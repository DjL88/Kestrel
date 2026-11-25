import { isDesktopApp } from './desktopShell';

/**
 * System notifications on this device, for finished work (G20 task-done alerts). Offline, no account, nothing leaves
 * the device. A browser uses the Notification API; the installed Windows, macOS, Android and iOS apps use the Tauri
 * notification plugin. Permission is only ever asked from the person's own click.
 */
export type NotifyPermission = 'default' | 'granted' | 'denied';

const browserCan = () => typeof window !== 'undefined' && 'Notification' in window;
const plugin = () => import('@tauri-apps/plugin-notification');

export async function notifyPermission(): Promise<NotifyPermission> {
  if (isDesktopApp()) {
    try { return (await (await plugin()).isPermissionGranted()) ? 'granted' : 'default'; } catch { return 'denied'; }
  }
  return browserCan() ? Notification.permission : 'denied';
}

export async function askNotifyPermission(): Promise<NotifyPermission> {
  try {
    if (isDesktopApp()) { const answer = await (await plugin()).requestPermission(); return answer === 'granted' ? 'granted' : answer === 'denied' ? 'denied' : 'default'; }
    return browserCan() ? await Notification.requestPermission() : 'denied';
  } catch { return 'denied'; }
}

/** Shows one system notification if allowed. Never throws: the in-app message still shows on return. */
export async function notifySystem(body: string): Promise<void> {
  try {
    if (isDesktopApp()) {
      const p = await plugin();
      if (await p.isPermissionGranted()) p.sendNotification({ title: 'InFlight', body });
      return;
    }
    if (browserCan() && Notification.permission === 'granted') new Notification('InFlight', { body, tag: 'inflight-task-done' });
  } catch { /* nothing else depends on it */ }
}
