/**
 * Push notifications (G20, #1343, owner decision 11: in the app first, push next, email last). Pure rules shared by the
 * app and the control plane, so both agree on what may be pushed and to which device.
 *
 * - A device is registered only after the person turned alerts on for it, from a button (never on load).
 * - A push carries the same names-and-counts words as the in-app notice and opaque ids only: never comment text, file
 *   names or photo content. The inbox stays the record; a push is a nudge that can be missed.
 * - The person chooses which kinds are pushed. A kind switched off is not pushed and not emailed either: they still see
 *   it in the inbox.
 */
import type { NoticeKind } from './collabNotices';

export const PUSH_PLATFORMS = ['web', 'android', 'ios', 'desktop'] as const;
export type PushPlatform = typeof PUSH_PLATFORMS[number];

/** What a person can switch on or off for push. Each notice kind belongs to one. */
export const PUSH_CATEGORIES = ['comments', 'clientFeedback'] as const;
export type PushCategory = typeof PUSH_CATEGORIES[number];
export type PushPreferences = Record<PushCategory, boolean>;
export const DEFAULT_PUSH_PREFERENCES: PushPreferences = { comments: true, clientFeedback: true };

/** At most this many devices per account; registering another drops the one seen longest ago. */
export const MAX_PUSH_DEVICES = 10;

export function pushCategory(kind: NoticeKind): PushCategory {
  return kind === 'client-feedback' ? 'clientFeedback' : 'comments';
}

/** An FCM registration token: long, URL-safe characters and colons. Anything else is refused. */
export function isPushToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 4096 && /^[A-Za-z0-9_:.\-]+$/.test(value);
}

export function cleanPreferences(value: unknown): PushPreferences {
  const out = { ...DEFAULT_PUSH_PREFERENCES };
  if (value && typeof value === 'object') {
    for (const key of PUSH_CATEGORIES) {
      const v = (value as Record<string, unknown>)[key];
      if (typeof v === 'boolean') out[key] = v;
    }
  }
  return out;
}

/** The data a push may carry: kind and opaque ids only, each short, so nothing private can ride along. */
export function pushData(notice: { kind: NoticeKind; projectId: string; photoId?: string | null; id?: string }): Record<string, string> {
  const id = (v: string) => /^[A-Za-z0-9_-]{1,96}$/.test(v);
  const data: Record<string, string> = { kind: notice.kind };
  if (id(notice.projectId)) data.projectId = notice.projectId;
  if (notice.photoId && id(notice.photoId)) data.photoId = notice.photoId;
  if (notice.id && id(notice.id)) data.noticeId = notice.id;
  return data;
}

/**
 * Whether this device can get alerts, in the words the app shows. Checked in this order so the reason given is the one
 * the person can act on.
 */
export type PushState = 'unsupported' | 'not-configured' | 'signed-out' | 'blocked' | 'off' | 'on';
export function pushState(input: {
  supported: boolean; configured: boolean; signedIn: boolean;
  permission: 'default' | 'granted' | 'denied'; registered: boolean;
}): PushState {
  if (!input.supported) return 'unsupported';
  if (!input.configured) return 'not-configured';
  if (!input.signedIn) return 'signed-out';
  if (input.permission === 'denied') return 'blocked';
  return input.registered && input.permission === 'granted' ? 'on' : 'off';
}

/** What a tapped push opens: the photo when the message names one, otherwise the inbox. */
export function pushTarget(data: Record<string, unknown> | null | undefined): { projectId: string; photoId: string | null } | null {
  if (!data || typeof data.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(data.projectId)) return null;
  const photoId = typeof data.photoId === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(data.photoId) ? data.photoId : null;
  return { projectId: data.projectId, photoId };
}
