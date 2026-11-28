import { openV2Settings, openFlightChecks } from './helpers';
import { expect, test } from '@playwright/test';

test('Colour-vision support is off by default and, when turned on, names the colours in words', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Settings opens from the desktop tool rail.');
  await page.route('**/*.onnx*', (route) => route.abort());
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Colour words');
  await studio.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await studio.getByRole('button', { name: 'Import', exact: true }).waitFor();
  // A synthetic photo: a strong red half and a green half of about the same lightness.
  const pixels = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(190, 60, 50)';
    context.fillRect(0, 0, 80, 120);
    context.fillStyle = 'rgb(90, 140, 50)';
    context.fillRect(80, 0, 80, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await studio.evaluate((target, base64) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'red-green.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, pixels);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  const openPanel = studio.getByRole('button', { name: testInfo.project.name === 'phone' ? 'Flight' : 'Co-pilot', exact: true });
  await openFlightChecks(studio, openPanel);
  await studio.getByRole('button', { name: 'Check photo on this device' }).click();
  // The explanation sits behind the (i) beside Recommended adjustments (Dave, 27 Nov: action and advice only on this tab).
  await studio.getByTestId('copilot-about').locator('summary').click();
  await expect(studio.getByText('Colour notes come from measuring the photo itself', { exact: false }).first()).toBeVisible();

  // Off by default: no colour list, and never an internal code such as "strongColour".
  await expect(studio.getByTestId('colour-words')).toHaveCount(0);
  await expect(studio.getByText(/strongColour|clippedColour/)).toHaveCount(0);

  await openV2Settings(page);
  await page.getByRole('tab', { name: 'Assistance' }).or(page.getByRole('button', { name: 'Assistance' })).first().click();
  const toggle = page.getByRole('switch', { name: 'Colour-vision support' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Close settings' }).click();

  await openFlightChecks(studio, openPanel);
  const words = studio.getByTestId('colour-words').first();
  await expect(words).toBeVisible();
  await expect(words).toContainText('Main colours');
  await expect(words).toContainText(/red/);
  await expect(words).toContainText(/green/);

  // The same switch sits at the top of Adjust, and the red and green look-alike areas are outlined and numbered on the photo.
  await studio.getByRole('button', { name: 'Adjust', exact: true }).first().click();
  const adjustToggle = studio.getByTestId('cvd-toggle');
  await expect(adjustToggle).toHaveAttribute('aria-checked', 'true');
  // Dave, a colour-blind user: one plain verdict leads, with at most one action. The detail waits behind More and Show where.
  const verdict = studio.getByTestId('colour-verdict');
  await expect(verdict).toHaveText(/Colours look|Red and green areas|Not sure about the colours/);
  await expect(verdict.getByRole('button')).toHaveCount(await verdict.getByRole('button').count() > 0 ? 1 : 0);
  await expect(studio.getByTestId('colour-area'), 'no outlines until asked').toHaveCount(0);
  const where = studio.getByTestId('colour-verdict-where');
  if (!await where.isVisible()) await studio.getByTestId('colour-verdict-more').locator('summary').click();
  await where.click();
  await expect(where).toHaveAttribute('aria-pressed', 'true');
  await expect(studio.getByTestId('colour-area')).toHaveCount(2);
  await expect(studio.getByTestId('colour-area').first()).toHaveAttribute('aria-label', /^1 · /);
  // Nothing covers the image: no words on the photo; the numbers and names are in the key under the canvas.
  await expect(studio.getByTestId('colour-area-marks').locator('text')).toHaveCount(0);
  const key = studio.getByTestId('colour-area-key');
  await expect(key.getByTestId('colour-area-key-item')).toHaveCount(2);
  await expect(key.getByTestId('colour-area-key-item').first()).toHaveText(/^1 · /);
  await expect(studio.getByTestId('canvas-status')).toContainText(/2 · /);
  if (process.env.KESTREL_SHOTS) await page.screenshot({ path: process.env.KESTREL_SHOTS + '/colour-vision-' + testInfo.project.name + '.png' });
  // Correct, when the verdict offers it, is one step that says what it did and can be undone from the same line.
  const correct = studio.getByTestId('colour-verdict-correct').first();
  if (await correct.isVisible()) {
    await expect(correct).toHaveAttribute('title', /Changes: (Saturation|Temperature|Tint) [+−]d+/);
    await correct.click();
    const did = studio.getByTestId('colour-verdict-did');
    await expect(did).toHaveText(/(Saturation|Temperature|Tint) [+−]d+/);
    await did.getByRole('button', { name: 'Undo' }).click();
    await expect(did).toHaveCount(0);
  }
  // Turning it off in Adjust turns off the setting too, and the outlines go.
  await adjustToggle.click();
  await expect(adjustToggle).toHaveAttribute('aria-checked', 'false');
  await expect(studio.getByTestId('colour-area')).toHaveCount(0);
  await expect(studio.getByTestId('colour-area-key')).toHaveCount(0);
  await openV2Settings(page);
  await page.getByRole('tab', { name: 'Assistance' }).or(page.getByRole('button', { name: 'Assistance' })).first().click();
  await expect(page.getByRole('dialog').getByRole('switch', { name: 'Colour-vision support' })).toHaveAttribute('aria-checked', 'false');
});

async function openAdjustWithPhoto(page: import('@playwright/test').Page) {
  await page.route('**/*.onnx*', (route) => route.abort());
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Colour offer');
  await studio.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await studio.getByRole('button', { name: 'Import', exact: true }).waitFor();
  const pixels = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 60;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(120, 130, 90)';
    context.fillRect(0, 0, 80, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await studio.evaluate((target, base64) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'plain.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, pixels);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);
  // Adjust may already be the open panel; clicking its rail button again would close it.
  const panelSwitch = studio.getByRole('button', { name: 'Adjust', exact: true }).first();
  if (!(await studio.getByTestId('cvd-toggle').isVisible())) await panelSwitch.click();
  await expect(studio.getByTestId('cvd-toggle')).toBeVisible();
  return studio;
}

test('A one-line first-run offer names colours in words: Yes turns it on, once answered it never returns', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Same Adjust panel on both; desktop is enough.');
  const studio = await openAdjustWithPhoto(page);
  const offer = studio.getByTestId('cvd-offer');
  await expect(offer).toContainText('Name colours in words?');
  await expect(studio.getByTestId('cvd-toggle')).toHaveAttribute('aria-checked', 'false');
  // Keyboard: the buttons are reached by Tab and pressed with Enter.
  await studio.getByTestId('cvd-offer-yes').focus();
  await page.keyboard.press('Enter');
  await expect(offer).toHaveCount(0);
  await expect(studio.getByTestId('cvd-toggle')).toHaveAttribute('aria-checked', 'true');
  await studio.getByTestId('cvd-toggle').click();
  await expect(studio.getByTestId('cvd-toggle')).toHaveAttribute('aria-checked', 'false');
  await expect(offer, 'an answered offer does not come back when the switch is turned off').toHaveCount(0);
});

test('No thanks is respected and remembered across a reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Same Adjust panel on both; desktop is enough.');
  const studio = await openAdjustWithPhoto(page);
  await studio.getByTestId('cvd-offer-no').click();
  await expect(studio.getByTestId('cvd-offer')).toHaveCount(0);
  await expect(studio.getByTestId('cvd-toggle')).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => window.localStorage.getItem('inflight.v2.ui'))).toContain('"cvdOfferAnswered":true');
});
