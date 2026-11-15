import { expect, test, type Page, type Route } from '@playwright/test';

const GOOGLE = '**/generativelanguage.googleapis.com/**';
const answer = (data: Record<string, unknown>) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }] });
const KITE = answer({ kind: 'wildlife', species: 'red kite', scientific: 'Milvus milvus', confidence: 'high', tags: ['in flight'] });
const MODELS = { models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] }] };

interface Seen { method: string; url: string; key: string | undefined; body: string }

/** A pretend Gemini that records what it is sent. */
async function pretendGemini(page: Page, reply: (route: Route, seen: Seen) => Promise<void> | void) {
  const seen: Seen[] = [];
  await page.route(GOOGLE, async (route) => {
    const request = route.request();
    const entry = { method: request.method(), url: request.url(), key: request.headers()['x-goog-api-key'], body: request.postData() ?? '' };
    seen.push(entry);
    if (entry.method === 'GET') return route.fulfill({ json: MODELS, headers: { 'access-control-allow-origin': '*' } });
    return reply(route, entry);
  });
  // The browser asks permission first for a request with a custom header.
  return seen;
}

async function importPhotos(page: Page) {
  await page.goto('/');
  const pictures = await page.evaluate(() => Array.from({ length: 3 }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 500;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#3b556b'; c.fillRect(0, 0, 800, 500);
    c.fillStyle = '#c0392b'; c.beginPath(); c.ellipse(560 - index * 40, 250, 130, 160, 0, 0, 7); c.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill('Helper');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, index) => ({ name: `bird-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: 'To review 3' })).toBeVisible({ timeout: 30000 });
}

async function turnOn(page: Page, key = 'test-key-123') {
  await page.getByRole('region', { name: 'Species recognition' }).getByRole('button', { name: 'Or use the online helper' }).click();
  const dialog = page.getByRole('dialog', { name: 'Online helper (optional)' });
  const save = dialog.getByRole('button', { name: 'Check and turn on' });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Your Gemini API key').fill(key);
  await expect(save).toBeDisabled(); // still needs the agreement
  await dialog.getByRole('checkbox').check();
  await save.click();
  return dialog;
}

test('nothing is sent anywhere until the helper is agreed to, switched on and given a key', async ({ page }) => {
  const seen = await pretendGemini(page, (route) => route.fulfill({ json: KITE }));
  await importPhotos(page);
  await page.waitForTimeout(2500);
  expect(seen).toHaveLength(0);
  await expect(page.getByTestId('species-label')).toHaveCount(0);
});

test('with the helper on, photos are named from small JPEGs with no name, no camera data and the key only in a header', async ({ page }) => {
  const seen = await pretendGemini(page, (route) => route.fulfill({ json: KITE, headers: { 'access-control-allow-origin': '*' } }));
  await importPhotos(page);
  const dialog = await turnOn(page);
  await expect(dialog).toHaveCount(0);

  const banner = page.getByRole('region', { name: 'Species recognition' });
  await expect(banner.getByText(/Asking the online helper/)).toBeVisible({ timeout: 30000 });
  const labels = page.getByTestId('species-label');
  await expect(labels).toHaveCount(3, { timeout: 60000 });
  for (const label of await labels.all()) {
    await expect(label).toContainText('Species: Red kite');
    await expect(label.getByText('Auto', { exact: true })).toBeVisible();
  }

  const asks = seen.filter((entry) => entry.method === 'POST');
  expect(asks).toHaveLength(3);
  for (const ask of asks) {
    expect(ask.key).toBe('test-key-123');
    expect(ask.url).not.toContain('test-key-123');
    expect(ask.body).not.toContain('test-key-123');
    expect(ask.body).not.toMatch(/bird-\d\.png/);
    const parts = JSON.parse(ask.body).contents[0].parts as { inlineData?: { mimeType: string; data: string } }[];
    const image = parts.find((part) => part.inlineData)!.inlineData!;
    expect(image.mimeType).toBe('image/jpeg');
    const bytes = Buffer.from(image.data, 'base64');
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]); // a JPEG
    expect(bytes.includes(Buffer.from('Exif'))).toBe(false); // and no camera data, so no location either
    expect(bytes.length).toBeLessThan(200_000);
  }
  // The newest suitable model was picked from the list the key can use.
  expect(asks[0].url).toContain('gemini-3.7-flash');
});

test('a key Google refuses stops the run after one try and says so, without breaking the page', async ({ page }) => {
  const seen = await pretendGemini(page, (route) => route.fulfill({ status: 401, json: { error: { status: 'UNAUTHENTICATED', message: 'bad' } }, headers: { 'access-control-allow-origin': '*' } }));
  await importPhotos(page);
  await turnOn(page, 'wrong-key');
  await expect(page.getByRole('alert').filter({ hasText: 'did not accept your key' })).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1500);
  expect(seen.filter((entry) => entry.method === 'POST')).toHaveLength(1);
  await expect(page.getByTestId('species-label')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Photo collections' })).toBeVisible();
});

test('a rate limit also stops the run, and offline photos are simply left alone', async ({ page }) => {
  const seen = await pretendGemini(page, (route) => route.fulfill({ status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED' } }, headers: { 'access-control-allow-origin': '*' } }));
  await importPhotos(page);
  await turnOn(page);
  await expect(page.getByRole('alert').filter({ hasText: /busy|limit/ })).toBeVisible({ timeout: 30000 });
  expect(seen.filter((entry) => entry.method === 'POST')).toHaveLength(1);
});

test('a network failure for a photo is skipped quietly and nothing is marked', async ({ page }) => {
  let posts = 0;
  await page.route(GOOGLE, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: MODELS, headers: { 'access-control-allow-origin': '*' } });
    posts += 1;
    return route.abort('failed');
  });
  await importPhotos(page);
  await turnOn(page);
  await expect.poll(() => posts, { timeout: 30000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('species-label')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Photo collections' })).toBeVisible();
});

async function openAutoTab(page: Page) {
  await page.getByRole('button', { name: 'View bird-1.png' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Crop' }).waitFor();
  if ((await page.getByRole('tab', { name: 'Auto' }).getAttribute('aria-selected')) !== 'true') await page.getByRole('tab', { name: 'Auto' }).click();
}

test('one photo can be asked about by hand, and the answer is only a suggestion to accept', async ({ page }) => {
  // A medium answer is not sure enough to tag by itself, so the photo stays untagged until it is accepted.
  const MEDIUM = answer({ kind: 'wildlife', species: 'red kite', scientific: 'Milvus milvus', confidence: 'medium', tags: [] });
  await pretendGemini(page, (route) => route.fulfill({ json: MEDIUM, headers: { 'access-control-allow-origin': '*' } }));
  await importPhotos(page);
  await turnOn(page);
  await expect(page.getByRole('region', { name: 'Species recognition' })).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByTestId('species-label')).toHaveCount(0);
  await openAutoTab(page);
  const panel = page.getByRole('region', { name: 'Species suggestions' });
  await panel.getByRole('button', { name: 'Ask the online helper about this photo' }).click();
  const suggestion = panel.getByRole('list', { name: 'Online suggestion' });
  await expect(suggestion).toContainText('Red kite');
  await expect(suggestion).toContainText('Milvus milvus');
  await expect(suggestion).toContainText('possible');
  const subject = page.getByRole('region', { name: 'What is in this photo' });
  await expect(subject.getByRole('list', { name: 'Tags' })).toHaveCount(0);
  await suggestion.getByRole('button', { name: 'Use Red kite' }).click();
  await expect(subject.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText(['Red kite']);
  await expect(subject.getByText('Auto', { exact: true })).toHaveCount(0);
});

test('the key can be removed from the settings, which turns the helper off and forgets the key', async ({ page }) => {
  await pretendGemini(page, (route) => route.fulfill({ json: KITE, headers: { 'access-control-allow-origin': '*' } }));
  await importPhotos(page);
  await turnOn(page);
  await expect(page.getByTestId('species-label')).toHaveCount(3, { timeout: 60000 });
  expect(await page.evaluate(() => localStorage.getItem('kestrel.helper.v1'))).toContain('test-key-123');
  await openAutoTab(page);
  await page.getByRole('region', { name: 'Species suggestions' }).getByRole('button', { name: 'Online helper settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Online helper (optional)' });
  await expect(dialog.getByLabel('Your Gemini API key')).toHaveValue('test-key-123');
  await dialog.getByRole('button', { name: 'Remove key and turn off' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kestrel.helper.v1'))).toBeNull();
  await expect(page.getByRole('region', { name: 'Species suggestions' }).getByRole('button', { name: 'Or set up the optional online helper' })).toBeVisible();
});
