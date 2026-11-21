import { openPhotoInfo, subjectTab } from './helpers';
import { expect, test } from '@playwright/test';

async function makeProject(page: import('@playwright/test').Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
}

test('grid actions are reachable at every width and never run off the screen', async ({ page }) => {
  await makeProject(page, 'Menus');
  for (const name of ['Add photos to project', 'Edit', 'Export']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  const phone = page.viewportSize()!.width < 768;
  // On a phone the actions sit in a footer within thumb reach, and More opens the rest as a sheet above it.
  if (phone) {
    const footer = page.getByRole('toolbar', { name: 'Photo actions' });
    const box = (await footer.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 2);
    await expect(page.getByRole('banner').getByRole('button', { name: 'Workspace options' })).toHaveCount(0);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const sheet = page.locator('#workspace-options');
    await expect(sheet).toBeVisible();
    expect((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height).toBeLessThanOrEqual(box.y + 1);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  }
});

test('workspace selectors use a single shared chevron', async ({ page }) => {
  await makeProject(page, 'Workspace selectors');
  const phone = page.viewportSize()!.width < 768;
  await page.getByRole('button', { name: phone ? 'More' : 'Workspace options', exact: true }).click();
  const menu = page.locator('#workspace-options');

  for (const name of ['Show photos', 'View']) {
    const select = menu.getByRole('combobox', { name, exact: true });
    await expect(select).toBeVisible();
    await expect(select).toHaveCSS('appearance', 'none');
    await expect(select).toHaveCSS('background-image', /data:image\/svg\+xml/);
    await expect(select.locator('..').locator('svg')).toHaveCount(0);
  }
});

test('the editor can go full screen and come back', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'f.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  const full = page.locator('[data-filmstrip-dock]').getByRole('button', { name: 'Full screen', exact: true });
  test.skip(!(await full.count()) || page.viewportSize()!.width < 768, 'This browser does not allow full screen, and phones do not offer it');
  await full.click();
  await expect(page.getByRole('button', { name: 'Leave full screen' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Leave full screen' }).click();
  await expect(page.locator('[data-filmstrip-dock]').getByRole('button', { name: 'Full screen', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('rating filter is one row of stars: tap sets, tap again clears, the symbol flips to exactly', async ({ page }) => {
  await makeProject(page, 'Stars');
  // On a phone the Filter button lives in the menu sheet; either way it opens a popover with the rating row in it.
  if (page.viewportSize()!.width < 768) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.locator('#workspace-options')).toBeVisible();
  }
  // Locate by the stable aria-controls attribute, not accessible name: the name itself changes once a filter
  // count badge appears, and plain "Filter" text can also appear inside "Clear filters".
  // The bar and the phone menu sheet each render one; use the one in the sheet on a phone.
  const phone = page.viewportSize()!.width < 768;
  const filterTrigger = (phone ? page.locator('#workspace-options') : page)
    .locator('button[aria-controls="filter-popover"]:visible').first();
  await filterTrigger.click();
  const ratingGroup = page.getByRole('group', { name: 'Filter by rating' });
  await expect(ratingGroup).toBeVisible();
  const three = ratingGroup.getByRole('button', { name: '3 stars or more' });
  await three.click();
  await expect(three).toHaveAttribute('aria-pressed', 'true');
  await ratingGroup.getByRole('button', { name: /Matching this rating or more/ }).click();
  await expect(ratingGroup.getByRole('button', { name: 'Exactly 3 stars' })).toHaveAttribute('aria-pressed', 'true');
  await ratingGroup.getByRole('button', { name: 'Exactly 3 stars' }).click();
  await expect(ratingGroup.getByRole('button', { name: 'Exactly 3 stars' })).toHaveAttribute('aria-pressed', 'false');
});

test('editor: Export is a header button on every screen, never a tab, and tabs stack icon over label', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'f.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  const phone = page.viewportSize()!.width < 768;
  await expect(page.getByRole('tab', { name: 'Export' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Export/ }).filter({ visible: true })).toHaveCount(1);
  const tab = (await page.getByRole('tab', { name: 'Crop' }).boundingBox())!;
  const icon = (await page.getByRole('tab', { name: 'Crop' }).locator('svg').boundingBox())!;
  const label = (await page.getByRole('tab', { name: 'Crop' }).locator('span').boundingBox())!;
  expect(icon.y + icon.height, 'icon sits above the label').toBeLessThanOrEqual(label.y + 1);
  expect(tab.height).toBeGreaterThanOrEqual(48);
});

test('subject panel: pick a kind, add tags by typing and with quick words, remove one', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'f.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  // The subject and tag controls are in Photo info, in the library. Wait for the editor to open, then go there.
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  await openPhotoInfo(page);
  await subjectTab(page);
  const panel = page.getByRole('region', { name: 'What is in this photo' });
  await expect(panel.getByRole('button', { name: 'Bird' })).toHaveCount(0); // quick tags wait for a kind
  await panel.getByRole('button', { name: 'Wildlife' }).click();
  await expect(panel.getByRole('button', { name: 'Wildlife' })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: /Bird of prey/ }).click();
  await subjectTab(page);
  await panel.getByLabel('Add a tag').fill('Red Kite, red kite, Moorland');
  await page.keyboard.press('Enter');
  const tags = panel.getByRole('list', { name: 'Tags' }).getByRole('listitem');
  await expect(tags).toHaveText(['Bird of prey', 'Red Kite', 'Moorland']);
  await expect(panel.getByRole('button', { name: /Bird of prey/ })).toHaveCount(1); // only the chip's remove button, not a quick word again
  await panel.getByRole('button', { name: 'Remove tag Red Kite' }).click();
  await expect(tags).toHaveText(['Bird of prey', 'Moorland']);
  // The kind and tags survive closing and reopening Photo info.
  await page.getByRole('button', { name: 'Close photo info' }).click();
  await openPhotoInfo(page);
  await subjectTab(page);
  await expect(page.getByRole('region', { name: 'What is in this photo' }).getByRole('button', { name: 'Wildlife' })).toHaveAttribute('aria-pressed', 'true');
  await expect(tags).toHaveText(['Bird of prey', 'Moorland']);
});

test('phone editing: one big slider, chips to choose, nudge and reset, and the full list one tap away', async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, 'Quick adjust is the phone layout');
  await page.goto('/');
  await page.getByTestId('quick-edit-input').setInputFiles({
    name: 'f.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  const quick = page.getByRole('region', { name: 'Quick adjust' });
  await expect(quick).toBeVisible();
  // Exposure is first. The slider, its buttons and the chips are all big enough for a thumb.
  const slider = quick.getByRole('slider', { name: 'Exposure adjustment' });
  await expect(slider).toBeVisible();
  for (const name of ['Lower Exposure', 'Raise Exposure', 'Reset Exposure', 'Step back', 'Step forward']) {
    const box = (await quick.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.height, `${name} is thumb sized`).toBeGreaterThanOrEqual(44);
  }
  await quick.getByRole('button', { name: 'Raise Exposure' }).click();
  await expect(slider).toHaveValue('0.1');
  await expect(quick.getByText('0.04 EV')).toBeVisible();
  // Choose another adjustment from the chips, nudge it, and the first one shows it has been changed.
  await quick.getByRole('button', { name: 'Contrast, unchanged', exact: true }).click();
  await quick.getByRole('button', { name: 'Raise Contrast' }).click();
  await expect(quick.getByRole('slider', { name: 'Contrast adjustment' })).toHaveValue('0.05');
  await expect(quick.getByRole('button', { name: 'Exposure, adjusted' }).getByLabel('Adjusted')).toBeVisible();
  await expect(quick.getByRole('button', { name: 'Contrast, adjusted' })).toBeVisible();
  await quick.getByRole('button', { name: 'Reset Contrast' }).click();
  await expect(quick.getByRole('slider', { name: 'Contrast adjustment' })).toHaveValue('0');
  // Stepping back undoes the Exposure change.
  await quick.getByRole('button', { name: 'Step back' }).click();
  // The full list is still there.
  await quick.getByRole('button', { name: 'All controls' }).click();
  await expect(page.getByRole('button', { name: 'Back to quick adjust' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Texture adjustment' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to quick adjust' }).click();
  await expect(quick).toBeVisible();
});

test('File, Edit and View organise actions; show/hide controls stay together in View', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'phones hide XMP and layout options; the footer has Export');
  await makeProject(page, 'View menu organisation');
  const onPhone = page.viewportSize()!.width < 768;
  await page.getByRole('button', { name: onPhone ? 'More' : 'Workspace options', exact: true }).click();
  const menu = page.locator('#workspace-options');
  await expect(menu.getByRole('heading', { name: 'File', exact: true })).toBeVisible();
  await expect(menu.getByRole('heading', { name: 'Edit', exact: true })).toBeVisible();
  const view = menu.locator('details').filter({ hasText: 'View · show or hide' });
  await expect(view).toHaveCount(1);
  await view.locator('summary').click();
  await expect(view.getByRole('checkbox', { name: 'Show filmstrip' })).toBeVisible();
  await expect(view.getByRole('checkbox', { name: 'Photo info', exact: true })).toBeVisible();
  await expect(view.getByRole('checkbox', { name: 'Photo-only view (F)' })).toBeVisible();
  // The keyboard shortcut guide is not offered on a phone (no keyboard).
  await expect(view.getByRole('checkbox', { name: 'Show shortcut guide' })).toBeVisible({ visible: !onPhone });
  await expect(view.getByRole('button', { name: 'Group or ungroup bursts' })).toBeVisible();
  const info = view.getByRole('checkbox', { name: 'Photo info', exact: true });
  await info.check();
  await expect(info).toBeChecked();
  await info.uncheck();
  await expect(info).not.toBeChecked();
  // Photo info is a View toggle, not a duplicate action in Photos.
  await expect(menu.locator('#menu-selection').getByRole('button', { name: 'Photo info' })).toHaveCount(0);
  await menu.getByText('Culling settings', { exact: true }).click();
  await expect(menu.locator('details').filter({ hasText: 'Culling settings' })
    .getByRole('checkbox', { name: 'Show shortcut guide' })).toHaveCount(0);
});

test('File menu saves selected ratings/tags as XMP without the photo Export dialog', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'phones hide XMP and layout options; the footer has Export');
  await makeProject(page, 'Portable photo metadata');
  const phone = page.viewportSize()!.width < 768;
  const openMenu = async () => {
    await page.getByRole('button', { name: phone ? 'More' : 'Workspace options', exact: true }).click();
    return page.locator('#workspace-options');
  };
  let menu = await openMenu();
  const fileItem = menu.getByRole('button', { name: 'Save ratings and tags (XMP)…' });
  await expect(fileItem).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({
    name: 'bird.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: /To review 1/ })).toBeVisible({ timeout: 30_000 });
  menu = await openMenu();
  const action = menu.getByRole('button', { name: 'Save ratings and tags (XMP)…' });
  await expect(action).toBeEnabled();
  await expect(action).toHaveAttribute('title', /original|separately|apart/i);
  const download = page.waitForEvent('download');
  await action.click();
  expect((await download).suggestedFilename()).toBe('bird.xmp');
  // The image Export dialog is not needed to save just portable culling metadata.
  await expect(page.getByText('XMP sidecars', { exact: true })).toHaveCount(0);
});

test('File menu imports a matching XMP into the selected photo without changing its original file', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'phones hide XMP and layout options; the footer has Export');
  await makeProject(page, 'Restore photo metadata');
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({
    name: 'bird.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: /To review 1/ })).toBeVisible({ timeout: 30_000 });
  const phone = page.viewportSize()!.width < 768;
  await page.getByRole('button', { name: phone ? 'More' : 'Workspace options', exact: true }).click();
  await expect(page.locator('#workspace-options').getByRole('button', { name: 'Import ratings and tags (XMP)…' })).toBeEnabled();
  const xmp = `<?xml version="1.0" encoding="UTF-8"?>
    <x:xmpmeta xmlns:x="adobe:ns:meta/">
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/"
          xmlns:xmpDM="http://ns.adobe.com/xmp/1.0/DynamicMedia/" xmp:Rating="5" xmpDM:pick="1"/>
      </rdf:RDF>
    </x:xmpmeta>`;
  // Upload through the exact File-menu picker; no Photo Info detour.
  await page.getByTestId('file-menu-xmp-import').setInputFiles({
    name: 'bird.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(xmp),
  });
  await expect(page.getByText(/Imported XMP for 1 selected photo/)).toBeVisible();
  await expect(page.getByText('XMP sidecars', { exact: true })).toHaveCount(0);
});
