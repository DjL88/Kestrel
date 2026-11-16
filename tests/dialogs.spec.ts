import { expect, test, type Locator, type Page } from '@playwright/test';
import { openExportDialog } from './helpers';

/**
 * Every dialog, pop-up and sheet, at the sizes people really use. Each one must fit the screen, never make the page
 * scroll sideways, keep every control reachable and uncovered, close with Escape and give focus back.
 */
const PHONE = [{ n: 'phone', w: 390, h: 844 }, { n: 'small phone', w: 360, h: 640 }, { n: 'narrow phone', w: 320, h: 568 }, { n: 'phone on its side', w: 844, h: 390 }];
const DESKTOP = [{ n: 'laptop', w: 1280, h: 800 }, { n: 'small laptop', w: 1024, h: 640 }, { n: 'tablet', w: 768, h: 1024 }];

/** Look at a panel as a person would: is it all on screen, and can every control be reached? Returns what is wrong. */
async function problemsWith(root: Locator, touch: boolean, inline: boolean): Promise<string[]> {
  return root.evaluate((element, [isTouch, isInline]) => {
    const out: string[] = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    const outer = element.getBoundingClientRect();
    // A full-screen overlay holds the real panel as its first child.
    const panel = (outer.width >= vw * 0.95 && outer.height >= vh * 0.95 && element.firstElementChild ? element.firstElementChild : element) as HTMLElement;
    const box = panel.getBoundingClientRect();
    // An overlay must fit. Inline content (a side panel, a form on the page) scrolls, so only its width matters.
    if (isInline ? (box.left < -1 || box.right > vw + 1) : (box.left < -1 || box.top < -1 || box.right > vw + 1 || box.bottom > vh + 1)) out.push(`the panel is off the screen (${Math.round(box.left)},${Math.round(box.top)} to ${Math.round(box.right)},${Math.round(box.bottom)} on ${vw}x${vh})`);
    if (document.documentElement.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide on ${vw})`);
    // Text must not be half hidden under a header or bar. Look at the top of the panel as it first opens, before anything is scrolled.
    for (const scroller of [panel, ...panel.querySelectorAll<HTMLElement>('*')]) if (scroller.scrollTop) scroller.scrollTop = 0;
    for (const text of panel.querySelectorAll<HTMLElement>('[role="status"], [role="alert"], h2, h3, h4')) {
      if (text.closest('[inert], [aria-hidden="true"], [hidden], details:not([open])') && text.tagName !== 'SUMMARY') continue;
      const t = text.getBoundingClientRect();
      if (t.width <= 1 || t.height <= 1 || t.top > box.top + 140 || t.bottom < box.top) continue;
      for (const [x, y] of [[t.left + 3, t.top + 3], [t.left + t.width / 2, t.top + t.height / 2]]) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !text.contains(hit) && !hit.contains(text)) { out.push(`"${(text.textContent ?? '').trim().slice(0, 30)}" is partly hidden under something`); break; }
      }
    }
    const name = (el: Element) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 36);
    const seen = new Set<string>();
    for (const el of panel.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [role="slider"]')) {
      if (el.closest('[inert], [aria-hidden="true"], [hidden]')) continue;
      // Hidden inside a closed accordion, possibly one nested in another closed accordion: not on screen, so not checked.
      let hiddenAway = false;
      for (let d: HTMLElement | null = el.parentElement; d && d !== panel.parentElement; d = d.parentElement) {
        if (d.tagName === 'DETAILS' && !(d as HTMLDetailsElement).open && !(el.tagName === 'SUMMARY' && el.parentElement === d)) { hiddenAway = true; break; }
      }
      if (hiddenAway) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      r = el.getBoundingClientRect();
      const label = name(el) || el.tagName;
      if (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 || r.top < -1) { out.push(`${label} is off the screen`); continue; }
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top && !el.contains(top) && !top.contains(el) && !(el instanceof HTMLInputElement && el.labels && [...el.labels].some((l) => l.contains(top)))) out.push(`${label} is covered by ${name(top)}`);
      const size = Math.min(r.width, r.height);
      const key = `${label}|${Math.round(size)}`;
      // Check boxes and radios are small by nature but sit inside a larger label.
      const inLabel = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'range') && el.closest('label');
      if (isTouch && size < 40 && !inLabel && !seen.has(key)) { seen.add(key); out.push(`${label} is small (${Math.round(r.width)}x${Math.round(r.height)})`); }
    }
    // Nothing inside may stick out sideways past the panel, unless it is a scroller made for that.
    for (const el of panel.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || el.closest('[aria-hidden="true"], [inert], svg')) continue;
      let scroller = false;
      for (let p: HTMLElement | null = el.parentElement; p && p !== panel; p = p.parentElement) { if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) { scroller = true; break; } }
      if (!scroller && (r.right > box.right + 2 || r.left < box.left - 2) && getComputedStyle(el).position !== 'fixed') { out.push(`${name(el)} sticks out sideways`); break; }
    }
    return out;
  }, [touch, inline] as const);
}

const report: string[] = [];
async function audit(page: Page, label: string, root: Locator, touch: boolean, inline = false) {
  await expect(root).toBeVisible();
  // Panels slide in over a moment. Measure them once they have settled, not mid-slide.
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]));
  // DIALOG_SHOTS=1 saves a picture of each one, to look at as a person would.
  if (process.env.DIALOG_SHOTS) { await page.screenshot({ path: `test-results/dialogs/${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png` }); }
  const problems = await problemsWith(root, touch, inline);
  const where = `${label} at ${page.viewportSize()!.width}x${page.viewportSize()!.height}`;
  for (const problem of problems) report.push(`${where}: ${problem}`);
}

async function project(page: Page, name = 'Dialogs', photos = 4) {
  await page.goto('/');
  const pictures = await page.evaluate((count) => Array.from({ length: count }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 500;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#3b556b'; c.fillRect(0, 0, 800, 500);
    c.fillStyle = '#c0392b'; c.beginPath(); c.ellipse(560 - index * 40, 250, 130, 160, 0, 0, 7); c.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  }), photos);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByText('Project options', { exact: true }).click();
  await page.getByRole('checkbox', { name: /Auto-cull/ }).uncheck();
  await page.getByRole('checkbox', { name: /Auto-edit/ }).uncheck();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await page.getByTestId('local-file-input').setInputFiles(pictures.map((data, index) => ({ name: `bird-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
  await expect(page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: `To review ${photos}` })).toBeVisible({ timeout: 30000 });
}

/** Escape closes it, and keyboard focus lands on a real control instead of being lost to the page. */
async function closes(page: Page, root: Locator) {
  await page.keyboard.press('Escape');
  await expect(root).toBeHidden();
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement && document.activeElement !== document.body)), { message: 'focus is lost after closing' }).toBe(true);
}

