import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react';
import { FloatingPane } from '../components/FloatingPane';
import { tasks as realTaskStore, type Task } from '../core/taskStore';
import { createDemoShootState } from '../core/cullingEngine';
import type { CullingState, PhotoFrame } from '../core/types';
import {
  PANEL_IDS, WIRED_PANELS, defaultPanelLayout, toggleRailPanel, setPanelVisible, setPanelDock,
  type PanelId, type PanelLayout,
} from './panelLayout';
import { visibleFrames, nextFlagToggle, isFlagged, filmstripReadiness, type FilmstripFilter } from './filmstripFilter';

const PANEL_LABEL: Record<PanelId, string> = {
  copilot: 'Co-pilot',
  adjust: 'Adjust',
  formats: 'Formats',
  masks: 'Masks',
  overlays: 'Overlay',
  info: 'Info',
  tasks: 'Tasks',
};

const STORAGE_KEY = 'v2-workspace-panel-layout';

function loadLayout(): PanelLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return { ...defaultPanelLayout(), ...(parsed as Partial<PanelLayout>) };
    }
  } catch { /* device-local preference only */ }
  return defaultPanelLayout();
}

/** The InFlight V2 workspace shell (docs/V2-WORKSPACE.md section 1, build-order slice 1).
 *
 * WIRED in this slice (genuinely reads/writes real app state, not demo-only plumbing):
 *  - Flag/unflag and the All/Flagged filter write the real `CullDecision` on real `PhotoFrame`s.
 *  - The Tasks panel subscribes to the real `src/core/taskStore` singleton used by the rest of the app.
 *  - Full screen uses the real Fullscreen API.
 *
 * NOT WIRED yet (explicitly placeholders, not silently faked):
 *  - The canvas is a filename/decision readout, not the real photo renderer/editor.
 *  - Adjust, Formats, Masks and Overlay panels show "not built yet" text; no recipe, size-copy, mask or
 *    watermark engine is connected here.
 *  - File/View/Export in the top bar are disabled stubs.
 *  - The filmstrip's Importing/Analysing states are not driven by a real async import pipeline (see
 *    filmstripFilter.ts); this slice loads a demo shoot via `createDemoShootState`, the same generator
 *    the main app's own onboarding uses, not real imported photos.
 *  - The "Set aside" filter entry for old/camera rejects (section 2) is not built; only All/Flagged exist.
 */
