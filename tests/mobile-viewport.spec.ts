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
  await page.getByRole('button', { name: 'Appearance and layout settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Appearance and layout settings' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Appearance and layout settings' }).getByRole('button', { name: 'Done' }).click();
  await checkViewport('Projects appearance sheet closed');
  await page.getByRole('button', { name: 'New project' }).click();
  await checkViewport('Project wizard portrait');
  await page.getByRole('textbox', { name: 'Project name' }).fill('Viewport regression');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await checkViewport('Empty library portrait');
  // The Library More menu exposes the same handedness setting used by the Editor.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Left side' })).toBeVisible();
  await page.getByRole('button', { name: 'Left side' }).click();
  await expect(page.getByRole('button', { name: 'Left side' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'More', exact: true }).click();

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

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Editor actions' })).toBeVisible();
  await checkViewport('Editor portrait');
  await page.getByRole('button', { name: 'Appearance and layout settings' }).click();
  const appearance = page.getByRole('dialog', { name: 'Appearance and layout settings' });
  await expect(appearance.getByRole('button', { name: 'Left side' })).toHaveAttribute('aria-pressed', 'true');
  await appearance.getByRole('button', { name: 'Right side' }).click();
  await expect(appearance.getByRole('button', { name: 'Right side' })).toHaveAttribute('aria-pressed', 'true');
  await appearance.getByRole('radio', { name: 'Night (dimmer, softer)' }).check();
  await appearance.getByRole('button', { name: 'Done' }).click();
  await checkViewport('Editor with changed appearance settings');

  // Long action rows must scroll horizontally inside their own containers,
  // not enlarge the page or push the photo out of view.
  const top = page.getByRole('toolbar', { name: 'Editor actions' });
  await expect(top).toHaveCSS('overflow-x', 'auto');
  await page.setViewportSize({ width: 667, height: 375 });
  await checkViewport('Editor landscape');
  const editLayout = () => page.evaluate(() => {
    const editor = document.querySelector('section[aria-label="Photo editor"]');
    const layout = [...(editor?.children ?? [])].find((child) => (child as HTMLElement).className.includes('workspace:flex-row'));
    return layout ? getComputedStyle(layout).flexDirection : 'missing';
  });
  expect(await editLayout()).toBe('column');
  await expect(page.getByRole('img', { name: 'Edited photo' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  await checkViewport('Editor small phone');
  await page.setViewportSize({ width: 850, height: 700 });
  await checkViewport('Foldable unfolded narrow workspace');
  expect(await editLayout()).toBe('column');
  await page.setViewportSize({ width: 1024, height: 768 });
  await checkViewport('Tablet landscape');
  expect(await editLayout()).toBe('row');
  await page.getByRole('button', { name: 'Appearance and layout settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Appearance and layout settings' })
    .getByRole('button', { name: 'Right side' })).toHaveAttribute('aria-pressed', 'true');
});