const menu = async (page: Page) => { await page.getByRole('button', { name: 'More', exact: true }).or(page.getByRole('button', { name: 'Workspace options' })).click(); return page.locator('#workspace-options'); };
const allPhotos = (page: Page) => page.getByRole('navigation', { name: 'Photo collections' }).getByRole('button', { name: /^All photos/ }).click();
const inMenu = async (page: Page, name: RegExp | string) => { const m = await menu(page); await m.getByRole('button', { name }).click(); };

interface Scenario { name: string; run: (page: Page, touch: boolean, check: (label: string, root: Locator, inline?: boolean) => Promise<void>) => Promise<void> }

const scenarios: Scenario[] = [
  { name: 'new project form', run: async (page, _t, check) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New project' }).click();
    await check('new project', page.getByRole('form').first(), true);
    await page.getByRole('textbox', { name: 'Project name' }).fill('Look');
    await page.getByText('Project options', { exact: true }).click();
    await check('new project options', page.getByRole('form').first(), true);
  } },
  { name: 'add photos', run: async (page, _t, check) => {
    await project(page, 'Add', 1);
    await page.getByRole('button', { name: 'Add photos to project' }).click();
    await check('add photos', page.getByRole('dialog'));
    await closes(page, page.getByRole('dialog'));
  } },
  { name: 'workspace menu', run: async (page, _t, check) => { await project(page); const m = await menu(page); await check('workspace menu', m); await closes(page, m); } },
  { name: 'photo info', run: async (page, _t, check) => {
    await project(page);
    await page.getByRole('button', { name: 'Photo info and rating for bird-1.png' }).click();
    await check('photo info', page.getByRole('complementary', { name: 'Photo info' }));
    await page.getByRole('button', { name: 'Close photo info' }).click();
    await expect(page.getByRole('complementary', { name: 'Photo info' })).toBeHidden();
  } },
  { name: 'auto-cull', run: async (page, _t, check) => { await project(page); await inMenu(page, /Auto-cull/); await check('auto-cull', page.getByRole('dialog', { name: /Auto-cull/ })); await closes(page, page.getByRole('dialog', { name: /Auto-cull/ })); } },
  { name: 'macro pad', run: async (page, _t, check) => { await project(page); await inMenu(page, /Macro pad/); await check('macro pad', page.getByRole('dialog').first()); await closes(page, page.getByRole('dialog').first()); } },
  { name: 'remove from library and removed photos', run: async (page, _t, check) => {
    await project(page);
    await allPhotos(page);
    await page.getByRole('article', { name: 'Frame bird-1.png' }).getByRole('button', { name: /to Trash/ }).click();
    await page.getByRole('button', { name: 'View bird-1.png' }).click();
    await inMenu(page, /Remove from library/);
    const confirm = page.getByRole('alertdialog');
    await check('remove from library', confirm);
    await confirm.getByRole('button', { name: 'Remove from library' }).click();
    await inMenu(page, /Removed photos/);
    await check('removed photos', page.getByRole('alertdialog'));
    await closes(page, page.getByRole('alertdialog'));
  } },
  { name: 'trash a keeper', run: async (page, _t, check) => {
    await project(page);
    await allPhotos(page);
    await page.getByRole('article', { name: 'Frame bird-1.png' }).getByRole('button', { name: /^Keep/ }).click();
    await page.getByRole('article', { name: 'Frame bird-1.png' }).getByRole('button', { name: /to Trash/ }).click();
    await check('trash a keeper', page.getByRole('alertdialog'));
    await closes(page, page.getByRole('alertdialog'));
  } },
  { name: 'export wizard', run: async (page, _t, check) => {
    await project(page, 'Export', 1);
    await page.getByRole('button', { name: 'View bird-1.png' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('tab', { name: 'Crop' }).waitFor();
    await openExportDialog(page);
    const dialog = page.getByRole('dialog', { name: /Export/ });
    await check('export: where to', dialog);
    await dialog.getByRole('button', { name: 'Instagram' }).click();
    await check('export: size', dialog);
    await dialog.getByRole('checkbox', { name: /Post · 4:5/ }).check();
    await dialog.getByRole('checkbox', { name: /Square/ }).check();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await check('export: position', dialog);
    await dialog.getByRole('button', { name: /^Next/ }).click();
    await check('export: position 2', dialog);
    await dialog.getByRole('button', { name: /^Next/ }).click();
    await check('export: review', dialog);
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: 'Show all formats at once' }).click();
    await check('export: all formats', dialog);
    await dialog.getByLabel('Custom size').check();
    await check('export: custom size', dialog);
    await dialog.getByRole('button', { name: 'Guide me step by step' }).click();
    await closes(page, dialog);
  } },
  { name: 'export results', run: async (page, _t, check) => {
    await project(page, 'Results', 1);
    await page.getByRole('button', { name: 'View bird-1.png' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('tab', { name: 'Crop' }).waitFor();
    await openExportDialog(page);
    const dialog = page.getByRole('dialog', { name: /Export/ });
    await dialog.getByRole('button', { name: 'Instagram' }).click();
    await dialog.getByRole('checkbox', { name: /Post · 4:5/ }).check();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: /^Next/ }).click();
    await dialog.getByRole('button', { name: /^Prepare/ }).click();
    await expect(dialog.getByRole('status').filter({ hasText: /ready/ })).toBeVisible({ timeout: 30000 });
    await check('export: results', dialog);
    await closes(page, dialog);
  } },
  { name: 'online helper', run: async (page, _t, check) => {
    await project(page);
    const banner = page.getByRole('region', { name: 'Species recognition' });
    await banner.getByText('Identify birds and animals', { exact: true }).click();
    await banner.getByRole('button', { name: 'Online helper settings' }).click();
    await check('online helper', page.getByRole('dialog', { name: /Online helper/ }));
    await closes(page, page.getByRole('dialog', { name: /Online helper/ }));
  } },
  { name: 'editor tabs', run: async (page, _t, check) => {
    await project(page, 'Editor', 1);
    await page.getByRole('button', { name: 'View bird-1.png' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('tab', { name: 'Crop' }).waitFor();
    for (const tab of ['Auto', 'Crop', 'Edit', 'Masks', 'History']) {
      const t = page.getByRole('tab', { name: tab, exact: true });
      if ((await t.getAttribute('aria-selected')) !== 'true') await t.click();
      await check(`editor tab ${tab}`, page.getByRole('tabpanel', { name: tab }), true);
    }
  } },
];

test.use({ actionTimeout: 8000 });

test.afterAll(() => { if (report.length) console.log('\nPROBLEMS\n' + [...new Set(report)].join('\n')); });

for (const scenario of scenarios) {
  test(`dialogs fit and work: ${scenario.name}`, async ({ page }, info) => {
    if (scenario.name === 'macro pad') test.skip(true, 'Macro Pad is only exposed by the native desktop shell, not the browser test server.');
    test.setTimeout(150000);
    const phone = info.project.name === 'phone';
    const before = report.length;
    for (const size of phone ? PHONE : DESKTOP) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await scenario.run(page, phone, (label, root, inline) => audit(page, `${label} [${size.n}]`, root, phone, inline));
    }
    // Every problem found is a failure, listed together so one run shows everything that needs fixing.
    expect([...new Set(report.slice(before))], 'problems found').toEqual([]);
  });
}