export function V2Workspace({ onExit }: { onExit?: () => void }) {
  const [project, setProject] = useState<CullingState>(() => createDemoShootState(24));
  const [layout, setLayout] = useState<PanelLayout>(loadLayout);
  const [filmstripFilter, setFilmstripFilter] = useState<FilmstripFilter>('all');
  const [gridView, setGridView] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [taskList, setTaskList] = useState<Task[]>(() => realTaskStore.list());

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* optional */ }
  }, [layout]);

  useEffect(() => realTaskStore.subscribe(() => setTaskList(realTaskStore.list())), []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const frames = project.frames;
  const shown = useMemo(() => visibleFrames(frames, filmstripFilter), [frames, filmstripFilter]);
  const selected = frames.find((frame) => frame.id === project.selectedFrameId) ?? null;

  const selectFrame = (id: string) => setProject((current) => ({ ...current, selectedFrameId: id }));

  const toggleFlag = (id: string) => setProject((current) => ({
    ...current,
    frames: current.frames.map((frame) => (frame.id === id ? { ...frame, decision: nextFlagToggle(frame.decision) } : frame)),
  }));

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => { /* not available on this device/browser */ });
  };

  return (
    <div className="flex h-dvh min-h-0 w-full flex-col bg-kestrel-base text-zinc-100" data-v2-workspace>
      {/* Top bar: Back, File, View, name, Export — section 1, 10. File/View/Export are stubs in this slice. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 bg-kestrel-raised px-2">
        <button type="button" onClick={onExit}
          className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
          Back
        </button>
        <button type="button" disabled title="Not wired yet in this V2 preview"
          className="rounded-md px-3 py-1.5 text-sm text-zinc-500">
          File
        </button>
        <button type="button" disabled title="Not wired yet in this V2 preview"
          className="rounded-md px-3 py-1.5 text-sm text-zinc-500">
          View
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-sm font-semibold">{project.shoot.title}</div>
        <button type="button" disabled title="Export is not wired yet in this V2 preview"
          className="rounded-md px-3 py-1.5 text-sm text-zinc-500">
          Export
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left rail: one tool button per panel; clicking opens/closes it docked or, if floated, as a FloatingPane. */}
        <nav aria-label="Workspace tools" className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-kestrel-raised py-2">
          {PANEL_IDS.map((id) => (
            <button key={id} type="button" aria-pressed={layout[id].visible}
              aria-label={PANEL_LABEL[id]} title={PANEL_LABEL[id]}
              onClick={() => setLayout((current) => toggleRailPanel(current, id))}
              onContextMenu={(event: MouseEvent) => {
                event.preventDefault();
                setLayout((current) => setPanelVisible(current, id, !current[id].visible));
              }}
              className="grid h-11 w-11 place-items-center rounded-md text-xs font-medium hover:bg-white/10 aria-pressed:bg-sky-400/25 aria-pressed:text-sky-100 focus-visible:outline-2 focus-visible:outline-sky-300">
              {PANEL_LABEL[id].slice(0, 2)}
            </button>
          ))}
        </nav>

        {/* Docked-left panel column. */}
        {PANEL_IDS.filter((id) => layout[id].visible && layout[id].dock === 'left').map((id) => (
          <DockedPanel key={id} id={id} layout={layout} setLayout={setLayout} taskList={taskList} selected={selected} />
        ))}

        {/* Canvas: a real-data readout, not the real photo renderer (see module header). */}
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/40 p-4">
            {gridView ? (
              <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
                {shown.map((frame) => (
                  <button key={frame.id} type="button" onClick={() => selectFrame(frame.id)}
                    className={`truncate rounded border px-2 py-6 text-xs ${frame.id === selected?.id ? 'border-sky-300 bg-sky-400/10' : 'border-white/10 bg-white/5'}`}>
                    {frame.filename}
                  </button>
                ))}
              </div>
            ) : selected ? (
              <div className="text-center" style={{ transform: `scale(${zoom})` }}>
                <div className="text-lg font-semibold">{selected.filename}</div>
                <div className="mt-1 text-sm text-zinc-400">
                  Decision: {selected.decision} · Flagged: {isFlagged(selected.decision) ? 'yes' : 'no'}
                </div>
                <div className="mt-4 text-xs text-zinc-500">Photo rendering is not wired yet in this V2 preview.</div>
              </div>
            ) : (
              <div className="text-sm text-zinc-500">No photo selected.</div>
            )}

            {/* Bottom-right cluster: zoom, grid view, one Full screen (section 1). */}
            <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-lg border border-white/10 bg-kestrel-raised/90 px-2 py-1.5">
              <label className="flex items-center gap-1 text-xs">
                Zoom
                <input type="range" min={0.5} max={2} step={0.1} value={zoom}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setZoom(Number(event.currentTarget.value))}
                  aria-label="Zoom" className="h-6 w-24" />
              </label>
              <button type="button" aria-pressed={gridView} onClick={() => setGridView((value) => !value)}
                className="rounded-md px-2 py-1 text-xs hover:bg-white/10 aria-pressed:bg-sky-400/25 focus-visible:outline-2 focus-visible:outline-sky-300">
                Grid view
              </button>
              <button type="button" aria-pressed={fullscreen} onClick={toggleFullscreen}
                className="rounded-md px-2 py-1 text-xs hover:bg-white/10 aria-pressed:bg-sky-400/25 focus-visible:outline-2 focus-visible:outline-sky-300">
                Full screen
              </button>
            </div>
          </div>

          {/* Filmstrip: real frames, real flag/unflag, real All/Flagged filter. */}
          <div className="flex h-28 shrink-0 flex-col border-t border-white/10 bg-kestrel-raised">
            <div className="flex items-center gap-2 border-b border-white/10 px-2 py-1 text-xs">
              <span className="text-zinc-400">{shown.length} of {frames.filter((f) => f.removedAt === undefined).length} photos</span>
              <div className="ml-auto flex gap-1" role="group" aria-label="Filmstrip filter">
                {(['all', 'flagged'] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={filmstripFilter === value}
                    onClick={() => setFilmstripFilter(value)}
                    className="rounded-md px-2 py-1 capitalize hover:bg-white/10 aria-pressed:bg-sky-400/25 focus-visible:outline-2 focus-visible:outline-sky-300">
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 gap-1.5 overflow-x-auto p-1.5">
              {shown.map((frame) => (
                <FilmstripThumb key={frame.id} frame={frame} selected={frame.id === selected?.id}
                  onSelect={() => selectFrame(frame.id)} onToggleFlag={() => toggleFlag(frame.id)} />
              ))}
            </div>
          </div>
        </main>

        {/* Docked-right panel column. */}
        {PANEL_IDS.filter((id) => layout[id].visible && layout[id].dock === 'right').map((id) => (
          <DockedPanel key={id} id={id} layout={layout} setLayout={setLayout} taskList={taskList} selected={selected} />
        ))}
      </div>

      {/* Floating panels render as portals above everything via FloatingPane, independent of the dock columns. */}
      {PANEL_IDS.filter((id) => layout[id].visible && layout[id].dock === 'float').map((id) => (
        <FloatingPane key={id} title={PANEL_LABEL[id]} storageKey={`v2-float-${id}`}
          onDock={() => setLayout((current) => setPanelDock(current, id, 'right'))}
          onDockTo={(side) => setLayout((current) => setPanelDock(current, id, side))}>
          <PanelBody id={id} taskList={taskList} selected={selected} />
        </FloatingPane>
      ))}
    </div>
  );
}

