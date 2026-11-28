import { expect, test, type Page } from '@playwright/test';

/**
 * Live shoot panel (desktop app, preview `kestrel.preview.live-shoot.v1`, off by default). The browser build is made to
 * look like the desktop app by a stand-in for its native bridge that records every native command and answers the few
 * the panel uses: the folder picker, the FTP inbox and the client room. No camera, network server or file is involved,
 * so this proves the panel's behaviour and what it asks the desktop app to do, not that a real camera works.
 */
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The Live shoot panel is a desktop app feature.');

});

type Call = { cmd: string; args: Record<string, unknown> | null };

async function desktopStandIn(page: Page, options: { preview: boolean; ftpPort?: number }) {
  await page.addInitScript(({ preview, ftpPort }) => {
    try { if (preview) localStorage.setItem('kestrel.preview.live-shoot.v1', '1'); } catch { /* storage blocked */ }
    const calls: Array<{ cmd: string; args: unknown }> = [];
    let callback = 0;
    (window as unknown as { __nativeCalls: typeof calls }).__nativeCalls = calls;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++callback,
      unregisterCallback: () => undefined,
      convertFileSrc: (path: string) => path,
      invoke: async (cmd: string, args: Record<string, unknown> | undefined) => {
        calls.push({ cmd, args: args && !(args instanceof Uint8Array) ? JSON.parse(JSON.stringify(args)) : null });
        switch (cmd) {
          case 'plugin:dialog|open': return '/Shoots/Inbox';
          case 'plugin:fs|read_dir': return [];
          case 'ftp_inbox_start': return { port: ftpPort ?? (args?.port as number), addresses: ['192.168.1.20'] };
          case 'shoot_room_start': return { port: 8765, addresses: ['192.168.1.20'] };
          case 'shoot_room_take': return [];
          default: return null;
        }
      },
    };
  }, options);
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __nativeCalls: Call[] }).__nativeCalls);

async function tetheredProject(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('project-kind-tethered').click();
  await page.getByLabel(/name/i).first().fill('Studio session');
  await dialog.getByRole('button', { name: /create project/i }).last().click();
  await expect(studio.locator('.v2-filmstrip')).toBeVisible();
  return studio;
}

test('with the preview off the filmstrip keeps its separate live shoot buttons and no panel', async ({ page }) => {
  await desktopStandIn(page, { preview: false });
  const studio = await tetheredProject(page);
  await expect(studio.getByTestId('filmstrip-receive-camera')).toBeVisible();
  await expect(studio.getByTestId('filmstrip-live-shoot')).toHaveCount(0);
});

test('one Live shoot panel starts camera Wi-Fi with the same FTP settings each time, shows the room, and closing switches both off', async ({ page }) => {
  await desktopStandIn(page, { preview: true });
  const studio = await tetheredProject(page);
  // The four separate buttons give way to one.
  await expect(studio.getByTestId('filmstrip-receive-camera')).toHaveCount(0);
  await expect(studio.getByTestId('filmstrip-watch-folder')).toHaveCount(0);
  await studio.getByTestId('filmstrip-live-shoot').click();
  const panel = page.getByTestId('live-shoot-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Not yet tested with a real camera.');

  // The camera's FTP settings are shown before starting and kept on this device.
  const password = (await panel.getByTestId('live-shoot-password').textContent())!;
  expect(password).toMatch(/^[a-z2-9]{10}$/);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('kestrel.liveShoot.ftp.v1')))!)).toEqual({ user: 'inflight', password, port: 2121 });
  // A new password is offered, and kept.
  await panel.getByTestId('live-shoot-new-password').click();
  const renewed = (await panel.getByTestId('live-shoot-password').textContent())!;
  expect(renewed).not.toBe(password);

  await panel.getByTestId('live-shoot-source-ftp').check();
  await panel.getByTestId('live-shoot-room').check();
  await panel.getByTestId('live-shoot-start').click();
  await expect(panel.getByTestId('live-shoot-running')).toHaveText('Live shoot running · 0 frames so far');
  // What the camera needs: this computer's address, the saved port, user and password, and that FTP is not encrypted.
  await expect(panel.getByTestId('live-shoot-address')).toHaveText('192.168.1.20');
  await expect(panel.getByTestId('live-shoot-ftp')).toContainText(renewed);
  await expect(panel.getByTestId('live-shoot-plain-ftp')).toContainText("isn't encrypted");
  await expect(panel.getByTestId('live-shoot-port-changed')).toHaveCount(0);
  await expect(panel.getByTestId('live-shoot-room-links')).toContainText('http://192.168.1.20:8765/');

  const started = await calls(page);
  const ftpStart = started.find((call) => call.cmd === 'ftp_inbox_start');
  expect(ftpStart?.args).toMatchObject({ folder: '/Shoots/Inbox', user: 'inflight', password: renewed, port: 2121 });
  expect(started.some((call) => call.cmd === 'shoot_room_start')).toBe(true);

  // Closing the panel ends the live shoot: the FTP inbox and the room are switched off.
  await panel.getByTestId('live-shoot-close').click();
  await expect(panel).toHaveCount(0);
  await expect.poll(async () => (await calls(page)).map((call) => call.cmd)).toEqual(expect.arrayContaining(['ftp_inbox_stop', 'shoot_room_stop']));
  await expect(studio.getByTestId('filmstrip-live-folder')).toHaveCount(0);

  // Next time, the same password is offered: the camera's FTP profile still works.
  await studio.getByTestId('filmstrip-live-shoot').click();
  await expect(page.getByTestId('live-shoot-password')).toHaveText(renewed);
});

test('when the saved port is taken the panel says which port this shoot uses', async ({ page }) => {
  await desktopStandIn(page, { preview: true, ftpPort: 50123 });
  const studio = await tetheredProject(page);
  await studio.getByTestId('filmstrip-live-shoot').click();
  const panel = page.getByTestId('live-shoot-panel');
  await panel.getByTestId('live-shoot-source-ftp').check();
  await panel.getByTestId('live-shoot-start').click();
  await expect(panel.getByTestId('live-shoot-port-changed')).toContainText('port 50123');
  // Escape closes it too, and stops the shoot.
  await panel.getByTestId('live-shoot-stop').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect.poll(async () => (await calls(page)).some((call) => call.cmd === 'ftp_inbox_stop')).toBe(true);
});
