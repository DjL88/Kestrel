import type { SettingsTabId, WorkspaceSettings } from './ui/contract';
import { tailoredSettings, type SetupAnswers } from '../core/quickSetup';
import { chooseLanguage, language } from '../i18n/messages';

/**
 * The bridge from quick setup into the V2 workspace. Setup can run in the launch welcome (outside the V2 React tree)
 * or from Settings, so its result is held here until the workspace takes it, like the launch intent.
 */
export interface SetupResult {
  settings: Partial<WorkspaceSettings>;
  /** Open Settings at this tab afterwards (Account to subscribe to Pro, Storage to connect a drive). */
  openTab?: SettingsTabId;
}

let pending: SetupResult | null = null;
let setupWanted = false;
const listeners = new Set<() => void>();
const notify = () => { for (const fn of [...listeners]) fn(); };

export function requestSetupResult(result: SetupResult): void {
  pending = pending ? { settings: { ...pending.settings, ...result.settings }, openTab: result.openTab ?? pending.openTab } : result;
  notify();
}

/** Returns the waiting result and clears it, so it is applied once. */
export function takeSetupResult(): SetupResult | null {
  const result = pending;
  pending = null;
  return result;
}

/** Settings → Run setup again. */
export function requestSetupAgain(): void { setupWanted = true; notify(); }
export function takeSetupAgain(): boolean { const wanted = setupWanted; setupWanted = false; return wanted; }

export function onSetupBridge(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Applies answers that came from the account (another device, or an earlier sign-in): the Flight mode and tailored
 * settings go to the workspace, and a different language restarts the app in it. Returns true when it restarts.
 */
export async function applyAccountSetup(answers: SetupAnswers): Promise<boolean> {
  requestSetupResult({ settings: { ...(answers.flightMode ? { defaultAssistMode: answers.flightMode } : {}), ...tailoredSettings(answers) } });
  if (answers.language && answers.language !== language) { chooseLanguage(answers.language); return true; }
  return false;
}
