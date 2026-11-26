import React, { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../utils/dialogFocus';
import { STRINGS } from '../strings';
import type { EnlargementPreviewResult } from '../../engineClient/enlargementPreview';
import { applyProofLut, buildProofLut, parseIccProfile, type ProofLut } from '../../../core/iccProfile';
import { PRINT_PAPERS, printLayout, type PrintLayout, type PrintPaper } from '../../../core/printLayout';

const PROFILE_KEY = 'inflight.printProfile.v1';
const PAPER_KEY = 'inflight.printPaper.v1';
const PREVIEW_EDGE = 1000;

function readStored(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return null; } }
function store(key: string, value: string) { try { window.localStorage.setItem(key, value); } catch { /* full or blocked: kept for this session only */ } }
const toBase64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

function loadProfile(bytes: Uint8Array): { lut: ProofLut } | { error: string } {
  try { return { lut: buildProofLut(parseIccProfile(bytes)) }; } catch (reason) { return { error: reason instanceof Error ? reason.message : String(reason) }; }
}

/** Send the picture to the system's print dialog at its physical size. The pixels sent are the export's own, unproofed. */
function printPicture(url: string, layout: PrintLayout) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) { frame.remove(); return; }
  const { pageMm: p, imageMm: i } = layout;
  doc.open();
  doc.write(`<!doctype html><html><head><title>InFlight print</title><style>@page{size:${p.width.toFixed(1)}mm ${p.height.toFixed(1)}mm;margin:0}` +
    `html,body{margin:0;padding:0}body{width:${p.width.toFixed(1)}mm;height:${p.height.toFixed(1)}mm;display:flex;align-items:center;justify-content:center}` +
    `img{display:block;width:${i.width.toFixed(2)}mm;height:${i.height.toFixed(2)}mm}</style></head><body><img alt=""></body></html>`);
  doc.close();
  const img = doc.querySelector('img')!;
  const done = () => setTimeout(() => frame.remove(), 1000);
  img.onload = () => { win.addEventListener('afterprint', done, { once: true }); win.focus(); win.print(); setTimeout(done, 60_000); };
  img.onerror = () => frame.remove();
  img.src = url;
}

