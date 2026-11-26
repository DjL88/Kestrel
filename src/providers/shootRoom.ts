import { roomKey, roomLinks, type RoomLink } from '../core/shootRoom';
import type { SharedMarks } from '../core/sharedMarks';
import { isDesktopApp } from './desktopShell';

/**
 * The live shoot room's app side (desktop): opens the room on this computer (src-tauri/src/shoot_room.rs), shows frames
 * in it as screen-sized JPEGs, keeps their stars and picks current, and collects what people in the room marked.
 */
export const SHOOT_ROOM_PORT = 8765;

export interface ShootRoomLinks { links: RoomLink[]; port: number }

export const canOpenShootRoom = () => isDesktopApp();

async function invoke<T>(command: string, args?: Record<string, unknown>, options?: { headers: Record<string, string> }): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(command, args, options);
}

export async function openShootRoom(title: string): Promise<ShootRoomLinks> {
  const key = roomKey();
  try {
    const info = await invoke<{ port: number; addresses: string[] }>('shoot_room_start', { key, title, port: SHOOT_ROOM_PORT });
    return { port: info.port, links: roomLinks(info.addresses, info.port, key) };
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'The shoot room could not open.');
  }
}

export const closeShootRoom = () => invoke('shoot_room_stop').catch(() => undefined);

export function showInRoom(frame: { id: string; name: string; marks: SharedMarks; cameraPreview: boolean }, jpeg: Uint8Array): Promise<boolean> {
  return invoke<boolean>('shoot_room_put', jpeg as unknown as Record<string, unknown>, { headers: {
    'x-frame-id': frame.id, 'x-frame-name': encodeURIComponent(frame.name), 'x-frame-rating': String(frame.marks.rating),
    'x-frame-decision': frame.marks.decision, 'x-frame-camera': frame.cameraPreview ? '1' : '0',
  } }).catch(() => false);
}

export const updateRoomMarks = (id: string, marks: SharedMarks, removed = false) =>
  invoke<boolean>('shoot_room_marks', { id, rating: marks.rating, decision: marks.decision, removed }).catch(() => false);

export const takeRoomMarks = () => invoke<string[]>('shoot_room_take').catch(() => [] as string[]);
