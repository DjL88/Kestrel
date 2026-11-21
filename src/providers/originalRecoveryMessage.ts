import type { OriginalPathState } from './originalPathStatus';

export interface OriginalRecoveryMessage {
  title: string;
  detail: string;
  action: 'none' | 'locate-folder' | 'check-drive' | 'grant-access';
}

/** Plain-language, non-alarming recovery copy. Never claim that a RAW is deleted. */
export function originalRecoveryMessage(state: OriginalPathState): OriginalRecoveryMessage {
  switch (state) {
    case 'available':
      return { title: 'Original available', detail: 'The photo is ready to edit.', action: 'none' };
    case 'missing':
      return { title: 'Find original folder', detail: 'This photo may have moved. Choose its folder to reconnect it without changing your edits.', action: 'locate-folder' };
    case 'permission-denied':
      return { title: 'Allow folder access', detail: 'Kite44 can see the saved location but cannot read it. Check folder permissions, then try again.', action: 'grant-access' };
    case 'unavailable':
      return { title: 'Original temporarily unavailable', detail: 'The drive or network location may be disconnected. Reconnect it to continue editing the original.', action: 'check-drive' };
  }
}
