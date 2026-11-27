/**
 * Mounts the real Settings › Account cloud usage panel and the real Share › Cloud photos panel against a stand-in sharing
 * client whose cloud storage fills up after two uploads (the control plane's 402 STORAGE_NEEDS_CREDIT), so
 * tests/v2-dev-cloud-storage.spec.ts can check the meter's words and that a full store is a clear block with Top up,
 * never a silently dropped photo. The "storage full" line under the panel is wired the same way ShareDialog wires it.
 * Pictures are synthetic. Served only by the Vite dev server.
 */
import '../../src/index.css';
import '../../src/v2/ui/v2.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CloudUsagePanel from '../../src/v2/ui/panels/CloudUsagePanel';
import CloudPhotosPanel from '../../src/v2/ui/dialogs/CloudPhotosPanel';
import { CollabError, type CollabClient } from '../../src/providers/collabClient';
import { STRINGS } from '../../src/v2/ui/strings';

const NOW = Date.UTC(2026, 10, 27);
const uploaded: string[] = [];
(window as unknown as { uploaded: string[] }).uploaded = uploaded;

const client = {
  cloudPhotos: async () => uploaded.filter((k, i, all) => all.indexOf(k) === i).map((photoKey) => ({ photoKey, name: `${photoKey}.jpg`, previewBytes: 1_000_000, originalBytes: null })),
  usage: async () => ({ usedCredits: 0, allowanceCredits: 33 }),
  cloudUpload: async (_project: string, key: string, variant: string) => {
    if (variant === 'preview' && new Set(uploaded).size >= 2) throw new CollabError('refused', 'STORAGE_NEEDS_CREDIT', 'server words');
    if (variant === 'preview') uploaded.push(key);
  },
} as unknown as CollabClient;

async function synthetic(): Promise<Blob> {
  const canvas = new OffscreenCanvas(320, 240);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a6a8a'; ctx.fillRect(0, 0, 320, 240);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

const photos = [1, 2, 3, 4, 5].map((n) => ({ id: `p${n}`, sharedKey: `k${n}`, filename: `synthetic-${n}.jpg` }));

function Harness() {
  const t = STRINGS.share;
  const [problem, setProblem] = useState<string | null>(null);
  const [topUp, setTopUp] = useState(false);
  return (
    <div className="inflight-v2" style={{ maxWidth: 520, padding: 16 }}>
      <div data-testid="usage-some"><CloudUsagePanel usage={{ plan: 'pro', photosUsed: 12, storedBytes: 1_200_000_000, downloadedBytes: 0, balancePence: 0, nowMs: NOW }} /></div>
      <div data-testid="usage-full"><CloudUsagePanel usage={{ plan: 'pro', photosUsed: 12, storedBytes: 2_500_000_000, downloadedBytes: 0, balancePence: 0, nowMs: NOW }} /></div>
      <div data-testid="usage-basic"><CloudUsagePanel usage={{ plan: 'basic', photosUsed: 0, storedBytes: 0, downloadedBytes: 0, balancePence: 0, nowMs: NOW }} /></div>
      <section data-testid="share">
        {problem && (
          <div role="alert" data-testid="share-problem">
            <p>{problem}</p>
            <button type="button" onClick={() => setTopUp(true)}>{t.topUp}</button>
          </div>
        )}
        {topUp && <p data-testid="top-up-opened">Settings › Account opened</p>}
        <CloudPhotosPanel client={client} projectId="proj" role="owner" photos={photos} selectedPhotoIds={[]}
          renderPreview={() => synthetic()} onProblem={(e) => setProblem(String(e))}
          onStorageFull={(sent, left) => setProblem(t.cloudStorageFull(sent, left))} />
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
