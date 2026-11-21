import { exportOpener } from './helpers';
import { expect, test } from '@playwright/test';

test('phone layouts stay inside the device viewport in portrait and landscape', async ({ page }) => {
  test.skip(test.info().project.name !== 'phone', 'Device viewport acceptance test');
  const checkViewport = async (label: string) => {
    const metrics = await page.evaluate(() => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const root = document.getElementById('root')!;
      const bounds = root.getBoundingClientRect();
      return {
        width, height, rootWidth: bounds.width, rootHeight: bounds.height,
        docWidth: document.documentElement.scrollWidth,
        docHeight: document.documentElement.scrollHeight,
        bodyWidth: document.body.scrollWidth,
      };
    });
    expect(metrics.rootWidth, label).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.rootHeight, label).toBeLessThanOrEqual(metrics.height + 1);
    expect(metrics.docWidth, label).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.docHeight, label).toBeLessThanOrEqual(metrics.height + 1);
    expect(metrics.bodyWidth, label).toBeLessThanOrEqual(metrics.width + 1);
  };

  await page.goto('/');
  await checkViewport('Projects portrait');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Display and layout settings' })).toBeVisible();
  // A phone must never advertise a physical Macro Pad configuration workflow.
  await expect(page.getByRole('dialog', { name: 'Display and layout settings' }).getByRole('button', { name: /Macro pad/i })).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Display and layout settings' }).getByRole('button', { name: 'Done' }).click();
  await checkViewport('Projects appearance sheet closed');
  await page.getByRole('button', { name: 'New project' }).click();
  await checkViewport('Project wizard portrait');
  await page.getByRole('textbox', { name: 'Project name' }).fill('Viewport regression');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await checkViewport('Empty library portrait');
  // Configure handedness in Settings and check that the shared choice carries into Edit.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const libraryAppearance = page.getByRole('dialog', { name: 'Display and layout settings' });
  await libraryAppearance.getByRole('button', { name: 'Left-handed' }).click();
  await libraryAppearance.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  const images = await page.evaluate(() => Array.from({ length: 3 }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 160;
    const context = canvas.getContext('2d')!;
    context.fillStyle = ['#486782', '#82564b', '#59835a'][i];
    context.fillRect(0, 0, 240, 160);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByTestId('local-file-input').setInputFiles(images.map((encoded, i) => ({
    name: `mobile-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64'),
  })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible();
  await checkViewport('Imported library portrait');
  const checkExport = async (placement: 'footer' | 'header') => {
    const button = exportOpener(page);
    await expect(button).toHaveCount(1);
    await expect(button).toBeEnabled();
    const bounds = (await button.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    if (placement === 'footer') expect(bounds.y).toBeGreaterThan(viewport.height - 90);
    else expect(bounds.y).toBeLessThan(70);
    await button.focus();
    await button.click();
    const dialog = page.getByRole('dialog', { name: /export/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close export' }).click();
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  };
  await checkExport('footer');
  // At 799px Review must still use its compact footer, matching the editor sheet.
  await page.setViewportSize({ width: 799, height: 700 });
  await checkViewport('Foldable Review');
  await checkExport('footer');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const foldableFileMenu = page.locator('#workspace-options');
  await expect(foldableFileMenu).toBeVisible();
  await expect(foldableFileMenu.getByRole('button', { name: 'Save ratings and tags (XMP)…' })).toBeVisible();
  await expect(foldableFileMenu.getByRole('button', { name: /Import.*XMP/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 700 });

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Editor actions' })).toBeVisible();
  await checkViewport('Editor portrait');
  await checkExport('footer');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const appearance = page.getByRole('dialog', { name: 'Display and layout settings' });
  await expect(appearance.getByRole('button', { name: 'Left-handed' })).toHaveAttribute('aria-pressed', 'true');
  await appearance.getByRole('button', { name: 'Right-handed' }).click();
  await expect(appearance.getByRole('button', { name: 'Right-handed' })).toHaveAttribute('aria-pressed', 'true');
  // The softer dark theme is the default now (#336), so switch to the other dark theme to prove a change applies.
  await appearance.getByRole('radio', { name: 'Classic dark' }).check();
  await appearance.getByRole('button', { name: 'Done' }).click();
  await checkViewport('Editor with changed appearance settings');

  // Long action rows must scroll horizontally inside their own containers,
  // not enlarge the page or push the photo out of view.
  const top = page.getByRole('toolbar', { name: 'Editor actions' });
  await expect(top).toHaveCSS('overflow-x', 'auto');
  await page.setViewportSize({ width: 667, height: 375 });
  await checkViewport('Editor landscape');
  await checkExport('footer');
  const editLayout = () => page.evaluate(() => {
    const editor = document.querySelector('section[aria-label="Photo editor"]');
    const layout = [...(editor?.children ?? [])].find((child) => (child as HTMLElement).className.includes('workspace:flex-row'));
    return layout ? getComputedStyle(layout).flexDirection : 'missing';
  });
  expect(await editLayout()).toBe('column');
  await page.setViewportSize({ width: 860, height: 480 });
  await expect.poll(editLayout).toBe('row');
  await checkViewport('Wide short landscape editor');
  await page.setViewportSize({ width: 839, height: 480 });
  await expect.poll(editLayout).toBe('column');
  await checkViewport('Narrow short landscape editor');
  await page.setViewportSize({ width: 667, height: 375 });
  await expect.poll(editLayout).toBe('column');
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  await checkViewport('Editor small phone');
  await checkExport('footer');
  await page.setViewportSize({ width: 799, height: 700 });
  await checkViewport('Foldable narrow window stays compact');
  await checkExport('footer');
  await expect.poll(editLayout).toBe('column');
  await page.setViewportSize({ width: 800, height: 700 });
  await checkViewport('Foldable unfolded tablet-width editor');
  await expect.poll(editLayout).toBe('row');
  await page.setViewportSize({ width: 850, height: 700 });
  await checkViewport('Foldable unfolded workspace');
  await expect.poll(editLayout).toBe('row');
  await page.setViewportSize({ width: 320, height: 568 });
  const essentialTabs = page.getByRole('tablist', { name: 'Editing tools' });
  // The cover-screen icon rail must preserve meaningful accessible names.
  if (await essentialTabs.count()) {
    const tabs = essentialTabs.getByRole('tab');
    expect(await tabs.count()).toBeGreaterThan(3);
    for (const tab of await tabs.all()) expect(await tab.getAttribute('aria-label')).toBeTruthy();
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await checkViewport('Tablet landscape');
  await checkExport('header');
  expect(await editLayout()).toBe('row');
  // A landscape tablet must expose the same side-panel editing workspace as desktop.
  await expect(page.getByTestId('editor-responsive-layout')).toHaveCSS('flex-direction', 'row');
  await page.setViewportSize({ width: 1180, height: 820 });
  await checkViewport('Large unfolded book-style display');
  await expect(page.getByTestId('editor-responsive-layout')).toHaveCSS('flex-direction', 'row');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Display and layout settings' })
    .getByRole('button', { name: 'Right-handed' })).toHaveAttribute('aria-pressed', 'true');
});
