/**
 * Mounts the real client feedback panel against an in-memory sharing client, so tests/v2-dev-client-feedback.spec.ts
 * can review feedback and check that only "Flag it" changes a decision. Served only by the Vite dev server.
 */
import '../../src/index.css';
import '../../src/v2/ui/v2.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FeedbackReview } from '../../src/core/clientFeedback';
import type { GalleryFeedbackEvent } from '../../src/core/galleryFeedback';
import type { CollabClient } from '../../src/providers/collabClient';
import GalleryFeedbackPanel from '../../src/v2/ui/dialogs/GalleryFeedbackPanel';

let clock = 1_000;
const events: GalleryFeedbackEvent[] = [
  { visitor: 'v1', photoId: 'p1', kind: 'favourite', text: null, atMs: 100 },
  { visitor: 'v1', photoId: 'p2', kind: 'comment', text: 'Could the branch go?', atMs: 200 },
];
let reviews: FeedbackReview[] = [];
const client = {
  configured: true,
  galleries: async () => [{ galleryId: 'g1', name: 'Selects', expiresAtMs: Date.UTC(2026, 11, 20), photos: 2, published: 2, password: false, photoIds: ['p1', 'p2'] }],
  galleryFeedbackWithReviews: async () => ({ events: [...events], reviews: [...reviews] }),
  reviewFeedback: async (_g: string, photoId: string, state: 'done' | 'dismissed' | 'new') => {
    clock += 1;
    reviews = reviews.filter((r) => r.itemId !== `photo:${photoId}`);
    if (state !== 'new') reviews.push({ itemId: `photo:${photoId}`, state, byName: 'Dave', atMs: clock });
  },
  revokeGallery: async () => undefined,
} as unknown as CollabClient;

/** The harness lets the spec add a client action later, as the server would record it. */
(window as unknown as { addClientEvent: (e: GalleryFeedbackEvent) => void }).addClientEvent = (e) => { clock += 1; events.push({ ...e, atMs: clock }); };

function Harness() {
  const [decisions, setDecisions] = useState<Record<string, 'unreviewed' | 'keep' | 'reject'>>({ p1: 'unreviewed', p2: 'unreviewed' });
  return (
    <div className="inflight-v2" style={{ padding: 24, maxWidth: 480 }}>
      <p data-testid="decisions">{Object.entries(decisions).map(([id, d]) => `${id}=${d}`).join(' ')}</p>
      <GalleryFeedbackPanel client={client} projectId="shared-1" version={0} photoName={(id) => `Photo ${id}`} onGoToPhoto={() => undefined}
        onProblem={(e) => { throw e; }} photoDecision={(id) => decisions[id] ?? null}
        onFlag={(id) => setDecisions((d) => ({ ...d, [id]: 'keep' }))} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
