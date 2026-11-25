import { expect, test, type Locator } from '@playwright/test';

// Nothing shown by colour alone (owner checklist, WCAG 1.4.1): the current tool and the selected format carry a shape
// (a short solid bar) as well as colour, drawn from the element's own pressed or selected state.
const mark = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el, '::before').content);

test('?v2 the current rail tool and the selected format carry a bar, not only a colour', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The rail is the desktop layout.');
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: /Open studio/ }).first().click();

  const rail = studio.getByRole('complementary', { name: 'Studio tools' });
  const adjust = rail.getByRole('button', { name: /^Adjust/ });
  const formats = rail.getByRole('button', { name: /^Formats/ });
  // A tool may already be open when the studio starts; clicking the open one closes it, so open Formats, then Adjust.
  if ((await formats.getAttribute('aria-pressed')) !== 'true') await formats.click();
  await expect(formats).toHaveAttribute('aria-pressed', 'true');
  expect(await mark(formats)).not.toBe('none');
  expect(await mark(adjust)).toBe('none');

  await adjust.click();
  await expect(adjust).toHaveAttribute('aria-pressed', 'true');
  expect(await mark(adjust)).not.toBe('none');
  expect(await mark(formats)).toBe('none');

  await formats.click();
  await expect(formats).toHaveAttribute('aria-pressed', 'true');

  // The selected format row in the Formats panel is marked the same way; the others are not.
  const selected = studio.locator('[data-testid^="format-row-"][data-selected="true"]').first();
  await expect(selected).toBeVisible();
  expect(await mark(selected)).not.toBe('none');
  const other = studio.locator('[data-testid^="format-row-"][data-selected="false"]').first();
  expect(await mark(other)).toBe('none');
});

test('?v2 phone: the current tool in the bottom bar carries a bar above it, not only a colour', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone layout only.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?v2&stub=1');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'Cairngorms Pinewood Stags', exact: true }).click();
  const bar = studio.getByRole('navigation', { name: 'Mobile studio tools' });
  const adjust = bar.getByRole('button', { name: 'Adjust', exact: true });
  const more = bar.getByRole('button', { name: 'More', exact: true });
  await adjust.click();
  await expect(adjust).toHaveAttribute('aria-pressed', 'true');
  expect(await mark(adjust)).not.toBe('none');
  expect(await mark(more)).toBe('none');
});
