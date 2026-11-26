import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { isRawPreviewFile } from '../../core/rawFormats';
import { marksOf, sameMarks, type SharedMarks } from '../../core/sharedMarks';
import { combineRoomMark, readRoomMark, type RoomLink } from '../../core/shootRoom';
import type { CullingState, PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadImage } from '../../providers/loadImage';
import { closeShootRoom, openShootRoom, showInRoom, takeRoomMarks, updateRoomMarks } from '../../providers/shootRoom';

/** Long edge of a frame in the room: enough for an iPad or a studio TV, far from the full photograph. */
const ROOM_EDGE = 1600;
/** Frames already in the project when the room opens that are shown too (the newest ones). */
const BACKLOG = 60;
const PER_LOOK = 4;

async function roomJpeg(frame: PhotoFrame, provider: BrowserPreviewProvider): Promise<Uint8Array | null> {
  const url = await provider.getFullPreviewUrl(frame, 'background');
  if (!url) return null;
  const image = await loadImage(url);
  const scale = Math.min(1, ROOM_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export interface ShootRoomView { links: RoomLink[]; shown: number }

/**
 * Live shoot room (desktop): shows the open project's frames on other screens on this network, newest as they land,
 * and brings back the stars and picks people make there, combined with the photographer's own (never overwriting a
 * change the photographer made meanwhile; when that happens it says so).
 */
export function useShootRoom(options: {
  stateRef: MutableRefObject<CullingState | null>;
  provider: MutableRefObject<BrowserPreviewProvider | null>;
  projectId: string | null;
  /** Photos the filmstrip does not show on their own (the JPEG half of a RAW+JPEG pair). */
  hidden: (photoId: string) => boolean;
  apply: (photoId: string, marks: SharedMarks) => void;
  onKeptYours: (count: number) => void;
  onProblem: (message: string) => void;
}) {
  const [room, setRoom] = useState<(ShootRoomView & { projectId: string }) | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const shown = useRef(new Map<string, SharedMarks>());
  const tried = useRef(new Set<string>());
  const timer = useRef<number | null>(null);
  const live = useRef(false);

  const close = useCallback(() => {
    live.current = false;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    shown.current.clear();
    tried.current.clear();
    setRoom((current) => { if (current) void closeShootRoom(); return null; });
  }, []);

  const look = useCallback(async () => {
    const { stateRef, provider, hidden, apply, onKeptYours } = latest.current;
    const state = stateRef.current;
    if (state && provider.current) {
      const frames = state.frames.filter((frame) => frame.removedAt == null && !hidden(frame.id)).sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      const present = new Set(frames.map((frame) => frame.id));
      for (const [id] of shown.current) {
        if (!present.has(id)) { shown.current.delete(id); void updateRoomMarks(id, marksOf({}), true); }
      }
      for (const frame of frames) {
        const before = shown.current.get(frame.id);
        const now = marksOf(frame);
        if (before && !sameMarks(before, now)) { shown.current.set(frame.id, now); void updateRoomMarks(frame.id, now); }
      }
      const waiting = frames.slice(-BACKLOG).filter((frame) => !shown.current.has(frame.id) && !tried.current.has(frame.id)).slice(0, PER_LOOK);
      for (const frame of waiting) {
        if (!live.current) return;
        tried.current.add(frame.id);
        const jpeg = await roomJpeg(frame, provider.current).catch(() => null);
        if (!jpeg || !live.current) continue;
        const marks = marksOf(frame);
        const cameraPreview = isRawPreviewFile(frame.filename) && !provider.current.isDeveloped(frame.stableKey);
        if (await showInRoom({ id: frame.id, name: frame.filename, marks, cameraPreview }, jpeg)) shown.current.set(frame.id, marks);
      }
      let kept = 0;
      for (const text of await takeRoomMarks()) {
        const mark = readRoomMark(text);
        const frame = mark && stateRef.current?.frames.find((candidate) => candidate.id === mark.id && candidate.removedAt == null);
        if (!mark || !frame) continue;
        const outcome = combineRoomMark(marksOf(frame), mark);
        if (outcome.kind === 'apply') apply(frame.id, outcome.marks);
        else if (outcome.kind === 'kept-photographer') kept++;
      }
      if (kept) onKeptYours(kept);
      setRoom((current) => (current && current.shown !== shown.current.size ? { ...current, shown: shown.current.size } : current));
    }
    if (live.current) timer.current = window.setTimeout(() => { void look(); }, 2000);
  }, []);

  const open = useCallback(async (title: string) => {
    const projectId = latest.current.projectId;
    if (!projectId) return;
    try {
      const opened = await openShootRoom(title);
      shown.current.clear();
      tried.current.clear();
      live.current = true;
      setRoom({ projectId, links: opened.links, shown: 0 });
      void look();
    } catch (error) {
      latest.current.onProblem(error instanceof Error ? error.message : String(error));
    }
  }, [look]);

  // A room belongs to the project it was opened in.
  useEffect(() => { if (room && room.projectId !== options.projectId) close(); }, [room, options.projectId, close]);
  useEffect(() => () => { live.current = false; if (timer.current !== null) window.clearTimeout(timer.current); void closeShootRoom(); }, []);

  return { room: room && room.projectId === options.projectId ? { links: room.links, shown: room.shown } : null, open, close };
}
