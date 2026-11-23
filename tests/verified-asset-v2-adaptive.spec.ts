import { expect, test } from '@playwright/test';

/**
 * These are screen/touch breakpoints, NOT simulations of a physical fold hinge.
 * Run with: npm run test:e2e:dev -- --grep "adaptive form factor"
 *
 * Verified-asset test naming uses the Vite dev server so it can run alongside
 * the source-level engine UAT. Android Studio and Edge Duo hinge tests are
 * additional release gates, documented in docs/UAT-FEATURE-FLAGS-AND-FOLDABLES.md.
 */
const viewports = [
  { name: 'small iPhone or Android', width: 320, height: 720 },
  { name: 'standard iPhone or Android', width: 390, height: 844 },
  { name: 'large phone', width: 430, height: 932 },
  { name: 'Duo single-panel width', width: 540, height: 720 },
  { name: 'small Android tablet portrait', width: 600, height: 900 },
  { name: 'Duo landscape approximation', width: 720, height: 540 },
  { name: 'iPad mini portrait', width: 744, height: 1133 },
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad landscape', width: 1024, height: 768 },
  { name: 'opened foldable approximation', width: 1080, height: 720 },
  { name: 'tablet landscape', width: 1180, height: 820 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

test('adaptive form factor retains the same selected photograph when a phone folds, unfolds and rotates', async ({ page }, testInfo) => {
  // Start at desktop size so the user's selected photo is unambiguous before
  // changing width. Both Playwright desktop and phone projects run this test.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await expect(root).toBeVisible();
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  const filmstrip = root.getByRole('listbox', { name: 'Project photographs', includeHidden: true });
  await expect(filmstrip.getByRole('option', { includeHidden: true }).first()).toBeAttached();

  // Select a concrete photograph rather than rely on a default selection.
  await filmstrip.getByRole('option', { includeHidden: true }).first().locator('button:has(img)').click();
  const active = root.locator('[role="option"][aria-selected="true"]').first();
  await expect(active).toBeAttached();
  const selectedName = await active.locator('img').first().getAttribute('alt');
  expect(selectedName).toBeTruthy();

  // Folded -> unfolded -> folded, across the phone/tablet width boundary.
  const sequence = [viewports[1], viewports[9], viewports[3], viewports[8], viewports[0], viewports[7], viewports[11]];
  for (const viewport of sequence) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const mobile = viewport.width <= 767;
    const mobileNav = root.getByRole('navigation', { name: 'Mobile studio tools' });
    if (mobile) {
      await expect(mobileNav, viewport.name).toBeVisible();
      const buttons = await mobileNav.locator('button').count();
      expect(buttons, viewport.name + ': mobile tools should remain reachable').toBeGreaterThanOrEqual(4);
    } else {
      await expect(mobileNav, viewport.name).toHaveCount(0);
    }

    const selected = root.locator('[role="option"][aria-selected="true"] img').first();
    await expect(selected, viewport.name + ': photo selection lost on resize').toHaveAttribute('alt', selectedName!);

    const geometry = await page.evaluate(() => {
      const root = document.querySelector('.inflight-v2') as HTMLElement | null;
      const frame = document.querySelector('.inflight-v2 [data-testid="canvas-frame"]') as HTMLElement | null;
      if (!root || !frame) return { rootWidth: 0, frameWidth: 0, frameHeight: 0, intersects: false };
      const rootRect = root.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      return { rootWidth: rootRect.width, frameWidth: frameRect.width, frameHeight: frameRect.height,
        intersects: frameRect.left < window.innerWidth && frameRect.right > 0 &&
          frameRect.top < window.innerHeight && frameRect.bottom > 0 };
    });
    expect(geometry.rootWidth, viewport.name + ': incorrect app root width').toBeGreaterThanOrEqual(viewport.width - 2);
    expect(geometry.frameWidth, viewport.name + ': canvas collapsed').toBeGreaterThan(10);
    expect(geometry.frameHeight, viewport.name + ': canvas collapsed').toBeGreaterThan(10);
    expect(geometry.intersects, viewport.name + ': canvas has left the screen').toBe(true);

    if ([390, 820, 1080].includes(viewport.width)) {
      await testInfo.attach('adaptive-' + viewport.width + 'x' + viewport.height,
        { body: await page.screenshot(), contentType: 'image/png' });
    }
  }
});

test('adaptive form factor keeps phone More actions reachable at 320/390 and restores tablet layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: /Scottish Highlands/ }).first().click();
  const nav = root.getByRole('navigation', { name: 'Mobile studio tools' });
  for (const viewport of [viewports[0], viewports[1]]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(nav).toBeVisible();
    const more = nav.getByRole('button', { name: 'More' });
    await expect(more).toBeVisible();
    await more.click();
    await expect(root.getByRole('dialog', { name: 'More tools' })).toBeVisible();
    await expect(root.getByRole('dialog', { name: 'More tools' }).getByRole('button', { name: 'Settings' })).toBeVisible();
    await more.click();
    await expect(root.getByRole('dialog', { name: 'More tools' })).toHaveCount(0);
  }
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(nav).toHaveCount(0);
  await expect(root.getByRole('dialog', { name: 'More tools' })).toHaveCount(0);
});
