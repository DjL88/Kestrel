import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'the V2 phone layout is checked in a later slice');
});

async function lightHub(page: Page) {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await expect(root).toBeVisible();
  const toLight = root.getByRole('button', { name: 'Switch to light theme' });
  if (await toLight.isVisible()) await toLight.click();
  await expect(root).toHaveAttribute('data-v2-theme', 'light');
  return root;
}

test('?v2 projects sort menu opens in the light page colours and is keyboard usable', async ({ page }) => {
  const root = await lightHub(page);
  const sort = root.getByTestId('project-sort');
  await expect(sort).toHaveAccessibleName(/Sort projects.*Last edited/);
  await sort.click();
  const list = root.getByRole('listbox', { name: 'Sort projects' });
  await expect(list).toBeVisible();
  // The menu is drawn by the page, in the light surface colour, never the dark native popup.
  const background = await list.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe('rgb(255, 255, 255)');
  await expect(list.getByRole('option', { name: 'Last edited' })).toHaveAttribute('aria-selected', 'true');
  await list.getByRole('option', { name: 'Name A–Z' }).click();
  await expect(list).toHaveCount(0);
  await expect(sort).toHaveAccessibleName(/Name A–Z/);
  // Keyboard: open with the arrow, move, choose with Enter; Escape closes without changing.
  await sort.focus();
  await page.keyboard.press('ArrowDown');
  // The menu takes focus once it is drawn; keys pressed before that still go to the button.
  await expect(list).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(sort).toHaveAccessibleName(/Most photos/);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(root.getByRole('listbox', { name: 'Sort projects' })).toHaveCount(0);
  await expect(sort).toBeFocused();
  // Any native select left in V2 follows the light theme too.
  expect(await root.evaluate((el) => {
    const select = document.createElement('select'); el.appendChild(select);
    const scheme = getComputedStyle(select).colorScheme; select.remove(); return scheme;
  })).toBe('light');
});

test('?v2 new project types are pictured, named in plain words and marked without colour alone', async ({ page }) => {
  const root = await lightHub(page);
  await root.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog');
  const shoot = dialog.getByRole('radio', { name: /Photo shoot/ });
  const collage = dialog.getByRole('radio', { name: /Collage or album/ });
  await expect(shoot).toBeChecked();
  await expect(dialog.getByTestId('project-kind-photography').locator('svg').first()).toBeVisible();
  await expect(dialog.getByTestId('project-kind-photography').getByText('Selected')).toBeVisible();
  await dialog.getByTestId('project-kind-collage').click();
  await expect(collage).toBeChecked();
  await expect(dialog.getByTestId('project-kind-collage').getByText('Selected')).toBeVisible();
  await expect(dialog.getByTestId('project-kind-photography').getByText('Selected')).toHaveCount(0);
  // Keyboard still moves between the two choices.
  await collage.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(shoot).toBeChecked();
});

test('?v2 footer logo is a modest size', async ({ page }) => {
  const root = await lightHub(page);
  const box = await root.getByTestId('inflight-footer-kite').boundingBox();
  expect(box?.height ?? 0).toBeLessThanOrEqual(32);
  expect(box?.height ?? 0).toBeGreaterThan(20);
});

test('?v2 zoom controls sit in the info bar under the photo, every button with a visible word', async ({ page }) => {
  await page.goto('/?v2&stub=1&autostart=1');
  const root = page.locator('.inflight-v2');
  const bar = root.getByTestId('canvas-viewport-controls');
  await expect(bar).toBeVisible();
  await expect(root.getByTestId('canvas-status').getByTestId('canvas-viewport-controls')).toHaveCount(1);
  for (const button of await bar.getByRole('button').all()) {
    expect(((await button.innerText()) || '').trim().length, 'a button with no visible text').toBeGreaterThan(0);
  }
  await expect(root.getByTestId('zoom-bar-grip')).toHaveCount(0);
});
