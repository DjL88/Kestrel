import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { collabClient } from '../src/providers/collabClient.ts';

/**
 * UAT for client sharing (board x-uat-share, DAVE-TODO 7.5), end to end: the real control plane
 * (services/control-plane/test/uatShareServer.ts: routes, collaboration and gallery stores, mailer, on the Firestore
 * emulator when FIRESTORE_EMULATOR_HOST is set and the in-memory fake otherwise), the app's own sharing client for two
 * synthetic accounts, and the real client gallery page in a browser with no account. Only the outside world is fake:
 * Firebase sign-in, the preview bucket and SMTP.
 */

const OWNER = { email: 'owner.uat@example.test', name: 'Dana (owner)' };
const TEAM = { email: 'team.uat@example.test', name: 'Sam (team)' };
const CLIENT_EMAIL = 'client.uat@example.test';
const TEAM_SECRET = 'TEAM-ONLY: crop tighter, the client must never read this';
const OWNER_SECRET = 'TEAM-ONLY: owner note about the fee';

interface ShareServer {
  controlPlane: string; storage: string; firestoreKind: string; sent: { to: string; raw: string }[];
  idToken(email: string): () => Promise<string>; accountIdFor(email: string): Promise<string>; grantSharingPlan(accountId: string): Promise<void>; close(): Promise<void>;
}
// Loaded by path at run time, so the app's type check (tsconfig.json leaves services/ to its own) does not take in the
// control plane; services/control-plane checks that file itself.
const SHARE_SERVER = '../services/control-plane/test/uatShareServer.ts';

/** The plain-text part of a message the mailer built (its parts are base64). */
const mailText = (raw: string) => {
  const part = raw.split(/\r?\n--=_inflight_[0-9a-f]+/).find((p) => /Content-Type: text\/plain/.test(p)) ?? '';
  return Buffer.from(part.split(/\r?\n\r?\n/).slice(1).join('').replace(/\s+/g, ''), 'base64').toString('utf8');
};

async function startWorld() {
  const { startShareServer } = await import(SHARE_SERVER) as { startShareServer(): Promise<ShareServer> };
  const cp = await startShareServer();
  const { startSiteServer } = await import('../scripts/site/serve-site.mjs');
  const siteServer: Server = await startSiteServer(0);
  const site = `http://127.0.0.1:${(siteServer.address() as AddressInfo).port}`;
  const owner = collabClient(cp.controlPlane, cp.idToken(OWNER.email), undefined, 'en-GB');
  const team = collabClient(cp.controlPlane, cp.idToken(TEAM.email), undefined, 'en-GB');
  // Both people sign in once, so their accounts exist; the owner holds the plan that shares projects.
  await owner.myProjects(); await team.myProjects();
  const ownerAccountId = await cp.accountIdFor(OWNER.email);
  const teamAccountId = await cp.accountIdFor(TEAM.email);
  await cp.grantSharingPlan(ownerAccountId);
  return {
    controlPlane: cp.controlPlane, storage: cp.storage, firestoreKind: cp.firestoreKind, sent: cp.sent, site, owner, team, ownerAccountId, teamAccountId,
    close: async () => { await new Promise<void>((r) => siteServer.close(() => r())); await cp.close(); },
  };
}

/** Two small, different synthetic photos, made as JPEGs in the browser (no real photo is used). */
async function syntheticJpegs(page: Page): Promise<Blob[]> {
  await page.goto('about:blank');
  const made = await page.evaluate(async () => Promise.all(['#2b5f8a', '#b4632a'].map(async (colour, i) => {
    const canvas = new OffscreenCanvas(320, 213);
    const g = canvas.getContext('2d')!;
    g.fillStyle = colour; g.fillRect(0, 0, 320, 213);
    g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText(`P${i + 1}`, 20, 120);
    return [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer())];
  })));
  return made.map((bytes) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
}

