import { expect, test } from '@playwright/test';

// Owner decision (26 Nov): optimise a phone held sideways rather than lock it upright. The planned layout
// (V2-WORKSPACE 26.4): navigation on the left, tools on the right with Export on top, a tool opens as a side panel,
// and the photo keeps the full height. 932 x 430 and 915 x 412 (big phones) used to miss the short-landscape rules.
for (const [width, height] of [[844, 390], [932, 430]] as const) {
  test(`phone sideways at ${width}×${height}: navigation left, tools right with Export on top, tools open beside the photo`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'A touch phone held sideways.');
    await page.setViewportSize({ width, height });
    await page.goto('/?v2&stub=1');
    const studio = page.locator('.inflight-v2');
    await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).or(studio.getByRole('button', { name: /Open studio/ }).first()).first().click();

    // No top bar: its jobs moved to the two side columns.
    await expect(studio.getByRole('banner', { name: 'InFlight studio header' })).toHaveCount(0);
    const nav = studio.getByRole('navigation', { name: 'Back, undo and full screen' });
    await expect(nav.getByRole('button', { name: 'Back to projects' })).toBeVisible();
    await expect(nav.getByRole('button', { name: /full screen/i })).toBeVisible();
    expect((await nav.boundingBox())!.x).toBeLessThan(8);

    const tools = studio.getByRole('navigation', { name: 'Mobile studio tools' });
    const toolsBox = (await tools.boundingBox())!;
    expect(toolsBox.x + toolsBox.width).toBeGreaterThan(width - 8);
    await expect(tools.getByRole('button').first()).toHaveText('Export');
    await expect(tools.getByRole('button', { name: 'Masks', exact: true })).toBeVisible();

    // The photo sits between the columns and is drawn.
    const frame = studio.getByTestId('canvas-frame');
    await expect(frame).toBeVisible();
    const before = (await frame.boundingBox())!;
    expect(before.x).toBeGreaterThan((await nav.boundingBox())!.width - 1);
    expect(before.x + before.width).toBeLessThan(toolsBox.x + 1);

    // A tool opens as a side panel beside the photo, not over it, and the filmstrip steps aside meanwhile.
    await tools.getByRole('button', { name: 'Adjust', exact: true }).click();
    await expect(tools.getByRole('button', { name: 'Adjust', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const panel = studio.getByRole('heading', { name: 'Adjust', level: 2 });
    await expect(panel).toBeVisible();
    const handle = studio.getByTestId('mobile-sheet-handle');
    const panelLeft = (await handle.boundingBox())!.x;
    await expect.poll(async () => { const box = (await frame.boundingBox())!; return box.x + box.width; }).toBeLessThanOrEqual(panelLeft + 1);
    await expect(studio.locator('.v2-filmstrip')).toBeHidden();

    await studio.getByRole('button', { name: 'Close mobile drawer' }).click();
    await expect(panel).toHaveCount(0);
    await expect(studio.locator('.v2-filmstrip')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
