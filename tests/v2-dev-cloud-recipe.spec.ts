import { expect, test, type Page } from '@playwright/test';

// Runs on the Vite dev server (`npm run test:e2e:dev`): tests/harness/cloud-recipe.html mounts the real Cloud edit
// settings card, offer, consent and transport against an in-page control plane and bucket that run the real runner maths.
// The picture is synthetic. Nothing leaves the page.

test.beforeAll(async ({ request }) => {
  test.setTimeout(420_000);
  await request.get('/src/index.css', { timeout: 400_000 });
  await request.get('/src/v2/ui/v2.css', { timeout: 400_000 });
});

async function open(page: Page, query = '') {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.goto(`/tests/harness/cloud-recipe.html${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page.getByRole('heading', { name: /Cloud edit settings/ })).toBeVisible({ timeout: 60_000 });
      return;
    } catch (error) { if (attempt >= 1) throw error; }
  }
}

const cloud = (page: Page) => page.evaluate(() => {
  const c = (window as unknown as { cloud: { log: string[]; objects: Map<string, Uint8Array> } }).cloud;
  return { log: [...c.log], objects: [...c.objects.keys()] };
});

test('asked once, then a run goes up, comes back as edit settings, and the cloud copy is deleted', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await page.getByRole('button', { name: 'Get cloud edit settings' }).click();
  const send = page.getByRole('button', { name: /^Send .*preview copy \(2,560 px at most\)$/ });
  await expect(send).toBeVisible();
  expect((await cloud(page)).log, 'preparing the offer sends nothing').toEqual([]);

  await send.click();
  const ask = page.getByTestId('cloud-consent');
  await expect(ask.getByText("Use InFlight's cloud for this?")).toBeVisible();
  await expect(ask).toContainText('deletes its copy when the job ends');
  await expect(ask).toContainText('0.3p from your cloud balance');
  expect((await cloud(page)).log, 'nothing goes before the yes').toEqual([]);
  await ask.getByRole('button', { name: 'Yes, use the cloud' }).click();

  await expect(page.getByRole('status')).toHaveText("Applied the cloud's edit settings. Undo takes them back.", { timeout: 30_000 });
  await expect(page.getByTestId('applied')).not.toHaveText('');
  // Dave, 27 Nov: the cloud's work is visible. What changed, in plain words, and a quick compare beside the photo.
  const result = page.getByTestId('cloud-recipe-result');
  await expect(result).toContainText('What changed');
  await expect(page.getByTestId('cloud-recipe-changes')).toHaveText(/^[A-Z][a-z ]+ [+\u2212][0-9.]+( · [A-Z][a-z ]+ [+\u2212][0-9.]+)*$/);
  // The control plane confirmed its copy was deleted, and that reached the result.
  expect(JSON.parse(await page.getByTestId('applied').textContent() ?? '{}').inputDeleted).toBe(true);
  const compare = page.getByTestId('cloud-recipe-compare');
  const box = (await compare.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('previewing')).not.toHaveText('', { timeout: 5_000 });
  await expect(compare).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.up();
  await expect(page.getByTestId('previewing')).toHaveText('');
  // And from the keyboard: held with Space, back on release.
  await compare.focus();
  await page.keyboard.down(' ');
  await expect(page.getByTestId('previewing')).not.toHaveText('');
  await page.keyboard.up(' ');
  await expect(page.getByTestId('previewing')).toHaveText('');
  const after = await cloud(page);
  expect(after.log).toEqual(expect.arrayContaining(['POST /v1/cloud/jobs', 'PUT bucket:inputs/job-1', 'POST /v1/cloud/jobs/job-1/start', 'GET bucket:results/job-1', 'POST /v1/cloud/jobs/job-1/finish']));
  expect(after.objects, 'the upload and the result are gone once the run ends').toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kestrel.cloudConsent.v1') ?? '{}').answer)).toBe('yes');

  // Remembered: the next run is not asked again, and the person can stop it from the card.
  await page.reload();
  await expect(page.getByText('You said yes to using the cloud.')).toBeVisible();
  await page.getByRole('button', { name: 'Get cloud edit settings' }).click();
  await page.getByRole('button', { name: /^Send / }).click();
  await expect(page.getByTestId('cloud-consent')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText("Applied the cloud's edit settings. Undo takes them back.", { timeout: 30_000 });
  await page.getByRole('button', { name: 'Stop using the cloud' }).click();
  await expect(page.getByText('You chose to keep this on your device.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get cloud edit settings' })).toHaveCount(0);
});

test('saying no sends nothing; a used-up month says so plainly and offers Top up; a failed run is not applied', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  await page.getByRole('button', { name: 'Get cloud edit settings' }).click();
  await page.getByRole('button', { name: /^Send / }).click();
  await page.getByRole('button', { name: 'No, keep it on this device' }).click();
  await expect(page.getByRole('status')).toHaveText('Kept on this device. Nothing was sent.');
  expect((await cloud(page)).log).toEqual([]);

  await page.evaluate(() => localStorage.setItem('kestrel.cloudConsent.v1', JSON.stringify({ answer: 'yes', atMs: Date.now(), version: 1 })));
  await open(page, '?quota=0');
  await page.getByRole('button', { name: 'Get cloud edit settings' }).click();
  await page.getByRole('button', { name: /^Send / }).click();
  await expect(page.getByRole('status')).toContainText("This month's cloud photos are used up", { timeout: 30_000 });
  await expect(page.getByRole('status')).not.toContainText('429');
  await page.getByRole('button', { name: 'Top up' }).click();
  await expect(page.getByTestId('applied')).toHaveText('top-up opened');
  expect((await cloud(page)).log, 'a refused start uploads nothing').toEqual(['POST /v1/cloud/jobs']);

  await open(page, '?fail=1');
  await page.getByRole('button', { name: 'Get cloud edit settings' }).click();
  await page.getByRole('button', { name: /^Send / }).click();
  await expect(page.getByRole('status')).toContainText('could not finish this photo. You were not charged.', { timeout: 30_000 });
  await expect(page.getByTestId('applied')).toHaveText('');
  expect((await cloud(page)).objects, 'a failed run leaves nothing in the bucket').toEqual([]);
});
