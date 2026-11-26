import { expect, test, type Page } from '@playwright/test';

// Game controllers through the browser's Gamepad API (Settings > Keyboard > Game controller, on unless switched off).
// The controller is mocked: navigator.getGamepads returns a standard-layout pad the test presses buttons on.
// NOT a real controller: real Xbox, PlayStation and Switch Pro pads are not verified by this test.

async function mockGamepad(page: Page) {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const axes = [0, 0, 0, 0];
    const pad = { id: 'Test controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons, axes };
    let present = false;
    // A stick "tap" is held for exactly one read, so it is one nudge however slow the machine is (no timing in the test).
    let pulseReads = 0;
    const release = () => { axes.fill(0); for (const b of buttons) { b.pressed = false; b.value = 0; } pad.timestamp += 1; };
    const read = () => {
      if (pulseReads > 0) { pulseReads -= 1; if (pulseReads === 0) setTimeout(release, 0); }
      return [present ? pad : null, null, null, null];
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: read });
    const w = window as unknown as Record<string, unknown>;
    w.__pad = {
      connect() {
        present = true;
        const event = new Event('gamepadconnected');
        Object.defineProperty(event, 'gamepad', { value: pad });
        window.dispatchEvent(event);
      },
      button(index: number) { buttons[index].pressed = true; buttons[index].value = 1; pulseReads = 1; pad.timestamp += 1; },
      axis(index: number, value: number) { axes[index] = value; pulseReads = 1; pad.timestamp += 1; },
      settled() { return pulseReads === 0 && axes.every((v) => v === 0) && buttons.every((b) => !b.pressed); },
      reset() { pulseReads = 0; release(); },
    };
  });
}

type PadControl = { connect(): void; button(i: number): void; axis(i: number, v: number): void; settled(): boolean; reset(): void };
/** One read of the press, then let go: exactly one command, with no timing in the test. */
const settle = (page: Page) => expect.poll(() => page.evaluate(() => (window as unknown as { __pad: PadControl }).__pad.settled())).toBe(true);
const press = async (page: Page, index: number) => {
  await page.evaluate((i) => (window as unknown as { __pad: PadControl }).__pad.button(i), index);
  await settle(page);
};
const tapStick = async (page: Page, axis: number, value: number) => {
  await page.evaluate(([a, v]) => (window as unknown as { __pad: PadControl }).__pad.axis(a, v), [axis, value]);
  await settle(page);
};

async function openPhoto(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await expect(studio.getByText('No projects yet')).toBeVisible({ timeout: 30_000 });
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Game controller');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(() => {
    const image = document.createElement('canvas');
    image.width = 1200;
    image.height = 800;
    const ctx = image.getContext('2d')!;
    ctx.fillStyle = '#586b82';
    ctx.fillRect(0, 0, image.width, image.height);
    return image.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).click();
  await (await picker).setFiles([{ name: 'controller-test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  await expect(studio.getByTestId('canvas-frame')).toBeVisible();
  return studio;
}

async function openAdjust(root: ReturnType<Page['locator']>) {
  const advanced = root.getByRole('tab', { name: 'Advanced Edits' });
  if (!(await advanced.isVisible())) await root.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  await advanced.click();
  const exposure = root.getByLabel('Exposure', { exact: true });
  await expect(exposure).toBeVisible();
  return exposure;
}

test('a controller is on out of the box, does nothing when switched off, and its stick turns the slider and its buttons can be remapped', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Settings > Keyboard is laid out for desktop; the mapping is the same on every platform.');
  await mockGamepad(page);
  const root = await openPhoto(page);
  const exposure = await openAdjust(root);
  await page.evaluate(() => (window as unknown as { __pad: PadControl }).__pad.connect());

  // Settings > Keyboard > Game controller: on out of the box. Switch it off.
  await page.keyboard.press('Control+Comma');
  const settings = page.getByRole('dialog').filter({ hasText: 'Settings' }).first();
  await settings.getByRole('tab', { name: /Keyboard/ }).click();
  const toggle = settings.getByRole('switch', { name: 'Use a game controller' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);

  // Switched off: nothing reads the controller, so a pushed stick moves nothing.
  await page.evaluate(() => (window as unknown as { __pad: PadControl }).__pad.axis(0, 0.8));
  await page.waitForTimeout(500);
  await expect(exposure).toHaveValue('0');
  expect(await page.evaluate(() => (window as unknown as { __pad: PadControl }).__pad.settled())).toBe(false);
  await page.evaluate(() => (window as unknown as { __pad: PadControl }).__pad.reset());

  // Switch it back on. While Settings is open, a press is only reported.
  await page.keyboard.press('Control+Comma');
  await settings.getByRole('tab', { name: /Keyboard/ }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const status = settings.getByTestId('gamepad-status');
  await press(page, 0);
  await expect(status).toContainText('Connected: Test controller');
  await expect(status).toContainText('Last pressed: Bottom button (A, Cross) (Flag or unflag selected photos)');

  // Remap the Top button (Y) to "Rate 4 stars", and empty the Right button (B).
  await settings.getByLabel('Action for Top button (Y, Triangle)').selectOption('photo.rate4');
  await settings.getByLabel('Action for Right button (B, Circle)').selectOption('');
  await press(page, 1);
  await expect(status).toContainText('Last pressed: Right button (B, Circle) (does nothing)');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);

  // The left stick right turns Exposure up one step per push, the right stick left ten steps down.
  await tapStick(page, 0, 0.8);
  await expect(exposure).toHaveValue('0.1');
  await tapStick(page, 0, 0.8);
  await expect(exposure).toHaveValue('0.2');
  await tapStick(page, 2, -0.9);
  await expect(exposure).toHaveValue('-0.8');

  // The left shoulder is Undo and the right is Redo: the same reversible edit as a drag (nudges in a row may undo together).
  await press(page, 4);
  await expect(exposure).not.toHaveValue('-0.8');
  await press(page, 5);
  await expect(exposure).toHaveValue('-0.8');

  // The remapped Y rates 4 stars; D-pad down takes one star off (shown in the Info panel).
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  const star = (n: number) => root.getByRole('button', { name: new RegExp(`^Rate ${n} stars?$`) }).first();
  await expect(star(4)).toBeVisible();
  await press(page, 3);
  await expect(star(4)).toHaveAttribute('aria-pressed', 'true');
  await press(page, 13);
  await expect(star(3)).toHaveAttribute('aria-pressed', 'true');

  // The set-up is kept for next time.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('inflight-v2-gamepad') ?? '{}'));
  expect(saved.Y).toBe('photo.rate4');
  expect(saved.B).toBeNull();
});
