/** Shared-project routes (/v1/collab/*). */
import type { Route } from './http.ts';
import { licenceIsUsable, type Store } from './store.ts';
import { emailHashOf } from './entitlement.ts';
import { MAX_RECIPE_BYTES } from './collaboration.ts';
import { CLOUD_VARIANTS } from './cloudPhotos.ts';
import { millicreditsForBytes } from './usageMeter.ts';
import { previewKey } from './gallery.ts';
import { cloudKey } from './cloudPhotos.ts';
import { presenceUid, PRESENCE_TOKEN_TTL_S } from './presenceToken.ts';
import { ApiError, parseJson, send } from './http.ts';
import { PhotoId, Schemas } from './appShared.ts';
import type { AppContext } from './appContext.ts';

export function collabRoutes(ctx: AppContext): Route[] {
  const { options, store, now, audit, bearer, accountIsPro, switchOn, collabCfg, collabWritable, collab, storageGate, cloudCfg, cloud, notify, galleryCfg, gallery, galleryOwner, safety } = ctx;
  async function requireProPayer(projectId: string) {
    const payer = await collab(() => collabCfg().payerOf(projectId));
    if (!(await accountIsPro(payer))) throw new ApiError(403, 'COLLAB_NOT_ENTITLED', 'Inviting people and client galleries are part of Pro.');
  }
  return [

  // ---- Shared projects (#1387 C01-C03). Membership, per-photo checkout and never-last-write-wins revisions.
  {
    method: 'POST', path: '/v1/collab/projects', summary: 'Share a new project (Pro). You become its owner', auth: 'user', body: Schemas.CollabCreate,
    handler: async (req) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CollabCreate, req.rawBody);
      const store_ = await collabWritable();
      if (!(await accountIsPro(claims.sub))) throw new ApiError(403, 'COLLAB_NOT_ENTITLED', 'Shared projects are part of Pro.');
      const project = await store_.createProject({ accountId: claims.sub, displayName: body.displayName }, body.name, now());
      await audit(claims.sub, 'collab.create', 'allowed', project.projectId);
      return { status: 200, body: { projectId: project.projectId } };
    },
  },
  {
    method: 'GET', path: '/v1/collab/projects', summary: 'The shared projects you belong to', auth: 'user',
    handler: async (req) => { const claims = await bearer(req); return { status: 200, body: { projects: await collabCfg().myProjects(claims.sub) } }; },
  },
  {
    method: 'GET', path: '/v1/collab/invites', summary: 'Invitations waiting for your email address', auth: 'user',
    handler: async (req) => { const claims = await bearer(req); const account = await store.getAccount(claims.sub); return { status: 200, body: { invites: await collabCfg().invitesFor(account!.emailHash) } }; },
  },
  {
    method: 'GET', path: '/v1/collab/projects/:id', summary: 'A shared project as your role may see it', auth: 'user',
    handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: await collab(() => collabCfg().project(params.id, claims.sub)) }; },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/members', summary: 'Invite by email, change a role or photo selection, remove someone, or change project settings', auth: 'user', body: Schemas.CollabMembers,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CollabMembers, req.rawBody);
      const c = await collabWritable();
      // Bringing someone new in is Pro, held by whoever pays for the project. Everyone already in keeps their access.
      if (body.kind === 'inviteEmail') await requireProPayer(params.id);
      const change = body.kind === 'inviteEmail'
        ? { kind: 'inviteEmail' as const, invite: { emailHash: emailHashOf(body.email), role: body.role, displayName: body.displayName, ...(body.photoIds ? { photoIds: body.photoIds } : {}) } }
        : body.kind === 'setPhotos' ? { ...body, photoIds: body.photoIds } : body;
      await collab(() => c.change(params.id, claims.sub, change, now()));
      await audit(claims.sub, `collab.${body.kind}`, 'allowed', params.id);
      const project = await collab(() => c.project(params.id, claims.sub));
      let emailed: boolean | undefined;
      if (body.kind === 'inviteEmail' && options.mailer && (await switchOn('email'))) {
        // The invitation stands either way: it is also shown in the app under Shared with me.
        try {
          const r = await options.mailer.sendInvitation({ to: body.email, recipientHash: emailHashOf(body.email), senderAccountId: claims.sub, inviterName: project.me.displayName, projectName: project.name, role: body.role, language: body.language });
          emailed = r.sent;
          await audit(claims.sub, 'mail.invite', r.sent ? 'allowed' : 'denied', r.sent ? params.id : `${params.id} ${r.reason}`);
        } catch {
          emailed = false;
          await audit(claims.sub, 'mail.invite', 'denied', `${params.id} send failed`); // never the address or the server's words
        }
      }
      return { status: 200, body: emailed === undefined ? project : { ...project, emailed } };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/accept', summary: 'Accept an invitation sent to your email address', auth: 'user', body: Schemas.CollabAccept,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CollabAccept, req.rawBody);
      const account = await store.getAccount(claims.sub);
      const member = await collab(() => collabCfg().accept(params.id, { accountId: claims.sub, emailHash: account!.emailHash, displayName: body.displayName }, now()));
      return { status: 200, body: { member } };
    },
  },
  {
    method: 'GET', path: '/v1/collab/projects/:id/leases', summary: 'Which photos are checked out now, and by whom', auth: 'user',
    handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: { leases: await collab(() => collabCfg().leases(params.id, claims.sub, now())) } }; },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/lease', summary: 'Check a photo out on the first edit (renews on the same device)', auth: 'user', body: Schemas.CollabAcquire,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CollabAcquire, req.rawBody);
      if (!PhotoId.safeParse(params.photoId).success) throw new ApiError(400, 'BAD_REQUEST', 'That is not a photo id.');
      const c = await collabWritable();
      return { status: 200, body: await collab(() => c.acquire(params.id, params.photoId, claims.sub, body.deviceId, now())) };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/heartbeat', summary: 'Keep a checkout alive; editing is true while you or background work for this photo is changing it', auth: 'user', body: Schemas.CollabHeartbeat,
    handler: async (req, params) => {
      await bearer(req);
      const body = parseJson(Schemas.CollabHeartbeat, req.rawBody);
      return { status: 200, body: await collab(() => collabCfg().heartbeat(params.id, params.photoId, body.token, body.editing, now())) };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/release', summary: 'Check a photo in after saving, or release it', auth: 'user', body: Schemas.CollabRelease,
    handler: async (req, params) => {
      await bearer(req);
      const body = parseJson(Schemas.CollabRelease, req.rawBody);
      return { status: 200, body: await collab(() => collabCfg().release(params.id, params.photoId, body.token, body.action, now())) };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/override', summary: "Owner only: release someone else's checkout, with a reason that is recorded", auth: 'user', body: Schemas.CollabOverride,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CollabOverride, req.rawBody);
      const result = await collab(() => collabCfg().override(params.id, params.photoId, claims.sub, body.reason, now()));
      await audit(claims.sub, 'collab.override', 'allowed', `${params.id}/${params.photoId}`);
      return { status: 200, body: result };
    },
  },
  {
    method: 'GET', path: '/v1/collab/projects/:id/photos/:photoId/revisions', summary: 'Revision history of one photo (no recipes)', auth: 'user',
    handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: await collab(() => collabCfg().history(params.id, params.photoId, claims.sub)) }; },
  },
  {
    method: 'GET', path: '/v1/collab/projects/:id/photos/:photoId/revisions/:revisionId', summary: 'One revision with its recipe', auth: 'user',
    handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: await collab(() => collabCfg().revision(params.id, params.photoId, params.revisionId, claims.sub)) }; },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/revisions', summary: 'Save a shared revision: needs your live checkout and the current head (409 with the head otherwise)', auth: 'user', body: Schemas.CollabPublish,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CollabPublish, req.rawBody);
      if (Buffer.byteLength(JSON.stringify(body.recipe)) > MAX_RECIPE_BYTES) throw new ApiError(413, 'COLLAB_RECIPE_TOO_LARGE', 'That edit is too large to share.');
      const revision = await collab(() => collabCfg().publish(params.id, params.photoId, claims.sub, body, now()));
      return { status: 200, body: { revision } };
    },
  },
  {
    method: 'GET', path: '/v1/collab/projects/:id/photos/:photoId/comments', summary: 'Comments on one photo, oldest first', auth: 'user',
    handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: { comments: await collab(() => collabCfg().comments(params.id, params.photoId, claims.sub)) } }; },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/comments', summary: 'Comment on a photo, optionally pinned to a spot on it', auth: 'user', body: Schemas.CollabComment,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CollabComment, req.rawBody);
      if (!PhotoId.safeParse(params.photoId).success) throw new ApiError(400, 'BAD_REQUEST', 'That is not a photo id.');
      const c = await collabWritable();
      const comment = await collab(() => c.addComment(params.id, params.photoId, claims.sub, { text: body.text, point: body.point ?? null, replyTo: body.replyTo ?? null }, now()));
      await notify(async () => {
        const who = await c.commentAudience(params.id, params.photoId, claims.sub);
        // A reply also reaches whoever started the thread, a client included (it is their own thread).
        const starter = comment.replyTo ? (await c.comments(params.id, params.photoId, claims.sub)).find((x) => x.id === comment.replyTo)?.authorAccountId : undefined;
        const recipients = [...new Set([...who.accountIds, ...(starter && starter !== claims.sub ? [starter] : [])])];
        return { kind: comment.replyTo ? 'reply' : 'comment', projectId: params.id, projectName: who.projectName, photoId: params.photoId, actorName: who.actorName, recipients };
      });
      return { status: 200, body: { comment } };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/comments/:commentId/resolve', summary: 'Mark a comment done, or reopen it', auth: 'user', body: Schemas.CollabResolve,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CollabResolve, req.rawBody);
      const comment = await collab(() => collabCfg().resolveComment(params.id, params.commentId, claims.sub, body.resolved, now()));
      // The author hears that their comment was marked done or reopened by someone else.
      if (comment.authorAccountId !== claims.sub) await notify(async () => {
        const who = await collabCfg().commentAudience(params.id, comment.photoId, claims.sub);
        return { kind: body.resolved ? 'resolve' : 'reopen', projectId: params.id, projectName: who.projectName, photoId: comment.photoId, actorName: who.actorName, recipients: [comment.authorAccountId] };
      });
      return { status: 200, body: { comment } };
    },
  },
  // ---- Cloud photo store for shared projects. Previews first; originals only on demand; downloads metered to the owner.
  {
    method: 'GET', path: '/v1/collab/projects/:id/cloud', summary: 'Photos this project keeps in the cloud (previews always, originals when stored)', auth: 'user',
    handler: async (req, params) => {
      const claims = await bearer(req);
      const member = await collab(() => collabCfg().requireMember(params.id, claims.sub, 'view'));
      if (member.role === 'client') throw new ApiError(403, 'COLLAB_NOT_PERMITTED', 'Clients see the photos shared with them in a gallery.');
      return { status: 200, body: { photos: await cloudCfg().store.list(params.id) } };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/cloud/upload-url', summary: 'A signed URL to put one preview, filmstrip picture or original in the cloud', auth: 'user', body: Schemas.CloudUpload,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CloudUpload, req.rawBody);
      if (!PhotoId.safeParse(params.photoId).success) throw new ApiError(400, 'BAD_REQUEST', 'That is not a photo id.');
      const c = await collabWritable();
      await collab(() => c.requireMember(params.id, claims.sub, 'edit', params.photoId));
      const cfg = cloudCfg();
      // Storage beyond the payer's included amount (Pro 2.5 GB, Basic none) needs a month of it in their cloud balance. Nothing stored is ever removed.
      await storageGate(params.id, body.bytes);
      return { status: 200, body: await cloud(() => cfg.store.signUpload(params.id, params.photoId, claims.sub, body, now(), cfg.maxProjectBytes)) };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/cloud/commit', summary: 'Mark an uploaded cloud object as stored', auth: 'user', body: Schemas.CloudVariantBody,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CloudVariantBody, req.rawBody);
      await collab(() => collabCfg().requireMember(params.id, claims.sub, 'edit', params.photoId));
      const cfg = cloudCfg();
      await cloud(() => cfg.store.commit(params.id, params.photoId, body.variant));
      return { status: 200, body: { stored: true } };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/cloud/download-url', summary: "A signed URL to download one cloud object. Counted against the project owner's monthly allowance first", auth: 'user', body: Schemas.CloudVariantBody,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CloudVariantBody, req.rawBody);
      // An original is the full file: only those who may export it get it.
      await collab(() => collabCfg().requireMember(params.id, claims.sub, body.variant === 'original' ? 'export' : 'view', params.photoId));
      const cfg = cloudCfg();
      const object = await cloud(() => cfg.store.objectFor(params.id, params.photoId, body.variant));
      const payer = await collab(() => collabCfg().payerOf(params.id));
      const allowance = await cfg.allowance.monthlyMillicredits(payer, now());
      if (!(await cfg.meter.reserve(payer, now(), object.bytes, allowance))) {
        throw new ApiError(402, 'CREDITS_EXHAUSTED', "This project's download allowance for the month is used up. Photos already on your devices keep working.");
      }
      return { status: 200, body: { downloadUrl: await cfg.store.signDownload(params.id, params.photoId, body.variant), bytes: object.bytes, sha256: object.sha256, millicredits: millicreditsForBytes(object.bytes) } };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/photos/:photoId/cloud/remove', summary: 'Take a photo (or just its original) out of the cloud', auth: 'user', body: Schemas.CloudRemove,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.CloudRemove, req.rawBody);
      await collab(() => collabCfg().requireMember(params.id, claims.sub, 'edit', params.photoId));
      await cloudCfg().store.remove(params.id, params.photoId, body.variants ?? CLOUD_VARIANTS);
      return { status: 200, body: { removed: true } };
    },
  },
  // ---- Team notifications (G20, owner decision 11): the in-app inbox comes first.
  {
    method: 'GET', path: '/v1/collab/notices', summary: 'Your newest notifications from shared projects (reading also marks the app as open, so nothing is emailed meanwhile)', auth: 'user',
    handler: async (req) => {
      const claims = await bearer(req);
      if (!options.notices) throw new ApiError(503, 'COLLAB_NOT_CONFIGURED', 'Notifications are not set up on this server yet.');
      return { status: 200, body: await options.notices.inbox(claims.sub, now()) };
    },
  },
  {
    method: 'POST', path: '/v1/collab/notices/read', summary: 'Mark notifications read (some, or all)', auth: 'user', body: Schemas.NoticesRead,
    handler: async (req) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.NoticesRead, req.rawBody);
      if (!options.notices) throw new ApiError(503, 'COLLAB_NOT_CONFIGURED', 'Notifications are not set up on this server yet.');
      return { status: 200, body: { read: await options.notices.markRead(claims.sub, body.ids, now()) } };
    },
  },
  {
    method: 'POST', path: '/v1/collab/projects/:id/presence-token', summary: 'A one-hour token for live cursors in this project only (Realtime Database)', auth: 'user',
    handler: async (req, params) => {
      const claims = await bearer(req);
      const c = await collabWritable();
      if (!options.presence) throw new ApiError(503, 'PRESENCE_NOT_CONFIGURED', 'Live cursors are not set up on this server yet. Everything else works.');
      const view = await collab(() => c.project(params.id, claims.sub));
      const issuedAtS = Math.floor(now() / 1000);
      const uid = presenceUid(claims.sub);
      const token = await options.presence.sign(uid, { p: params.id, r: view.me.role }, issuedAtS);
      return { status: 200, body: { customToken: token, databaseUrl: options.presence.databaseUrl, uid, expiresAtMs: (issuedAtS + PRESENCE_TOKEN_TTL_S) * 1000 } };
    },
  },
  {
    method: 'GET', path: '/v1/collab/projects/:id/audit', summary: 'Owner only: checkout takeovers and overrides', auth: 'user',
    handler: async (req, params) => { const claims = await bearer(req); return { status: 200, body: { entries: await collab(() => collabCfg().auditFor(params.id, claims.sub)) } }; },
  },

  // ---- Client galleries (#1387 C06/C07). Members publish previews; clients open a link with no account.
  {
    method: 'POST', path: '/v1/collab/projects/:id/galleries', summary: 'Publish selected photos to a client gallery link (previews are uploaded next)', auth: 'user', body: Schemas.GalleryCreate,
    handler: async (req, params) => {
      const claims = await bearer(req);
      const body = parseJson(Schemas.GalleryCreate, req.rawBody);
      const c = await collabWritable();
      const g = galleryCfg();
      for (const photoId of body.photoIds) await collab(() => c.requireMember(params.id, claims.sub, 'export', photoId));
      await requireProPayer(params.id); // a new client gallery is Pro; links already published keep working
      const created = await g.create({ ...body, projectId: params.id, createdBy: claims.sub }, now());
      await audit(claims.sub, 'gallery.create', 'allowed', `${params.id}/${created.galleryId.slice(0, 12)}`);
      return { status: 200, body: created };
    },
  },
  {
    method: 'GET', path: '/v1/collab/projects/:id/galleries', summary: 'Client galleries of this project', auth: 'user',
    handler: async (req, params) => {
      const claims = await bearer(req);
      await collab(() => collabCfg().requireMember(params.id, claims.sub, 'export'));
      return { status: 200, body: { galleries: await galleryCfg().list(params.id) } };
    },
  },
  {
    method: 'POST', path: '/v1/collab/galleries/:gid/photos/:photoId/upload-url', summary: 'A short-lived signed URL to upload one sized JPEG preview', auth: 'user', body: Schemas.GalleryPreview,
    handler: async (req, params) => {
      const body = parseJson(Schemas.GalleryPreview, req.rawBody);
      const { g } = await galleryOwner(req, params.gid);
      // Gallery previews count towards the same storage as cloud photos (Pro 2.5 GB for shared projects and galleries).
      await storageGate(g.projectId, body.bytes);
      return { status: 200, body: { uploadUrl: await gallery(() => galleryCfg().signPreviewUpload(params.gid, params.photoId, body.sha256, body.bytes, body.variant)) } };
    },
  },
  {
    method: 'POST', path: '/v1/collab/galleries/:gid/photos/:photoId/commit', summary: 'Mark an uploaded preview as published', auth: 'user',
    handler: async (req, params) => {
      const { claims, g } = await galleryOwner(req, params.gid);
      const preview = g.previews?.[params.photoId];
      if (!preview) throw new ApiError(404, 'NOT_FOUND', 'Upload the preview first.');
      await gallery(() => galleryCfg().commitPreview(params.gid, params.photoId));
      return { status: 200, body: { published: true } };
    },
  },
  {
    method: 'GET', path: '/v1/collab/galleries/:gid/feedback', summary: 'Client favourites, comments and approvals', auth: 'user',
    handler: async (req, params) => { await galleryOwner(req, params.gid); return { status: 200, body: await galleryCfg().feedbackFor(params.gid) }; },
  },
  {
    method: 'POST', path: '/v1/collab/galleries/:gid/feedback/review', summary: "Mark one photo's client feedback done or dismissed, or back to new. Never changes a decision", auth: 'user', body: Schemas.GalleryReview,
    handler: async (req, params) => {
      const { member } = await galleryOwner(req, params.gid);
      const body = parseJson(Schemas.GalleryReview, req.rawBody);
      const g = await gallery(() => galleryCfg().get(params.gid));
      if (!g.photoIds.includes(body.itemId.slice('photo:'.length))) throw new ApiError(404, 'NOT_FOUND', 'That photo is not in this gallery.');
      await galleryCfg().review(params.gid, body.itemId, body.state, member.displayName, now());
      return { status: 200, body: { reviewed: true } };
    },
  },
  {
    method: 'POST', path: '/v1/collab/galleries/:gid/revoke', summary: 'Close the link now and delete its previews', auth: 'user',
    handler: async (req, params) => {
      const { claims } = await galleryOwner(req, params.gid);
      await galleryCfg().revoke(params.gid);
      await audit(claims.sub, 'gallery.revoke', 'allowed', params.gid.slice(0, 12));
      return { status: 200, body: { revoked: true } };
    },
  },
  ];
}
