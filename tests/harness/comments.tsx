/**
 * Mounts the real V2 comments layer against an in-memory sharing client that follows the same rules as the control
 * plane (src/core/photoComments.ts), so tests/v2-dev-comments.spec.ts can drive pins, replies, resolve and reopen.
 * Served only by the Vite dev server; not part of any build.
 */
import '../../src/index.css';
import '../../src/v2/ui/v2.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { orderThreads, reopenThread, reply, resolveThread, startThread, type CommentThread } from '../../src/core/photoComments';
import type { CollabClient } from '../../src/providers/collabClient';
import { writeSharedLink } from '../../src/v2/ui/dialogs/sharedLinks';
import { CommentsButton, PhotoCommentsLayer, usePhotoComments } from '../../src/v2/ui/shell/PhotoComments';

const canComment = new URLSearchParams(location.search).get('role') !== 'viewer';
const threads = new Map<string, CommentThread>();
let ids = 0;
const next = () => `id${++ids}`;
const unwrap = (r: ReturnType<typeof startThread>) => { if (!r.ok) throw new Error(r.reason); threads.set(r.thread.id, r.thread); return r.thread; };
const client = {
  configured: true,
  commentCounts: async () => {
    const counts: Record<string, number> = {};
    for (const t of threads.values()) if (!t.resolved) counts[t.photoId] = (counts[t.photoId] ?? 0) + 1;
    return counts;
  },
  comments: async (_p: string, photoId: string) => ({ threads: orderThreads([...threads.values()].filter((t) => t.photoId === photoId)), canComment }),
  startComment: async (_p: string, photoId: string, pin: unknown, text: string) =>
    unwrap(startThread({ id: next(), entryId: next(), photoId, pin, authorAccountId: 'me', authorName: 'Dave', text }, 0, Date.now())),
  changeComment: async (_p: string, _photo: string, threadId: string, change: { kind: string; text?: string }) => {
    const t = threads.get(threadId)!;
    return unwrap(change.kind === 'reply' ? reply(t, { id: next(), authorAccountId: 'erin', authorName: 'Erin', text: change.text }, Date.now())
      : change.kind === 'resolve' ? resolveThread(t, { accountId: 'erin', name: 'Erin' }, Date.now()) : reopenThread(t, Date.now()));
  },
} as unknown as CollabClient;

writeSharedLink('local-1', 'shared-1');

function Harness() {
  const [open, setOpen] = useState(false);
  const comments = usePhotoComments(client, 'local-1', 'photo-1', 0);
  return (
    <div className="inflight-v2" style={{ padding: 40 }}>
      <CommentsButton open={open} openCount={comments.counts['photo-1'] ?? 0} onToggle={() => setOpen((v) => !v)} />
      <div data-testid="canvas-frame" style={{ width: 400, height: 300, marginTop: 20, background: '#557' }} />
      <PhotoCommentsLayer comments={comments} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
