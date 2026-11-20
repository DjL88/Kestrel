import { useState } from 'react';
import type { LicenceState } from '../providers/licenceStore';
import { checkLicenceNow, freeLicenceDevice, licenceDevices, licenceOnlineConfigured } from '../providers/licenceStore';
import type { LicenceStatus } from '../providers/licenceSync';
import { projectsText as t } from '../i18n/areas/projects';

const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-60';
const day = (ms: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(ms));
const moment = (ms: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));

const platformName = (platform: string) => ({
  windows: t.licence.platformWindows, macos: t.licence.platformMacos, web: t.licence.platformWeb, ios: t.licence.platformIos, android: t.licence.platformAndroid,
} as Record<string, string>)[platform] ?? platform;

/**
 * What the control plane last said about this device's key, and its devices. Shown only when the key is valid.
 * When this build has no control plane, it says so once and offers nothing that needs a connection.
 */
export function LicenceOnlineStatus({ licence }: { licence: Extract<LicenceState, { status: 'valid' }> }) {
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<LicenceStatus | null | 'unavailable'>(null);
  const [note, setNote] = useState<string | null>(null);
  const online = licence.online;

  let line: string;
  let alert = false;
  switch (online.kind) {
    case 'not_set_up': line = t.licence.offlineOnly; break;
    case 'not_checked': line = t.licence.pending; break;
    case 'active': line = t.licence.registered(day(online.grant.offlineUntilMs)); break;
    case 'unreachable': line = online.grant ? t.licence.notReachable(day(online.grant.offlineUntilMs)) : t.licence.pending; break;
    case 'device_limit': line = t.licence.deviceLimit; alert = true; break;
    case 'revoked': line = t.licence.revoked; alert = true; break;
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try { await work(); } finally { setBusy(false); }
  }
  const showDevices = () => run(async () => { setDevices((await licenceDevices()) ?? 'unavailable'); });

  return (
    <div className="space-y-3" data-testid="licence-online">
      <p role={alert ? 'alert' : 'status'} className={alert ? 'text-amber-200' : undefined}>{line}</p>
      {licenceOnlineConfigured() && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={action} disabled={busy} onClick={() => void run(checkLicenceNow)}>{t.licence.checkNow}</button>
            <button type="button" className={action} disabled={busy} onClick={() => void showDevices()}>{t.licence.showDevices}</button>
          </div>
          {devices === 'unavailable' && <p role="status">{t.licence.devicesUnavailable}</p>}
          {devices && devices !== 'unavailable' && (
            <section aria-labelledby="licence-devices-h" className="space-y-2">
              <h4 id="licence-devices-h" className="font-medium text-zinc-100">{t.licence.devicesTitle}</h4>
              <ul className="space-y-2">
                {devices.devices.map((device) => (
                  <li key={device.activationId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 px-3 py-2">
                    <span>
                      <strong className="font-medium text-zinc-100">{platformName(device.platform)}</strong>
                      {device.thisDevice && <> · {t.licence.thisDevice}</>}
                      <span className="block text-xs text-zinc-400">{device.appVersion} · {t.licence.lastSeen(moment(device.lastSeenMs))}</span>
                    </span>
                    <button type="button" className={action} disabled={busy} aria-label={t.licence.freeLabel(platformName(device.platform))}
                      onClick={() => {
                        if (!window.confirm(t.licence.confirmFree)) return;
                        void run(async () => {
                          const ok = await freeLicenceDevice(device.activationId);
                          setNote(ok ? t.licence.freed : t.licence.couldNotFree);
                          if (ok) setDevices((await licenceDevices()) ?? 'unavailable');
                        });
                      }}>{t.licence.free}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {note && <p role="status">{note}</p>}
        </>
      )}
    </div>
  );
}
