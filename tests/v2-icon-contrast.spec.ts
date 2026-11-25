import { expect, test, type Page } from '@playwright/test';

// Owner report (25 Nov): tick boxes, the split + and zoom out looked dark or missing on Windows. They are the thin
// Direction B icons, and on a 1x screen (most Windows laptops) their stroke was under a pixel wide, so the line never
// reached the icon's colour. This draws the studio at 1x in dark and light and checks every small icon on screen
// reaches near full strength against what is behind it.
test.use({ deviceScaleFactor: 1 });

async function openStudio(page: Page) {
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Icons');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project', exact: true }).click();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 160;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#586b82'; ctx.fillRect(0, 0, 240, 160);
    return c.toDataURL('image/png').split(',')[1];
  });
  const picker = page.waitForEvent('filechooser');
  await studio.getByRole('button', { name: 'Import', exact: true }).first().click();
  await (await picker).setFiles(['icon-a.png', 'icon-b.png'].map((name) => ({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(2);
  return studio;
}

/** How close the strongest pixel of each icon gets to the icon's own colour, from 0 (invisible) to 1 (full strength). */
async function iconStrengths(page: Page) {
  const icons = page.locator('.inflight-v2 [data-icon]');
  const results: { name: string; size: number; strength: number }[] = [];
  for (const icon of await icons.all()) {
    if (!(await icon.isVisible())) continue;
    const box = await icon.boundingBox();
    if (!box || box.width < 8 || box.width > 20) continue;
    const info = await icon.evaluate((el) => {
      // Skip icons drawn faded on purpose (a disabled control), and ones partly covered by something else.
      let opacity = 1;
      for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { name: el.getAttribute('data-icon')!, color: getComputedStyle(el).color, opacity, covered: !!top && !el.contains(top) && !top.contains(el) && top !== el };
    });
    if (info.opacity < 0.99 || info.covered) continue;
    const shot = (await page.screenshot({ clip: { x: Math.floor(box.x) - 2, y: Math.floor(box.y) - 2, width: Math.ceil(box.width) + 4, height: Math.ceil(box.height) + 4 } })).toString('base64');
    const strength = await page.evaluate(async ({ shot, color }) => {
      const image = new Image(); image.src = `data:image/png;base64,${shot}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      // What is behind the icon: the commonest colour round the clip's edge.
      const counts = new Map<string, number>();
      for (let x = 0; x < canvas.width; x++) for (const y of [0, canvas.height - 1]) { const i = (y * canvas.width + x) * 4; const k = `${data[i]},${data[i + 1]},${data[i + 2]}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
      const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
      const fg = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const full = Math.abs(fg[0] - bg[0]) + Math.abs(fg[1] - bg[1]) + Math.abs(fg[2] - bg[2]);
      if (full < 60) return null; // the icon's colour is near its background anyway (a quiet badge): not this check
      let peak = 0;
      for (let i = 0; i < data.length; i += 4) peak = Math.max(peak, (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2])) / full);
      return peak;
    }, { shot, color: info.color });
    if (strength !== null) results.push({ name: info.name, size: Math.round(box.width), strength });
  }
  return results;
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`small icons reach full strength on a 1x screen (${colorScheme})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One desktop pass per theme covers the shared icons.');
    await page.emulateMedia({ colorScheme });
    await openStudio(page);
    const strengths = await iconStrengths(page);
    // The editor shows Direction B icons (close, plus, chevrons, more, check, settings) as well as the brand pack.
    expect(strengths.length).toBeGreaterThan(10);
    expect(strengths.some((icon) => ['close', 'plus', 'minus', 'more', 'chevron-down', 'check', 'settings', 'checkbox-empty'].includes(icon.name))).toBe(true);
    // 0.8: as strong as the brand pack's own icons at 1x. A line centred on a pixel edge (a minus at 14 px) shares itself
    // between two rows, so a hairline-sharp 100% is not possible without a 2 px stroke; the faint icons were 0.6-0.72.
    const faint = strengths.filter((icon) => icon.strength < 0.8).map((icon) => `${icon.name} at ${icon.size}px: ${Math.round(icon.strength * 100)}%`);
    expect(faint).toEqual([]);
  });
}
