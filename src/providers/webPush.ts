import { pushState, type PushState } from '../core/pushNotices';
import type { CollabClient } from './collabClient';
import { isDesktopApp } from './desktopShell';
import { onBeforeSignOut } from './firebaseAuth';

/**
 * Browser push alerts (G20, #1343): shared-project notices reach this browser through Firebase Cloud Messaging while
 * InFlight is closed. The in-app inbox stays the record; a push can be missed and is never relied on.
 *
 * - Asked only from the person's own button, never on load. Turning off, or signing out, removes this device's token.
 * - Our own small worker (`push-sw.js`, its own scope so the offline worker is untouched) shows the message. No Firebase
 *   script runs in it, and nothing but the words and opaque ids arrives.
 * - The installed desktop and phone apps have no web push: they show the inbox when opened, and system notifications
 *   for finished work on the device (TaskAlerts).
 * - Needs the build's public web push key (VITE_FCM_VAPID_KEY) and sender id; without them it says "not set up".
 */
const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};
const vapidKey: string | undefined = env.VITE_FCM_VAPID_KEY;
const TOKEN_KEY = 'inflight.push.token';

export const isWebPushConfigured = () => Boolean(vapidKey && config.apiKey && config.projectId && config.appId && config.messagingSenderId);
export const isWebPushSupported = () => !isDesktopApp() && typeof window !== 'undefined' && 'Notification' in window
  && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;

const storedToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const storeToken = (token: string | null) => { try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* alerts still work this session */ } };

export function currentPushState(signedIn: boolean): PushState {
  const supported = isWebPushSupported();
  return pushState({
    supported, configured: isWebPushConfigured(), signedIn,
    permission: supported ? Notification.permission : 'denied', registered: storedToken() !== null,
  });
}

async function messaging() {
  const [{ initializeApp, getApps }, m] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!(await m.isSupported())) throw new Error('unsupported');
  const app = getApps().find((a) => a.name === 'inflight-push') ?? initializeApp(config, 'inflight-push');
  return { m, instance: m.getMessaging(app) };
}

async function workerRegistration(): Promise<ServiceWorkerRegistration> {
  const base = import.meta.env.BASE_URL || '/';
  return navigator.serviceWorker.register(`${base}push-sw.js`, { scope: `${base}push/` });
}

/** From the person's button: ask the browser, then register this device with the server. Returns the new state. */
export async function turnOnPush(client: CollabClient): Promise<PushState> {
  if (!isWebPushSupported()) return 'unsupported';
  if (!isWebPushConfigured()) return 'not-configured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const { m, instance } = await messaging();
  const token = await m.getToken(instance, { vapidKey, serviceWorkerRegistration: await workerRegistration() });
  if (!token) return 'off';
  await client.registerPushDevice(token, 'web');
  storeToken(token);
  return 'on';
}

/** Turning off, or signing out: the server forgets this device first, then the browser drops its token. */
export async function turnOffPush(client: CollabClient): Promise<void> {
  const token = storedToken();
  if (!token) return;
  await client.removePushDevice(token).catch(() => undefined);
  storeToken(null);
  try { const { m, instance } = await messaging(); await m.deleteToken(instance); } catch { /* the server no longer sends to it */ }
}

/** Removes this device's alerts whenever the person signs out. Call once at start-up. */
export function removePushOnSignOut(client: CollabClient): () => void {
  return onBeforeSignOut(() => turnOffPush(client));
}

/** A tapped alert asks the open app to show its photo (see public/push-sw.js). */
export function onPushOpened(open: (target: { projectId: string; photoId: string | null }) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  const listener = (event: MessageEvent) => {
    const d = event.data as { type?: unknown; projectId?: unknown; photoId?: unknown } | null;
    if (d?.type !== 'inflight-push-open' || typeof d.projectId !== 'string') return;
    open({ projectId: d.projectId, photoId: typeof d.photoId === 'string' ? d.photoId : null });
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
