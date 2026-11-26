import { openV2Settings } from './helpers';
import { expect, test } from '@playwright/test';

/**
 * Bring your own AI, end to end in the real V2 workspace, with a stand-in for Ollama on this computer: set it up in
 * Settings, agree to the destination by name, ask, see the checked one-small-step suggestion, and Apply it through the normal edit path.
 */
test('Your own AI (a model on this computer) gives a second opinion, applied only on Apply as one small step', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Settings opens from the desktop tool rail.');
  await page.route('**/*.onnx*', (route) => route.abort());
  const asked: unknown[] = [];
  await page.route('http://localhost:11434/v1/chat/completions', async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        summary: 'The photo looks a little cool and blue.',
        points: [{ issue: 'cast', detail: 'There is a slight blue tint.' }],
        suggestion: { warmth: 1.5 },
      }) } }] }),
    });
  });
  await page.goto('/?v2');
  const studio = page.locator('.inflight-v2');
  await studio.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Own AI');
  await studio.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await studio.getByRole('button', { name: 'Import', exact: true }).waitFor();
  const pixels = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 120;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(90, 120, 170)';
    context.fillRect(0, 0, 160, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await studio.evaluate((target, base64) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'cool.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, pixels);
  await expect(studio.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(1);

  await openV2Settings(page);
  await page.getByRole('tab', { name: /AI/ }).or(page.getByRole('button', { name: /AI providers|AI/ })).first().click();
  const setup = page.getByTestId('v2-ai-setup');
  await setup.getByRole('button', { name: 'Ollama' }).click();
  await setup.getByLabel('Model', { exact: true }).fill('qwen2.5vl');
  await setup.getByTestId('v2-ai-setup-save').click();
  await expect(page.getByTestId('v2-ai-setup-saved')).toContainText('localhost:11434');
  await page.getByRole('button', { name: 'Close settings' }).click();

  const card = studio.getByTestId('v2-ai-opinion').first();
  if (!await card.isVisible()) await studio.getByRole('button', { name: 'Co-pilot', exact: true }).first().click();
  await expect(card).toContainText('Nothing leaves your computer');
  expect(asked).toHaveLength(0);
  await card.getByRole('button', { name: 'I agree' }).click();
  await card.getByTestId('v2-ai-opinion-ask').click();
  const result = card.getByTestId('v2-ai-opinion-result');
  await expect(result).toContainText('a little cool');
  await expect(result).toContainText('Tint');
  // The model asked for +1.5; one small step is all that is offered and applied.
  await expect(result).toContainText('Warmth: +0.3');
  expect(asked).toHaveLength(1);
  await result.getByTestId('v2-ai-opinion-apply').click();
  await expect(card).toContainText('Applied');
});
