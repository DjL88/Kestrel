import { parseCloudHelp, type CloudHelpChoice, type CloudHelpJob } from '../core/cloudHelp';

/** The person's "cloud helps a busy device" choices, kept on this device only (Settings → Account). */
const KEY = 'kestrel.cloudHelp.v1';
type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;
const defaultStore = (): Store => (typeof localStorage === 'undefined' ? null : localStorage);

/** Unreadable or damaged storage gives the defaults ("when busy"). */
export function readCloudHelp(storage: Store = defaultStore()): Record<CloudHelpJob, CloudHelpChoice> {
  try {
    const text = storage?.getItem(KEY);
    return parseCloudHelp(text ? JSON.parse(text) : undefined);
  } catch { return parseCloudHelp(undefined); }
}

/** Saves one job's choice. Returns what is in force afterwards, which is the old value if it could not be saved. */
export function saveCloudHelp(job: CloudHelpJob, choice: CloudHelpChoice, storage: Store = defaultStore()): CloudHelpChoice {
  const next = { ...readCloudHelp(storage), [job]: choice };
  try { storage?.setItem(KEY, JSON.stringify(next)); } catch { /* keep the old value */ }
  return readCloudHelp(storage)[job];
}