export default function PrintDialog({ result, onClose }: { result: EnlargementPreviewResult | null; onClose: () => void }) {
  const t = STRINGS.print;
  const panelRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useDialogFocus(true, panelRef, onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [paper, setPaper] = useState<PrintPaper>(() => { const saved = readStored(PAPER_KEY); return saved && saved in PRINT_PAPERS ? saved as PrintPaper : 'A4'; });
  const [profile, setProfile] = useState<{ name: string; lut: ProofLut } | null>(null);
  const [profileError, setProfileError] = useState('');
  const [proof, setProof] = useState(true);
  const [markGamut, setMarkGamut] = useState(false);
  const [outside, setOutside] = useState<number | null>(null);
  const [picture, setPicture] = useState<HTMLImageElement | null>(null);

  // The last profile chosen on this device comes back, if it was small enough to keep.
  useEffect(() => {
    const saved = readStored(PROFILE_KEY);
    if (!saved) return;
    try {
      const { name, data } = JSON.parse(saved) as { name: string; data: string };
      const loaded = loadProfile(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
      if ('lut' in loaded) setProfile({ name, lut: loaded.lut });
    } catch { /* a damaged entry is ignored */ }
  }, []);

  useEffect(() => {
    if (!result?.ok) return;
    const img = new Image();
    img.onload = () => setPicture(img);
    img.src = result.url;
  }, [result]);

  // Draw the preview, proofed when asked; the share outside the paper's colours is counted whenever a profile is chosen.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !picture) return;
    const scale = Math.min(1, PREVIEW_EDGE / Math.max(picture.naturalWidth, picture.naturalHeight));
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    if (!profile) { setOutside(null); return; }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    setOutside(applyProofLut(profile.lut, pixels.data, canvas.width, markGamut, proof));
    context.putImageData(pixels, 0, 0);
  }, [picture, profile, proof, markGamut]);

  const chooseProfile = async (file: File | undefined) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loaded = loadProfile(bytes);
    if ('error' in loaded) { setProfileError(loaded.error); return; }
    setProfileError('');
    setProfile({ name: file.name, lut: loaded.lut });
    setProof(true);
    if (bytes.length <= 3_000_000) store(PROFILE_KEY, JSON.stringify({ name: file.name, data: toBase64(bytes) }));
  };

  const layout = result?.ok ? printLayout(result.width, result.height, paper) : null;
  const cm = (mm: number) => (mm / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const checkbox = 'flex items-center gap-2 text-xs text-[var(--text-primary)]';
  const button = 'min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]';
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--bg-scrim)] p-2 sm:p-4" onKeyDown={onKeyDown}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="v2-print-title" data-testid="v2-print-dialog"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col gap-3 overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <div className="flex items-start justify-between gap-3">
          <h2 id="v2-print-title" className="text-base font-semibold">{t.title}</h2>
          <button type="button" onClick={onClose} className={button}>{t.close}</button>
        </div>
        {!result && <p role="status" className="text-sm text-[var(--text-secondary)]">{t.working}</p>}
        {result && !result.ok && <p role="alert" className="text-sm">{`${t.failed}: ${result.message}`}</p>}
        {result?.ok && layout && <>
          <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
            <div className="flex min-h-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2">
              <canvas ref={canvasRef} data-testid="v2-print-preview" aria-label={t.title} className="max-h-[60dvh] max-w-full object-contain" />
            </div>
            <div className="space-y-3">
              <label className="block text-xs">
                {t.paper}
                <select value={paper} onChange={(event) => { const next = event.target.value as PrintPaper; setPaper(next); store(PAPER_KEY, next); }}
                  className="mt-1 min-h-10 w-full rounded bg-[var(--bg-input)] p-2 text-xs">
                  {(Object.keys(PRINT_PAPERS) as PrintPaper[]).map((id) => <option key={id} value={id}>{PRINT_PAPERS[id].label}</option>)}
                </select>
              </label>
              <p className="text-xs" data-testid="v2-print-size">{t.size(cm(layout.imageMm.width), cm(layout.imageMm.height), layout.ppi)}</p>
              {layout.ppi < 200 && <p className="text-xs text-[var(--text-secondary)]">{t.lowPpi}</p>}
              <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
                <p className="text-xs font-semibold">{t.profile}</p>
                <p className="break-words text-[0.6875rem] text-[var(--text-secondary)]" data-testid="v2-print-profile">{profile ? profile.name : t.noProfile}</p>
                <input ref={fileRef} type="file" accept=".icc,.icm,application/vnd.iccprofile" className="hidden" aria-label={t.chooseProfile}
                  onChange={(event) => { void chooseProfile(event.target.files?.[0]); event.target.value = ''; }} />
                <button type="button" className={button} onClick={() => fileRef.current?.click()}>{t.chooseProfile}</button>
                {profileError && <p role="alert" className="text-[0.6875rem]">{profileError}</p>}
                {profile && <>
                  <label className={checkbox}><input type="checkbox" checked={proof} onChange={(event) => setProof(event.target.checked)} />{t.softProof}</label>
                  <label className={checkbox}><input type="checkbox" checked={markGamut} onChange={(event) => setMarkGamut(event.target.checked)} />{t.markGamut}</label>
                  {outside !== null && <p className="text-[0.6875rem] text-[var(--text-secondary)]" data-testid="v2-print-outside">{t.outside(Math.round(outside * 100))}</p>}
                </>}
              </div>
              <p className="text-[0.6875rem] text-[var(--text-secondary)]">{t.printHelp}</p>
              <button type="button" onClick={() => printPicture(result.url, layout)}
                className="min-h-10 w-full rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)]">
                {t.printButton}
              </button>
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}
