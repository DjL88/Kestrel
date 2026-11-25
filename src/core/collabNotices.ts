/**
 * Team notifications for shared projects (G20, owner decision 11). Pure rules shared by app and control plane.
 *
 * Decision 11: notify in the app first, push next, email last. Every notice lands in the person's in-app inbox (read
 * through the control-plane API when the app is open). Push (Firebase Cloud Messaging) is sent when the person has a
 * device for it. Email is only a fallback, for someone with no push device who has not had the app open recently, and
 * then only through the backend's hello@ mailer and its daily counter (which may hold non-urgent mail for the next day).
 *
 * No spam: notices about the same thing (a project, a kind, a photo or gallery) merge while unread, and only a new
 * notice is pushed or emailed, never each merge. Text is short and names people and photos only; no photo content.
 */
export type NoticeKind = 'comment' | 'reply' | 'resolve' | 'reopen' | 'client-feedback';

export interface NoticeEvent {
  kind: NoticeKind;
  projectId: string;
  projectName: string;
  /** The photo, when it is about one. */
  photoId?: string;
  /** A gallery, for client feedback. */
  galleryId?: string;
  galleryName?: string;
  /** Who acted ("Erin"), or null for an anonymous gallery visitor. */
  actorName: string | null;
  recipients: readonly string[];
}

export interface Notice {
  id: string;
  accountId: string;
  /** Same key while unread = one notice. */
  key: string;
  kind: NoticeKind;
  projectId: string;
  projectName: string;
  photoId: string | null;
  galleryName: string | null;
  actors: string[];
  count: number;
  createdAtMs: number;
  updatedAtMs: number;
  readAtMs: number | null;
}

export const NOTICE_MAX_ACTORS = 5;
/** "Has the app open": the inbox was read within this time. */
export const APP_OPEN_WINDOW_MS = 15 * 60_000;

export function noticeKey(event: NoticeEvent): string {
  return [event.projectId, event.kind === 'reply' || event.kind === 'resolve' || event.kind === 'reopen' ? 'thread' : event.kind, event.photoId ?? '', event.galleryId ?? ''].join('|');
}

/** A new notice, or the unread one it merges into. Merging adds the actor and counts; it never re-sends. */
export function mergeNotice(existing: Notice | null, event: NoticeEvent, accountId: string, id: string, atMs: number): { notice: Notice; isNew: boolean } {
  const actor = event.actorName?.slice(0, 80) ?? null;
  if (existing && existing.readAtMs === null) {
    const actors = actor && !existing.actors.includes(actor) ? [...existing.actors, actor].slice(-NOTICE_MAX_ACTORS) : existing.actors;
    return { isNew: false, notice: { ...existing, kind: event.kind, actors, count: existing.count + 1, updatedAtMs: atMs } };
  }
  return {
    isNew: true,
    notice: {
      id, accountId, key: noticeKey(event), kind: event.kind, projectId: event.projectId, projectName: event.projectName.slice(0, 120),
      photoId: event.photoId ?? null, galleryName: event.galleryName?.slice(0, 120) ?? null, actors: actor ? [actor] : [], count: 1,
      createdAtMs: atMs, updatedAtMs: atMs, readAtMs: null,
    },
  };
}

export interface Reach { pushDevices: number; hasEmail: boolean; lastInboxReadMs: number | null }
export interface Delivery { inbox: true; push: boolean; email: boolean }

/** Decision 11(c): in-app always; push when possible; email only with no push device and no recent session. */
export function chooseDelivery(reach: Reach, isNew: boolean, atMs: number): Delivery {
  if (!isNew) return { inbox: true, push: false, email: false };
  const push = reach.pushDevices > 0;
  const appOpen = reach.lastInboxReadMs !== null && atMs - reach.lastInboxReadMs <= APP_OPEN_WINDOW_MS;
  return { inbox: true, push, email: !push && !appOpen && reach.hasEmail };
}

/** British English words for push and email (the app shows its own translated words from the same fields). */
export function noticeWords(n: Pick<Notice, 'kind' | 'actors' | 'count' | 'projectName' | 'galleryName'>): { title: string; body: string } {
  const who = n.actors.length === 0 ? 'Someone' : n.actors.length === 1 ? n.actors[0] : `${n.actors[0]} and ${n.actors.length - 1} more`;
  const times = n.count > 1 ? ` (${n.count})` : '';
  const title = `InFlight · ${n.projectName}`;
  switch (n.kind) {
    case 'comment': return { title, body: `${who} commented on a photo${times}.` };
    case 'reply': return { title, body: `${who} replied to a comment${times}.` };
    case 'resolve': return { title, body: `${who} resolved a comment${times}.` };
    case 'reopen': return { title, body: `${who} reopened a comment${times}.` };
    case 'client-feedback': return { title, body: `New client feedback in ${n.galleryName ?? 'a gallery'}${times}. Nothing changes until you review it.` };
  }
}