test('client sharing end to end: owner shares, client reviews with no account, team comments stay private', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const world = await startWorld();
  testInfo.annotations.push({ type: 'firestore', description: world.firestoreKind });
  try {
    const { owner, team, sent } = world;
    let projectId = '';
    let galleryId = '';
    let link = '';

    await test.step('1. Owner shares a project and invites a team member by email (fake mailer)', async () => {
      projectId = await owner.create('Raptor shoot UAT', OWNER.name);
      const view = await owner.invite(projectId, TEAM.email, 'editor');
      expect(view.invites.map((i) => i.role)).toEqual(['editor']);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(TEAM.email);
      expect(sent[0].raw).toMatch(/^From: .*hello@inflight\.studio/m);
      expect(mailText(sent[0].raw)).toContain('Raptor shoot UAT');
      expect(mailText(sent[0].raw)).toContain(OWNER.name);
      expect(sent[0].raw).toMatch(/List-Unsubscribe: <https:\/\/inflight\.studio\/v1\/mail\/unsubscribe/);
    });

    await test.step('2. The team member sees the invitation in the app and joins', async () => {
      expect((await team.invites()).map((i) => [i.projectId, i.role])).toEqual([[projectId, 'editor']]);
      await team.accept(projectId, TEAM.name);
      const view = await owner.project(projectId);
      expect(view.members.map((m) => [m.displayName, m.role]).sort()).toEqual([[OWNER.name, 'owner'], [TEAM.name, 'editor']]);
    });

    await test.step('3. The team leaves private comments on the photos', async () => {
      await team.addComment(projectId, 'photo-1', TEAM_SECRET, { x: 0.4, y: 0.5 });
      await owner.addComment(projectId, 'photo-2', OWNER_SECRET, null);
      expect((await owner.comments(projectId, 'photo-1')).map((c) => c.text)).toEqual([TEAM_SECRET]);
      expect((await team.comments(projectId, 'photo-2')).map((c) => c.text)).toEqual([OWNER_SECRET]);
    });

    await test.step('4. A client invitation by email goes out, and says nothing of the team comments', async () => {
      await owner.invite(projectId, CLIENT_EMAIL, 'client', ['photo-1']);
      const mail = sent.find((m) => m.to === CLIENT_EMAIL);
      expect(mail, 'an invitation email to the client').toBeTruthy();
      const text = mailText(mail!.raw);
      expect(text).toContain('Raptor shoot UAT');
      for (const leak of ['TEAM-ONLY', 'photo-', TEAM.name, TEAM.email]) expect(text).not.toContain(leak);
    });

    await test.step('5. Owner publishes two photos to a client gallery link with a password', async () => {
      const maker = await browser.newContext();
      const [one, two] = await syntheticJpegs(await maker.newPage());
      await maker.close();
      const made = await owner.publishGallery(projectId, {
        name: 'Raptor selects', photoIds: ['photo-1', 'photo-2'], days: 14, password: 'kestrel-uat-pass',
        allowComments: true, allowFavourites: true, allowApproval: true, allowDownloads: false, watermark: true,
      }, [{ photoId: 'photo-1', jpeg: one }, { photoId: 'photo-2', jpeg: two }]);
      expect(made.published).toBe(2);
      galleryId = made.galleryId;
      // The link exactly as the Share dialog builds it (src/v2/ui/dialogs/ShareDialog.tsx).
      link = `${world.site.replace(/\/+$/, '')}/gallery#t=${encodeURIComponent(made.linkToken)}`;
      expect((await owner.galleries(projectId)).map((g) => [g.name, g.published, g.password])).toEqual([['Raptor selects', 2, true]]);
    });

    // The test's own page (desktop or phone project): a fresh context with no cookies, storage or account. Its
    // /v1/gallery calls reach the real control plane, as Firebase Hosting forwards them in production.
    const client = page;
    const seen: { url: string; body: string }[] = [];
    await client.route('**/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: world.controlPlane + url.pathname + url.search });
      const body = await response.text();
      seen.push({ url: url.pathname, body });
      await route.fulfill({ response, body });
    });
    const requests: { url: string; auth: boolean; cookie: boolean }[] = [];
    client.on('request', (r) => requests.push({ url: r.url(), auth: 'authorization' in r.headers(), cookie: 'cookie' in r.headers() }));

    await test.step('6. Client opens the link with no account, enters the password and sees only the two photos', async () => {
      await client.goto(link);
      await client.getByLabel('This gallery has a password').fill('wrong-password');
      await client.getByRole('button', { name: 'Open' }).click();
      await expect(client.locator('#status')).toContainText('did not match');
      await client.getByLabel('This gallery has a password').fill('kestrel-uat-pass');
      await client.getByRole('button', { name: 'Open' }).click();
      await expect(client.getByRole('heading', { name: 'Raptor selects' })).toBeVisible();
      await expect(client.getByRole('navigation', { name: 'Photographs' }).getByRole('button')).toHaveCount(2);
      await expect(client.locator('#proof')).toBeVisible();
      await expect(client.locator('#download')).toBeHidden();
      // The published preview really loads (bytes from the bucket, not a placeholder).
      await expect.poll(() => client.locator('#photo').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(320);
    });

    await test.step('7. Client favourites photo 2 and comments on photo 1 and photo 2', async () => {
      await client.getByLabel('Comment on this photo').fill('Love this one, can we have it larger?');
      await client.getByRole('button', { name: 'Send comment' }).click();
      await expect(client.locator('#note')).toHaveText('Comment sent. Thank you.');
      await client.keyboard.press('ArrowRight');
      await expect(client.locator('#counter')).toHaveText('2 of 2');
      await client.getByRole('button', { name: /Favourite/ }).click();
      await expect(client.getByRole('button', { name: /Favourite/ })).toHaveAttribute('aria-pressed', 'true');
      await client.getByLabel('Comment on this photo').fill('A touch warmer please');
      await client.getByRole('button', { name: 'Request changes' }).click();
      await expect(client.locator('#note')).toHaveText('Change request sent to the photographer.');
    });

    await test.step('8. The favourite and comments land on the right photos for the owner and the team', async () => {
      const { events } = await owner.galleryFeedbackWithReviews(galleryId);
      expect(events.map((e) => [e.photoId, e.kind, e.text])).toEqual([
        ['photo-1', 'comment', 'Love this one, can we have it larger?'],
        ['photo-2', 'favourite', null],
        ['photo-2', 'request-changes', 'A touch warmer please'],
      ]);
      expect(new Set(events.map((e) => e.visitor)).size).toBe(1);
      // An editor manages galleries too, and reads the same feedback.
      expect((await team.galleryFeedback(galleryId)).length).toBe(3);
      // Client feedback stays in the gallery: it never becomes a team comment, nor changes one.
      expect((await owner.comments(projectId, 'photo-1')).map((c) => c.text)).toEqual([TEAM_SECRET]);
      expect((await owner.comments(projectId, 'photo-2')).map((c) => c.text)).toEqual([OWNER_SECRET]);
    });

    await test.step('9. Nothing the client received holds a team comment, an account, the project or another photo', async () => {
      await expect(client.locator('body')).not.toContainText('TEAM-ONLY');
      expect(seen.length).toBeGreaterThanOrEqual(5);
      for (const { url, body } of seen) {
        for (const secret of ['TEAM-ONLY', world.ownerAccountId, world.teamAccountId, projectId, OWNER.email, TEAM.email, CLIENT_EMAIL, OWNER.name, TEAM.name, 'authorAccountId']) {
          expect(body, `${url} must not carry ${secret}`).not.toContain(secret);
        }
      }
      // The page never sends a credential or cookie, and talks only to its own site and the preview bucket.
      expect(requests.filter((r) => r.auth || r.cookie)).toEqual([]);
      expect(requests.filter((r) => !r.url.startsWith(world.site) && !r.url.startsWith(world.storage))).toEqual([]);
    });

    await test.step('10. With no account the client cannot reach the team comments or a photo outside the gallery', async () => {
      const token = decodeURIComponent(new URL(link).hash.slice('#t='.length));
      const direct = await client.evaluate(async ({ cp, pid, token }) => {
        const get = await fetch(`${cp}/v1/collab/projects/${pid}/photos/photo-1/comments`);
        const other = await fetch('/v1/gallery/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: 'kestrel-uat-pass', visitor: 'x'.repeat(32), photoId: 'photo-3', kind: 'comment', text: 'not in this gallery' }) });
        return { comments: get.status, commentsBody: await get.text(), outside: other.status };
      }, { cp: world.controlPlane, pid: projectId, token });
      expect(direct.comments).toBe(401);
      expect(direct.commentsBody).not.toContain('TEAM-ONLY');
      expect(direct.outside).toBe(404);
    });

    await test.step('11. Revoking the link closes it for the client', async () => {
      await owner.revokeGallery(galleryId);
      await client.reload();
      await expect(client.locator('#status')).toContainText('not valid');
    });
  } finally { await world.close(); }
});
