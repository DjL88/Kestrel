import { expect, test } from '@playwright/test';
import { openFlightChecks } from './helpers';

// Dave, 27 Nov: Cloud edits are chosen per project: "Use the cloud for: Nothing (default) · Best only · Top 50 · All
// photos", in the create-project dialog and later in the Flight panel. Choosing sends nothing. A run needs the one-time
// yes, asked in context and never pre-ticked. Nothing here reaches a server: the test stops before a run.
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The dialog and the panel are the same on every screen; checked once.');
  // The device's preview switch for cloud edit settings (off by default).
  await page.addInitScript((key) => { try { localStorage.setItem(key, '1'); } catch { /* the test then fails on the missing picker */ } }, 'kestrel.preview.cloudRecipe.v1');
});

test('?v2 a new project chooses Cloud edits, nothing is pre-chosen, and the panel asks once before anything can run', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => { if (/\/v1\/cloud\//.test(request.url())) requests.push(request.url()); });
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog');
  const picker = dialog.getByTestId('cloud-edits-choice');
  await expect(picker).toContainText('Use the cloud for');
  await expect(picker).toContainText('Runs and deletes');
  await expect(picker.getByRole('radio', { name: 'Nothing' })).toBeChecked();
  for (const name of ['Best only', 'Top 50', 'All photos']) await expect(picker.getByRole('radio', { name })).not.toBeChecked();
  // Reachable and settable from the keyboard.
  await picker.getByRole('radio', { name: 'Nothing' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(picker.getByRole('radio', { name: 'All photos' })).toBeChecked();
  await page.getByLabel('Project name', { exact: true }).fill('Cloud edits choice');
  await dialog.getByRole('button', { name: /create|start|new project/i }).last().click();

  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const x = c.getContext('2d')!; x.fillStyle = '#7a8a9a'; x.fillRect(0, 0, 300, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await root.getByRole('button', { name: /^Import/ }).first().click();
  await (await chooser).setFiles([1, 2].map((n) => ({ name: `cloud-${n}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await expect(root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option')).toHaveCount(2, { timeout: 30_000 });

  await openFlightChecks(root, root.getByRole('button', { name: /^(Co-pilot|Solo|Auto-pilot)$/ }));
  const card = root.getByTestId('cloud-edits-project');
  await expect(card.getByRole('radio', { name: 'All photos' })).toBeChecked();
  await expect(card.getByTestId('cloud-edits-count')).toContainText('2 to do · 2 chosen');
  // Not yet answered: the question is asked, no Run button, nothing ticked.
  await expect(root.getByTestId('cloud-edits-consent').first()).toContainText("Use InFlight's cloud for these photos?");
  await expect(card.getByTestId('cloud-edits-run')).toHaveCount(0);
  await card.getByRole('button', { name: 'No, keep it on this device' }).click();
  await expect(card).toContainText('You chose to keep this on your device.');
  await expect(card.getByTestId('cloud-edits-run')).toHaveCount(0);
  // Yes offers the run for the photos still to do; signed out, a run says so and sends nothing.
  await card.getByRole('button', { name: 'Ask me again' }).click();
  await card.getByRole('button', { name: 'Yes, use the cloud' }).click();
  const run = card.getByTestId('cloud-edits-run');
  await expect(run).toHaveText('Run Cloud edits for 2 photos');
  await run.click();
  await expect(card.getByTestId('cloud-edits-message')).toContainText(/Sign in to use Cloud edits\. Nothing was sent\./);
  // Back to Nothing: no count, no run.
  await card.getByRole('radio', { name: 'Nothing' }).check();
  await expect(card.getByTestId('cloud-edits-count')).toHaveCount(0);
  await expect(card.getByTestId('cloud-edits-run')).toHaveCount(0);
  expect(requests, 'nothing went to the cloud').toEqual([]);
});

test('?v2 with cloud edit settings off, no Cloud edits choice is shown anywhere', async ({ page }) => {
  await page.addInitScript((key) => { try { localStorage.removeItem(key); } catch { /* already absent */ } }, 'kestrel.preview.cloudRecipe.v1');
  await page.goto('/?v2');
  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await expect(page.getByRole('dialog').getByTestId('project-kind-photography')).toBeVisible();
  await expect(page.getByRole('dialog').getByTestId('cloud-edits-choice')).toHaveCount(0);
});
