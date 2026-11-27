import { useEffect, useRef, useState } from 'react';
import { screenToPhoto, type Peer } from '../../../core/editingSequence';
import type { CollabClient } from '../../../providers/collabClient';
import { readCollabLink } from '../dialogs/sharedLinks';

export const frameElement = () => document.querySelector<HTMLElement>('.inflight-v2 [data-testid="canvas-frame"]');

/**
 * Live presence for the open project, only when this device's project is linked to a shared one and the person is
 * signed in. Anything that fails leaves the editor exactly as it is: presence is never needed to edit.
 */
export function usePresence(client: CollabClient, localProjectId: string | null, photoId: string | null, displayName: () => Promise<string | null>, refreshKey: number) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const session = useRef<{ update: (photoId: string | null, point: { x: number; y: number } | null) => void } | null>(null);
  const photo = useRef(photoId);
  photo.current = photoId;

  useEffect(() => {
    const shared = localProjectId ? readCollabLink(localProjectId) : null;
    if (!shared || !client.configured) { setPeers([]); return; }
    let closed = false;
    let close: (() => void) | null = null;
    void (async () => {
      const name = await displayName();
      if (!name || closed) return;
      const { connectPresence } = await import('../../../providers/collabPresence');
      const live = await connectPresence(client, shared, { name, kind: 'human-editor' }, (next) => { if (!closed) setPeers(next); });
      if (closed) { live.close(); return; }
      session.current = live; close = () => live.close();
      live.update(photo.current, null);
    })().catch(() => { if (!closed) setPeers([]); });
    const move = (event: PointerEvent) => {
      const frame = frameElement();
      if (!session.current || !frame) return;
      const rect = frame.getBoundingClientRect();
      session.current.update(photo.current, screenToPhoto(event.clientX, event.clientY, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }));
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { closed = true; window.removeEventListener('pointermove', move); session.current = null; close?.(); setPeers([]); };
  }, [client, localProjectId, displayName, refreshKey]);

  useEffect(() => { session.current?.update(photoId, null); }, [photoId]);
  return peers;
}
