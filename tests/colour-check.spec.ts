import { expect, test, type Page } from '@playwright/test';

async function openInEditor(page: Page, paint: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Colour');
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  const picture = await page.evaluate((recipe) => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    const c = canvas.getContext('2d')!;
    for (const [fill, x, y, w, h] of JSON.parse(recipe) as [string, number, number, number, number][]) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
    return canvas.toDataURL('image/png').split(',')[1];
  }, paint);
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles({ name: 'colour.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 1' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  // Phones open on Quick adjust; the colour check is with all the controls, one tap away.
  const all = page.getByRole('button', { name: 'All controls' });
  if (await all.isVisible()) await all.click();
  return page.getByTestId('colour-check');
}

test('the colour check names the colours and says what is wrong, in words, with a fix', async ({ page }) => {
  // Very strong red over half the photo, on a warm grey: a red that is too strong, and a warm cast.
  const panel = await openInEditor(page, JSON.stringify([['rgb(150,130,100)', 0, 0, 400, 300], ['rgb(255,0,30)', 0, 0, 400, 150]]));
  await expect(panel.getByTestId('colour-palette')).toContainText('red, very strong');
  await expect(panel.getByTestId('colour-palette')).toContainText('brown');
  const strong = panel.locator('[data-finding="strongColour"]');
  await expect(strong).toContainText('Watch out:');
  await expect(strong).toContainText('Very strong red');
  await expect(panel.locator('[data-finding="cast"]')).toContainText('warm cast');
  // Each finding has an icon and a word, not just a colour.
  await expect(strong.locator('svg')).toHaveCount(1);

  await strong.getByRole('button', { name: 'Soften colour' }).click();
  // The fix goes into the normal, undoable edit, and the check runs again on the softened picture.
  await expect(panel.getByRole('status')).toContainText('Edit history');
  await expect(page.getByRole('button', { name: /^Undo/ }).first()).toBeEnabled();
});

test('a calm, natural photo gets its colours named and no warnings', async ({ page }) => {
  const panel = await openInEditor(page, JSON.stringify([['rgb(110,150,200)', 0, 0, 400, 150], ['rgb(80,120,70)', 0, 150, 400, 150]]));
  await expect(panel.getByTestId('colour-palette')).toContainText('blue');
  await expect(panel.getByTestId('colour-palette')).toContainText('green');
  await expect(panel.locator('[data-finding="strongColour"], [data-finding="clippedColour"], [data-finding="cast"]')).toHaveCount(0);
  await expect(panel.getByTestId('colour-findings')).toContainText('Nothing looks wrong');
});

test('a second opinion from your own AI: set up, agree to the destination, ask, and apply as one undoable step', async ({ page }) => {
  const asked: unknown[] = [];
  // A pretend model "on this computer" (an OpenAI-compatible endpoint, as Ollama or LM Studio provide).
  await page.route('http://localhost:11434/v1/chat/completions', async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({
      summary: 'The red is stronger than in life, and the grey looks warm.',
      points: [{ issue: 'tooStrong', detail: 'The red band is very strong.' }],
      suggestion: { colour: -0.4, warmth: -0.2 },
    }) } }] } });
  });
  const panel = await openInEditor(page, JSON.stringify([['rgb(150,130,100)', 0, 0, 400, 300], ['rgb(255,0,30)', 0, 0, 400, 150]]));
  // The AI is set up once, in Settings (#513); until then the editor shows no AI controls.
  await expect(panel.getByTestId('ai-review')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('region', { name: 'Optional second opinion settings' });
  await settings.getByRole('button', { name: 'Set up' }).click();
  await settings.getByLabel('Which AI?').selectOption('openai');
  await settings.getByLabel('Model', { exact: true }).fill('llava');
  await settings.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  const ai = panel.getByTestId('ai-review');
  // Nothing is sent before agreeing; the destination is named, and a local model says nothing leaves the computer.
  await expect(ai.getByRole('group', { name: 'Before anything is sent' })).toContainText('Nothing leaves your computer');
  expect(asked).toHaveLength(0);
  await ai.getByRole('button', { name: 'I agree' }).click();
  await ai.getByRole('button', { name: 'Ask my own AI' }).click();

  const result = ai.getByTestId('ai-review-result');
  await expect(result).toContainText('The red is stronger than in life');
  await expect(result).toContainText('Too strong:');
  await expect(result).toContainText('Warmth: −0.2');
  expect(asked).toHaveLength(1);
  const request = asked[0] as { model: string; messages: { content: { type: string; text?: string; image_url?: { url: string } }[] }[] };
  expect(request.model).toBe('llava');
  expect(request.messages[0].content[0].text).toContain('Never describe, identify or name any person');
  expect(request.messages[0].content[1].image_url?.url.startsWith('data:image/jpeg;base64,')).toBe(true);

  await result.getByRole('button', { name: 'Apply suggestions' }).click();
  await expect(ai.getByRole('status')).toContainText('Edit history');
  await expect(page.getByRole('button', { name: /^Undo/ }).first()).toBeEnabled();
});


test('an in-flight second opinion cannot attach to a newly changed edit', async ({ page }) => {
  // A deliberately slow local model illustrates a real on-device VLM as well
  // as an optional BYO endpoint; changing this edit must cancel the old result.
  let release: (() => void) | undefined;
  let received = false;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('http://localhost:11434/v1/chat/completions', async (route) => {
    received = true;
    await pending;
    try {
      await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({
        summary: 'Stale advice from the earlier photo state.',
        points: [{ issue: 'tooStrong', detail: 'This is no longer the current edit.' }],
        suggestion: { colour: -1.5 },
      }) } }] } });
    } catch { /* An already-aborted request cannot be fulfilled; expected. */ }
  });
  const panel = await openInEditor(page, JSON.stringify([
    ['rgb(150,130,100)', 0, 0, 400, 300], ['rgb(255,0,30)', 0, 0, 400, 150],
  ]));
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('region', { name: 'Optional second opinion settings' });
  await settings.getByRole('button', { name: 'Set up' }).click();
  await settings.getByLabel('Which AI?').selectOption('openai');
  await settings.getByLabel('Model', { exact: true }).fill('llava');
  await settings.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  const review = panel.getByTestId('ai-review');
  await review.getByRole('button', { name: 'I agree' }).click();
  await review.getByRole('button', { name: 'Ask my own AI' }).click();
  await expect.poll(() => received).toBe(true);

  // A photographer continues editing while the slow model is thinking.
  await panel.locator('[data-finding="strongColour"]').getByRole('button', { name: 'Soften colour' }).click();
  await expect(review.getByTestId('ai-review-result')).toHaveCount(0);
  release?.();
  await expect(review.getByRole('button', { name: 'Ask my own AI' })).toBeEnabled();
  await expect(review.getByTestId('ai-review-result')).toHaveCount(0);
});
