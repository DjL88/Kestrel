/**
 * Mounts the real "Store in the cloud" dialog against a pretend cloud photo store held in the page, so the chooser,
 * the size line, storing, the full-storage stop and Remove from the cloud are checked end to end without a server.
 * Served only by the Vite dev server for tests/v2-dev-store-cloud.spec.ts. Pictures are synthetic; nothing leaves the page.
 *
 * ?full=N makes the pretend cloud refuse after N photos, as the server does when storage needs a top-up.
 */
import '../../src/index.css';
import '../../src/v2/ui/v2.css';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import StoreInCloudDialog, { type StorablePhoto } from '../../src/v2/ui/dialogs/StoreInCloudDialog';
import { CollabError, type CollabClient } from '../../src/providers/collabClient';
import type { CloudUsage } from '../../src/core/cloudPlan';

const params = new URLSearchParams(location.search);
const fullAfter = params.has('full') ? Number(params.get('full')) : Infinity;
const withOriginals = params.has('originals');
const storedGb = Number(params.get('stored') ?? '1');

const photos: StorablePhoto[] = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i}`, sharedKey: `key-${i}`, filename: `IFL_${String(i).padStart(4, '0')}.NEF`,
  decision: i % 4 === 0 ? 'keep' : 'unreviewed', sharpnessScore: i + 1,
  rating: i % 3 === 0 ? 5 : i % 3 === 1 ? 2 : 0, speciesName: i < 5 ? 'Puffin' : 'Gannet', exif: { fileSizeMb: 20 },
}));

function Harness() {
  const [open, setOpen] = useState(true);
  const [topUp, setTopUp] = useState(false);
  const cloud = useMemo(() => ({ projects: new Map<string, Set<string>>(), calls: [] as string[], uploads: 0, originals: new Set<string>() }), []);
  (window as unknown as { cloud: typeof cloud }).cloud = cloud;
  const client = useMemo(() => ({
    configured: true,
    create: async (name: string) => { cloud.calls.push(`create ${name}`); cloud.projects.set('shared-1', new Set()); return 'shared-1'; },
    cloudPhotos: async (id: string) => [...(cloud.projects.get(id) ?? [])].map((photoKey) => ({ photoKey, name: photoKey, previewBytes: 1_000_000, thumbBytes: 20_000, originalBytes: cloud.originals.has(photoKey) ? 20_000_000 : null })),
    cloudUpload: async (id: string, key: string, variant: string) => {
      cloud.calls.push(`upload ${variant} ${key}`);
      const held = cloud.projects.get(id)!;
      if (variant === 'thumb' && !held.has(key) && held.size >= fullAfter) throw new CollabError('refused', 'STORAGE_NEEDS_CREDIT', 'Cloud storage is full.');
      if (variant === 'preview') { held.add(key); cloud.uploads += 1; }
      if (variant === 'original') cloud.originals.add(key);
    },
    cloudRemove: async (id: string, key: string) => { cloud.calls.push(`remove ${key}`); cloud.projects.get(id)?.delete(key); },
  }) as unknown as CollabClient, [cloud]);
  const usage: CloudUsage = { plan: 'pro', photosUsed: 10, storedBytes: storedGb * 1_000_000_000, downloadedBytes: 0, balancePence: 0, nowMs: Date.now() };
  const preview = async () => {
    const canvas = new OffscreenCanvas(64, 48);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#7a8a9a'; context.fillRect(0, 0, 64, 48);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  };
  return (
    <div className="inflight-v2">
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <StoreInCloudDialog open={open} client={client} localProjectId="local-1" projectName="Harness shoot" photos={photos}
        selectedPhotoIds={params.has('none') ? [] : ['p1', 'p2', 'p3']} displayName={async () => 'Test Person'} renderPreview={preview} readOriginal={withOriginals ? async () => new Blob([new Uint8Array(1000)]) : undefined} usage={usage}
        onTopUp={() => setTopUp(true)} onClose={() => setOpen(false)} />
      <pre data-testid="top-up">{topUp ? 'top-up opened' : ''}</pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
