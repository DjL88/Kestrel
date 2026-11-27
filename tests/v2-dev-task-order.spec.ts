import { expect, test, type Page } from '@playwright/test';

// Runs on the Vite dev server (`npm run test:e2e:dev`): it drives the app's own scheduler module by URL.
// Three batches share one GPU slot, so each hands itself back to the queue between photographs.
// The owner reported that the Tasks list "jumps around" while that happens. Rows must keep their place.

declare global {
  interface Window { __releaseTaskOrderPhoto?: () => void }
}

const rowIds = (page: Page) => page.locator('.inflight-v2 [data-testid="task-row"]').evaluateAll(rows => rows.map(row => row.getAttribute('data-task-id')));

test('?v2 Tasks keeps each row in place while batches run, wait, and finish', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'The rail with the Tasks wheel is the desktop layout.');
  // The real store, not `stub=1`: the sample store never reads the scheduler.
  await page.goto('/?v2', { waitUntil: 'domcontentloaded' });
  const root = page.locator('.inflight-v2');
  await expect(root.getByText('No projects yet')).toBeVisible({ timeout: 60_000 });
  await root.getByRole('button', { name: 'New project' }).first().click();
  await page.getByLabel('Project name', { exact: true }).fill('Task order');
  await page.getByRole('dialog').getByRole('button', { name: /create|start|new project/i }).last().click();
  await expect(root.getByTestId('tasks-wheel')).toBeVisible();

  const ids = await page.evaluate(async () => {
    // @ts-ignore browser URL, resolved by the dev server (the same module instance the app uses)
    const { engineScheduler } = await import('/src/core/engineScheduler.ts');
    const waiting: (() => void)[] = [];
    window.__releaseTaskOrderPhoto = () => waiting.shift()?.();
    const submit = (title: string) => engineScheduler.submit({
      title, kind: 'other', resource: 'gpu', pauseable: true, snapshot: undefined,
      items: ['a', 'b', 'c'], itemId: (item: string) => item, itemLabel: (item: string) => `${title} ${item}`,
      runItem: () => new Promise<void>(resolve => { waiting.push(resolve); }),
    });
    const tickets = [await submit('First batch'), await submit('Second batch'), await submit('Third batch')];
    return tickets.map(ticket => String(ticket.taskId));
  });

  await root.getByTestId('tasks-wheel').click();
  const rows = root.locator('[data-testid="task-row"]');
  await expect(rows).toHaveCount(3);
  const initial = await rowIds(page);
  expect(initial).toEqual(ids);

  // Nine photographs, one at a time. The first batch runs, waits, runs again (round-robin);
  // after every photograph the rows are in exactly the same order, including once they finish.
  for (let photo = 0; photo < 9; photo++) {
    await page.evaluate(() => window.__releaseTaskOrderPhoto?.());
    await page.waitForTimeout(50);
    expect(await rowIds(page), `after photograph ${photo + 1}`).toEqual(initial);
  }
  // The state label exactly ('Completed · On this device'): a plain 'Completed' also matches a running batch's
  // '2 of 3 completed' (hasText ignores case), and the tab was then changed with two batches still running.
  await expect(rows.filter({ hasText: /Completed · On this device/ })).toHaveCount(3);
  expect(await rowIds(page)).toEqual(initial);

  // Finished rows move to Completed only when the person changes tab.
  await root.getByRole('tab', { name: /Completed/ }).click();
  await root.getByRole('tab', { name: /Active/ }).click();
  await expect(rows).toHaveCount(0);
});
