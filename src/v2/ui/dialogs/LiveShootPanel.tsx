import React from 'react';
import type { LookPreset, WorkspaceStore } from '../contract';
import {
  ftpCredentials, readLiveShootChoice, renewFtpPassword, saveLiveShootChoice, type FtpCredentials, type LiveShootChoice, type LiveShootSource,
} from '../../../core/liveShootSettings';
import { livePanelText as T } from '../../../i18n/areas/livePanel';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';

interface Props {
  looks: LookPreset[];
  liveFolder: WorkspaceStore['liveFolder'];
  shootRoom: WorkspaceStore['shootRoom'];
  liveShootLook: string | null | undefined;
  /** USB tether is offered (its own preview is on in the desktop app). */
  usbAvailable: boolean;
  onStart: (choice: LiveShootChoice) => Promise<boolean>;
  onStop: () => void;
  onClose: () => void;
}

const deviceStorage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/**
 * Live shoot (desktop app, a preview): one panel that starts a live shoot from camera Wi-Fi (FTP), a folder or USB, with an
 * optional look added to each new frame and the client room. The camera's FTP settings stay the same on this computer
 * between shoots. The panel sits beside the photos, so culling goes on while it is open; closing it ends the live shoot
 * and switches the FTP inbox and the room off. Nothing here has been tried with a real camera, and it says so.
 */
