import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Docked panels and the split canvas are desktop layouts.');
});

async function openWith(page: Page, name: string, width: number, height: number) {
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const png = await page.evaluate(([w, h]) => {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#2f4a63'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d07040'; ctx.fillRect(w * 0.4, h * 0.25, w * 0.2, h * 0.5);
    return canvas.toDataURL('image/png').split(',')[1];
  }, [width, height]);
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([{ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }]);
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1, { timeout: 30000 });
  return root;
}

test('?v2 panel dock left, dock right and float sit behind one … menu, never as arrows beside Undo', async ({ page }) => {
  const root = await openWith(page, 'Dock menu', 900, 600);
  await root.getByRole('button', { name: 'Co-pilot', exact: true }).first().click();
  const panel = root.getByRole('region', { name: 'Co-pilot panel' });
  await expect(panel).toBeVisible();
  // No bare dock arrows in the header any more.
  await expect(panel.getByRole('button', { name: /^Dock .* (left|right)$/ })).toHaveCount(0);
  const more = panel.getByTestId('dock-panel-menu');
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');
  const startDock = await panel.getAttribute('data-dock');
  await more.click();
  const menu = root.getByTestId('dock-panel-menu-list');
  await expect(menu.getByRole('menuitemradio')).toHaveText([/Dock left/, /Dock right/, /Float window/]);
  // The current place is marked by state (and a tick), not only by colour.
  await expect(menu.getByRole('menuitemradio', { checked: true })).toHaveCount(1);
  await expect(root.getByTestId(`dock-panel-${startDock}`)).toHaveAttribute('aria-checked', 'true');
  // Escape closes it without moving the panel.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(panel).toHaveAttribute('data-dock', startDock!);
  // Float, then dock it back to the left.
  await more.click();
  await root.getByTestId('dock-panel-float').click();
  await expect(panel).toHaveAttribute('data-dock', 'float');
  await panel.getByTestId('dock-panel-menu').click();
  await root.getByTestId('dock-panel-left').click();
  await expect(panel).toHaveAttribute('data-dock', 'left');
});

test('?v2 dragging a split photo outside Crop moves the frames, not the picture inside them', async ({ page }) => {
  const root = await openWith(page, 'Split drag', 1500, 600);
  await root.getByTestId('split-menu-button').click();
  await root.getByTestId('split-menu-split').click();
  const pane = root.getByTestId('split-frame-0');
  await expect(pane).toBeVisible();
  const picture = pane.locator('img, canvas').first();
  await expect(picture).toBeVisible();
  const pictureStyle = () => picture.evaluate((el) => (el as HTMLElement).style.cssText);
  const beforeStyle = await pictureStyle();
  const beforeBox = (await root.getByTestId('split-composition').boundingBox())!;
  const at = (await pane.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 60, at.y + at.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  const afterBox = (await root.getByTestId('split-composition').boundingBox())!;
  expect(afterBox.x - beforeBox.x).toBeGreaterThan(30);
  expect(afterBox.y - beforeBox.y).toBeGreaterThan(10);
  // The photograph keeps its place inside the frames.
  expect(await pictureStyle()).toBe(beforeStyle);
  // A drag is not a click: the frame is not selected by it.
  await expect(pane).toHaveAttribute('aria-pressed', 'false');
});
