import { expect, test } from '@playwright/test';

// Runs on the Vite dev server (`npm run test:e2e:dev`): it drives the app's own scheduler module by URL.
// Owner, 27 Nov: "the messaging in the task manager jumps as the text changes and resizes the box. Would be good to make
// the box size static to the largest entry on that run." A running card never gets shorter as its words change.

declare global {
  interface Window { __setStage?: (stage: string) => void; __finishTask?: () => void }
}

test('?v2 a running task card never shrinks as its stage text goes short, long, short', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'The rail with the Tasks wheel is the desktop layout.');
  await page.goto('/?v2', { waitUntil: 'domcontentloaded' });
  const root = page.locator('.inflight-v2');
  await expect(root.getByText('No projects yet')).toBeVisible({ timeout: 60_000 });
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Steady cards');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await expect(root.getByTestId('tasks-wheel')).toBeVisible();

  await page.evaluate(async () => {
    // @ts-ignore browser URL, resolved by the dev server (the same module instance the app uses)
    const { engineScheduler } = await import('/src/core/engineScheduler.ts');
    await engineScheduler.submit({
      title: 'Developing RAW files', kind: 'raw', resource: 'cpu', snapshot: undefined, items: ['one'],
      itemId: (item: string) => item, itemLabel: () => 'DSC_0001.NEF',
      runItem: (_item: string, _snapshot: undefined, ctx: { stage(stage: string): void }) => new Promise<void>(resolve => {
        window.__setStage = (stage: string) => ctx.stage(stage);
        window.__finishTask = resolve;
      }),
    });
  });

  await root.getByTestId('tasks-wheel').click();
  const card = root.locator('[data-testid="task-row"]').first();
  await expect(card).toBeVisible();
  const height = async () => (await card.boundingBox())!.height;
  const stage = card.getByTestId('task-stage');

  await page.evaluate(() => window.__setStage?.('Reading'));
  await expect(stage).toContainText('Reading');
  const short = await height();
  await page.evaluate(() => window.__setStage?.('Developing sensor pixels at full size from the camera’s RAW data, checking each tile against the original fingerprint, then matching the camera’s own preview orientation before saving'));
  await expect(stage).toContainText('Developing sensor pixels');
  const long = await height();
  expect(long).toBeGreaterThanOrEqual(short);
  // The long words are kept to two lines; the full text is in the tooltip.
  await expect(stage).toHaveAttribute('title', /matching the camera’s own preview orientation/);
  await page.evaluate(() => window.__setStage?.('Saving'));
  await expect(stage).toContainText('Saving');
  expect(await height(), 'never shorter while it runs').toBeGreaterThanOrEqual(long);

  await page.evaluate(() => window.__finishTask?.());
});