function DockedPanel({ id, layout, setLayout, taskList, selected }: {
  id: PanelId; layout: PanelLayout; setLayout: (fn: (current: PanelLayout) => PanelLayout) => void;
  taskList: Task[]; selected: PhotoFrame | null;
}) {
  return (
    <aside aria-label={PANEL_LABEL[id]} className="flex w-80 shrink-0 flex-col border-l border-r border-white/10 bg-kestrel-panel">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 px-2">
        <span className="text-sm font-semibold">{PANEL_LABEL[id]}</span>
        <div className="flex gap-1">
          <button type="button" title="Float this panel" aria-label={`Float ${PANEL_LABEL[id]}`}
            onClick={() => setLayout((current) => setPanelDock(current, id, 'float'))}
            className="grid h-8 w-8 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">⤢</button>
          <button type="button" title="Hide this panel" aria-label={`Hide ${PANEL_LABEL[id]}`}
            onClick={() => setLayout((current) => toggleRailPanel(current, id))}
            className="grid h-8 w-8 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">✕</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <PanelBody id={id} taskList={taskList} selected={selected} />
      </div>
    </aside>
  );
}

function PanelBody({ id, taskList, selected }: { id: PanelId; taskList: Task[]; selected: PhotoFrame | null }) {
  if (!WIRED_PANELS.has(id)) {
    return <p className="text-sm text-zinc-400">Not built yet in this V2 preview.</p>;
  }
  if (id === 'tasks') {
    if (!taskList.length) return <p className="text-sm text-zinc-400">No background tasks running.</p>;
    return (
      <ul className="space-y-2 text-sm">
        {taskList.map((task) => (
          <li key={task.id} className="rounded-md border border-white/10 p-2">
            <div className="flex justify-between gap-2"><span>{task.title}</span><span className="text-zinc-400">{task.state}</span></div>
            {task.total ? <div className="mt-1 text-xs text-zinc-400">{task.done} / {task.total}</div> : null}
            {task.detail ? <div className="mt-1 text-xs text-zinc-500">{task.detail}</div> : null}
          </li>
        ))}
      </ul>
    );
  }
  // id === 'info'
  if (!selected) return <p className="text-sm text-zinc-400">No photo selected.</p>;
  const readiness = filmstripReadiness(selected);
  return (
    <dl className="space-y-1 text-sm">
      <Row label="Filename" value={selected.filename} />
      <Row label="Decision" value={selected.decision} />
      <Row label="Readiness" value={readiness} />
      <Row label="Rating" value={selected.rating ? `${selected.rating} star${selected.rating === 1 ? '' : 's'}` : 'Unrated'} />
      <Row label="Camera" value={selected.exif.camera ?? '—'} />
      <Row label="Lens" value={selected.exif.lens ?? '—'} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-white/5 py-1">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}

function FilmstripThumb({ frame, selected, onSelect, onToggleFlag }: {
  frame: PhotoFrame; selected: boolean; onSelect: () => void; onToggleFlag: () => void;
}) {
  const flagged = isFlagged(frame.decision);
  const readiness = filmstripReadiness(frame);
  return (
    <div className={`relative flex h-full w-24 shrink-0 flex-col justify-end rounded-md border p-1 ${selected ? 'border-sky-300 bg-sky-400/10' : 'border-white/10 bg-white/5'}`}>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        className="absolute inset-0 rounded-md focus-visible:outline-2 focus-visible:outline-sky-300" aria-label={frame.filename} />
      <span className="pointer-events-none truncate text-[10px] text-zinc-300">{frame.filename}</span>
      <span className="pointer-events-none text-[9px] uppercase tracking-wide text-zinc-500">{readiness}</span>
      <button type="button" onClick={onToggleFlag} aria-pressed={flagged}
        aria-label={flagged ? `Unflag ${frame.filename}` : `Flag ${frame.filename}`}
        className="relative z-10 mt-1 self-start rounded-md px-1.5 py-0.5 text-[10px] font-medium hover:bg-white/10 aria-pressed:bg-sky-400/30 focus-visible:outline-2 focus-visible:outline-sky-300">
        {flagged ? '⚑ Flagged' : '⚐ Flag'}
      </button>
    </div>
  );
}