export default function LiveShootPanel({ looks, liveFolder, shootRoom, liveShootLook, usbAvailable, onStart, onStop, onClose }: Props) {
  const [choice, setChoice] = React.useState<LiveShootChoice>(() => {
    const saved = readLiveShootChoice(deviceStorage());
    return saved.source === 'usb' && !usbAvailable ? { ...saved, source: 'ftp' } : saved;
  });
  const [credentials, setCredentials] = React.useState<FtpCredentials>(() => ftpCredentials(deviceStorage()));
  const [busy, setBusy] = React.useState(false);
  const running = Boolean(liveFolder);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => { headingRef.current?.focus(); }, []);
  const close = React.useCallback(() => { if (running) onStop(); onClose(); }, [running, onStop, onClose]);
  const update = (next: LiveShootChoice) => { setChoice(next); saveLiveShootChoice(deviceStorage(), next); };
  const ftp = liveFolder?.ftp;
  const sources: Array<{ id: LiveShootSource; label: string; hint: string }> = [
    { id: 'ftp', label: STRINGS.liveShoot.receive, hint: T.ftpHint },
    { id: 'folder', label: T.folder, hint: T.folderHint },
    ...(usbAvailable ? [{ id: 'usb' as const, label: STRINGS.liveShoot.usb, hint: T.usbHint }] : []),
  ];

  return (
    <section role="dialog" aria-modal="false" aria-labelledby="live-shoot-title" data-testid="live-shoot-panel"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}
      className="fixed bottom-24 right-4 z-[80] w-[min(26rem,calc(100vw-2rem))] max-h-[70dvh] space-y-4 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-primary)] shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <h2 id="live-shoot-title" ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">{T.title}</h2>
        <button type="button" onClick={close} data-testid="live-shoot-close" title={T.closeNote}
          className="inline-flex min-h-9 items-center gap-1 rounded border border-[var(--border-default)] px-2 text-xs font-medium hover:bg-[var(--bg-surface-hover)]">
          <BrandIcon name="close" size={12} /><span>{running ? T.close : STRINGS.liveShoot.roomClose}</span>
        </button>
      </div>
      <p className="text-[var(--text-secondary)]">{T.intro}</p>

      {!running ? (
        <>
          <fieldset className="space-y-1" disabled={busy}>
            <legend className="font-medium">{T.source}</legend>
            {sources.map((source) => (
              <label key={source.id} className="flex items-start gap-2 py-1">
                <input type="radio" name="live-shoot-source" className="mt-1" data-testid={`live-shoot-source-${source.id}`}
                  checked={choice.source === source.id} onChange={() => update({ ...choice, source: source.id })} />
                <span><span className="block font-medium">{source.label}</span><span className="block text-xs text-[var(--text-secondary)]">{source.hint}</span></span>
              </label>
            ))}
          </fieldset>

          {choice.source === 'ftp' && (
            <div className="space-y-2 rounded border border-[var(--border-subtle)] p-3" data-testid="live-shoot-ftp-preview">
              <p>{STRINGS.liveShoot.ftpIntro}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt>{STRINGS.liveShoot.ftpPort}</dt><dd className="font-mono select-all">{credentials.port}</dd>
                <dt>{STRINGS.liveShoot.ftpUser}</dt><dd className="font-mono select-all">{credentials.user}</dd>
                <dt>{STRINGS.liveShoot.ftpPassword}</dt><dd className="font-mono select-all" data-testid="live-shoot-password">{credentials.password}</dd>
                <dt>{STRINGS.liveShoot.ftpMode}</dt><dd>{STRINGS.liveShoot.ftpPassive}</dd>
              </dl>
              <p className="text-xs text-[var(--text-secondary)]">{T.ftpSame}</p>
              <button type="button" data-testid="live-shoot-new-password" onClick={() => setCredentials(renewFtpPassword(deviceStorage()))}
                className="inline-flex min-h-9 items-center rounded border border-[var(--border-default)] px-2 text-xs font-medium hover:bg-[var(--bg-surface-hover)]">
                {T.newPassword}
              </button>
              <p className="text-xs text-[var(--text-secondary)]">{T.newPasswordNote}</p>
            </div>
          )}

          <label className="block font-medium">{T.look}
            <select data-testid="live-shoot-look" disabled={busy} className="mt-1 block w-full rounded border bg-[var(--bg-surface)] p-2 font-normal"
              value={choice.lookId ?? ''} onChange={(event) => update({ ...choice, lookId: event.target.value || null })}>
              <option value="">{T.lookNone}</option>
              {looks.filter((look) => look.id !== 'none').map((look) => <option key={look.id} value={look.id}>{look.name}</option>)}
            </select>
          </label>
          <p className="text-xs text-[var(--text-secondary)]">{T.lookNote}</p>

          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" data-testid="live-shoot-room" disabled={busy} checked={choice.room}
              onChange={(event) => update({ ...choice, room: event.target.checked })} />
            <span><span className="block font-medium">{T.room}</span><span className="block text-xs text-[var(--text-secondary)]">{T.roomNote}</span></span>
          </label>

          <button type="button" data-testid="live-shoot-start" disabled={busy}
            onClick={async () => { setBusy(true); try { await onStart(choice); } finally { setBusy(false); } }}
            className="w-full min-h-11 rounded bg-[var(--brand-accent)] font-semibold text-[var(--text-on-accent)] disabled:opacity-50">
            {busy ? T.starting : T.start}
          </button>
        </>
      ) : (
        <>
          <p role="status" data-testid="live-shoot-running" className="font-medium">{T.running(liveFolder!.imported)}</p>
          {liveShootLook && <p data-testid="live-shoot-look-on">{T.lookOn(liveShootLook)}</p>}
          {ftp && (
            <div className="space-y-2 rounded border border-[var(--border-subtle)] p-3" data-testid="live-shoot-ftp">
              <p>{STRINGS.liveShoot.ftpIntro}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt>{STRINGS.liveShoot.ftpServer}</dt>
                <dd className="font-mono select-all" data-testid="live-shoot-address">{ftp.addresses.join(', ') || STRINGS.liveShoot.ftpNoAddress}</dd>
                <dt>{STRINGS.liveShoot.ftpPort}</dt><dd className="font-mono select-all">{ftp.port}</dd>
                <dt>{STRINGS.liveShoot.ftpUser}</dt><dd className="font-mono select-all">{ftp.user}</dd>
                <dt>{STRINGS.liveShoot.ftpPassword}</dt><dd className="font-mono select-all">{ftp.password}</dd>
                <dt>{STRINGS.liveShoot.ftpMode}</dt><dd>{STRINGS.liveShoot.ftpPassive}</dd>
              </dl>
              {ftp.portChanged && (
                <p className="flex items-start gap-1.5" role="alert" data-testid="live-shoot-port-changed">
                  <BrandIcon name="alert" size={14} className="mt-0.5 shrink-0" /><span>{T.portChanged(ftp.port)}</span>
                </p>
              )}
              <p className="flex items-start gap-1.5 text-xs" data-testid="live-shoot-plain-ftp">
                <BrandIcon name="alert" size={14} className="mt-0.5 shrink-0" /><span>{STRINGS.liveShoot.ftpPlain}</span>
              </p>
            </div>
          )}
          {shootRoom && (
            <div className="space-y-2 rounded border border-[var(--border-subtle)] p-3" data-testid="live-shoot-room-links">
              <p className="font-medium">{T.roomHeading}</p>
              {shootRoom.links.length
                ? <ul className="space-y-1">{shootRoom.links.map((link) => <li key={link.url} className="break-all font-mono text-base select-all">{link.url}</li>)}</ul>
                : <p>{STRINGS.liveShoot.ftpNoAddress}</p>}
              <p className="text-xs text-[var(--text-secondary)]">{STRINGS.liveShoot.roomLinksIntro} {STRINGS.liveShoot.roomPlain}</p>
            </div>
          )}
          <button type="button" data-testid="live-shoot-stop" onClick={onStop}
            className="w-full min-h-11 rounded border border-[var(--border-default)] font-semibold hover:bg-[var(--bg-surface-hover)]">
            {T.stop}
          </button>
          <p className="text-xs text-[var(--text-secondary)]">{T.closeNote}</p>
        </>
      )}
    </section>
  );
}
