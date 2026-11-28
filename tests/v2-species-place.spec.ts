import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unlockPro } from './helpers';

// The stand-in species model always "sees" a red kite, and the stand-in subject checker always "sees" a bird.
const standIn = readFileSync('tests/fixtures/stand-in-species.onnx');
const standInGate = readFileSync('tests/fixtures/stand-in-gate.onnx');
// Synthetic drawn photos with GPS in their EXIF (tests/fixtures/make_gps_fixtures.py): London and Caracas.
const london = readFileSync('tests/fixtures/gps-london.jpg');
const caracas = readFileSync('tests/fixtures/gps-caracas.jpg');

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Info is reached from the desktop rail in this check');
});

test('?v2 where were these taken: no question for home photos, one small question for photos from elsewhere, and the list used beside the name', async ({ page }) => {
  await page.route('**/stand-in-species.onnx', (route) => route.fulfill({ body: standIn, contentType: 'application/octet-stream' }));
  await page.route('**/stand-in-gate.onnx', (route) => route.fulfill({ body: standInGate, contentType: 'application/octet-stream' }));
  await unlockPro(page);
  await page.goto('/?v2');
  // The species model and the subject checker are already on this device, as after the person's own download.
  await page.evaluate(async ([species, gate]) => {
    const cache = await caches.open('kestrel-species-v1');
    await cache.put('/stand-in-species.onnx', new Response(new Uint8Array(species), { headers: { 'content-type': 'application/octet-stream' } }));
    await cache.put('/stand-in-gate.onnx', new Response(new Uint8Array(gate), { headers: { 'content-type': 'application/octet-stream' } }));
  }, [Array.from(standIn), Array.from(standInGate)]);
  await page.reload();

  const root = page.locator('.inflight-v2');
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel(/name/i).first().fill('Trip');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  const options = root.getByRole('listbox', { name: 'Project photographs' }).getByRole('option');
  const importFile = async (name: string, buffer: Buffer) => {
    const chooser = page.waitForEvent('filechooser');
    await root.getByRole('button', { name: /^Import/ }).first().click();
    await (await chooser).setFiles([{ name, mimeType: 'image/jpeg', buffer }]);
  };

  // A photo taken at home: named quietly from the home region's list, and no question is asked.
  await importFile('london.jpg', london);
  await expect(options).toHaveCount(1, { timeout: 30000 });
  await options.first().click();
  await root.getByRole('button', { name: 'Info', exact: true }).first().click();
  const used = root.getByTestId('species-area-used');
  await expect(used).toHaveText('Species list used: Europe, North Africa and northern Asia', { timeout: 60000 });
  await expect(root.getByRole('combobox', { name: 'Where were these taken?' })).toBeVisible();

  // The finding reads as a plain name (no "(suggested)"); its actions sit behind one menu that Escape closes.
  await expect(root.getByText('(suggested)')).toHaveCount(0);
  const actions = root.getByRole('button', { name: 'More actions for the subject' });
  await actions.focus();
  await page.keyboard.press('Enter');
  await expect(root.getByRole('menuitem', { name: 'Edit manually' })).toBeVisible();
  await expect(root.getByRole('menuitem', { name: 'Detect subject' })).toBeVisible();
  await expect(root.getByRole('menuitem', { name: 'Edit manually' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(root.getByRole('menu')).toHaveCount(0);
  await expect(actions).toBeFocused();
  await actions.click();
  await root.getByRole('menuitem', { name: 'Edit manually' }).click();
  await expect(root.getByRole('combobox', { name: 'Correct species name' })).toBeVisible();
  await page.keyboard.press('Escape');
  await root.getByRole('button', { name: 'Cancel' }).first().click();
  const prompt = root.getByTestId('species-place-prompt');
  await expect(prompt).toHaveCount(0);

  // A photo from Venezuela: the one small question, offering the photos' own places (read on this device).
  await importFile('caracas.jpg', caracas);
  await expect(options).toHaveCount(2, { timeout: 30000 });
  await expect(prompt).toContainText('These photos\' locations are outside your home region.', { timeout: 20000 });
  await expect(prompt).toContainText('The locations are not sent anywhere.');
  await expect(prompt.getByRole('button', { name: 'Photos\' locations: Europe, North Africa and northern Asia, Central and South America' })).toBeVisible();
  await expect(prompt.getByRole('button', { name: 'Worldwide' })).toBeVisible();

  // "Not now" answers it for this project: the question goes and does not come back.
  await prompt.getByRole('button', { name: 'Not now' }).click();
  await expect(prompt).toHaveCount(0);

  // Worldwide from the quiet setting in Info: the app's own name is looked at again, and the note says which list.
  await options.first().click();
  await root.getByRole('combobox', { name: 'Where were these taken?' }).selectOption('world');
  await expect(used).toHaveText('Species list used: Worldwide', { timeout: 60000 });
  await expect(prompt).toHaveCount(0);
});
