# InFlight: illegal content risk assessment (UK Online Safety Act 2023)

> **DRAFT for the owner to check and sign. Not legal advice.**
> Written on 26 November 2026 and updated on 27 November 2026 (no image scanning; accounts 18+) by a Claude session from what the code on `main` does. The owner must check every statement, fill in the blanks marked **[OWNER]**, and sign it before shared projects, client galleries or cloud storage open to UK users.
>
> How to read the markings:
> - **Code:** `path/to/file.ts` — the file that implements the statement. Checked by reading the code, not by running the live service.
> - **UNVERIFIED** — believed true but not checked in code or on the live service.
> - **ASSUMPTION** — a figure or fact the owner must supply or confirm.
> - **LAW: CHECK** — a point about the law or Ofcom's guidance the solicitor should confirm. The session did not re-read Ofcom's current documents while writing this.

## 0. Record details

| Item | Value |
|---|---|
| Service | InFlight (codebase name Kestrel): photo workflow app for Windows, macOS and web, with optional online sharing and cloud storage |
| Provider | David Leitch, sole trader trading as InFlight, 7 High Street, Kington, HR5 3AX, United Kingdom (from `site/terms.html` §1) |
| Person responsible for this assessment and for online safety compliance | David Leitch **[OWNER: confirm]** |
| Date carried out | **[OWNER: date signed]** |
| Version | 0.2 draft, 27 November 2026 |
| Next review | See section 7 |
| Method | Ofcom's four steps for the illegal content risk assessment: (1) understand the kinds of illegal content to assess, (2) assess the risk of harm, (3) decide and put in place measures, record them, (4) report, review and update. **LAW: CHECK** against Ofcom's current Risk Assessment Guidance and Risk Profiles. |

## 1. Step 1: the service and its characteristics

### 1.1 What the service is

InFlight is mainly a local app. Importing, culling, editing and exporting photos happen on the user's own device and need no account or internet. **Photos that stay on the device are never sent to InFlight and never scanned.** (Code: `services/control-plane/src/contentSafety.ts` header comment; the local app does not call the safety code at all. `site/privacy.html` "What stays on your device".)

The user-to-user parts, which bring InFlight into the Online Safety Act, are optional and need an account:

| Feature | Who can see content | Code |
|---|---|---|
| **Shared projects** | Only people the owner invites by email address. Invitations are stored as a hash of the email. Members have roles (for example view, edit, export). | `services/control-plane/src/collaboration.ts`; routes `/v1/collab/projects/:id/members`, `/v1/collab/projects/:id/accept` in `services/control-plane/src/app.ts` |
| **Comments on photos in a shared project** | Members of that project only. Text, optionally pinned to a spot on the photo. | `/v1/collab/projects/:id/photos/:photoId/comments` in `app.ts` |
| **Cloud storage of a shared project (Pro Cloud)** | Members of that project. A preview and a filmstrip picture per photo; originals only if the owner chooses. UK (London) bucket. | `services/control-plane/src/cloudPhotos.ts`; commit route `/v1/collab/projects/:id/photos/:photoId/cloud/commit` in `app.ts` |
| **Client galleries** | Anyone who has the link (and the password, if one is set). No account needed to view. Up to 200 photos, previews up to 8 MB, the link expires after at most 90 days. Only a hash of the link is stored. | `services/control-plane/src/gallery.ts` (`GALLERY_MAX_PHOTOS`, `GALLERY_MAX_PREVIEW_BYTES`, `GALLERY_MAX_DAYS`) |
| **Gallery visitor feedback** | Favourites, approvals and comments from visitors, only when the photographer allows them. They go to the project's gallery managers, never to other visitors. **UNVERIFIED** that the gallery page never shows one visitor's comments to another visitor. | `/v1/gallery/feedback` in `app.ts`; `gallery.ts` |
| **Team notifications** | In-app notices, push and email to project members about project activity. Not free-text messaging. | `services/control-plane/src/notices.ts`, `push.ts`, `mailer.ts` |
| **Live cursors** | Pointer positions of members in a shared project. No content. | `services/control-plane/src/presenceToken.ts` |

What the service does **not** have (checked by reading the route list in `services/control-plane/src/app.ts`; no route found for any of these):

- no public feed, search, discovery or recommendation of other people's content;
- no public profiles or follower system;
- no direct messaging between users, and no way to contact a stranger: a person can only reach people in a project they were invited to;
- no live streaming, no video upload in galleries or cloud (photos only: **UNVERIFIED** that the cloud and gallery routes refuse video files; they accept image previews the app makes);
- no generation of images (`site/terms.html` §9).

**Note:** `site/acceptable-use.html` says the policy covers "comments and messages". There is no messaging feature in the code. Suggest the solicitor either keeps the word for future features or removes it.

### 1.2 Risk factors (Ofcom Risk Profiles)

**LAW: CHECK** the exact factor names against Ofcom's current U2U Risk Profile.

| Factor | Present? | Notes |
|---|---|---|
| Service type: file-storage and file-sharing | **Yes** | Cloud storage and gallery links are the core user-to-user features. Ofcom treats this type as a risk factor for image-based CSAM in particular. |
| Service type: social media, messaging, dating, gaming, adult, marketplace | No | |
| User profiles | Limited | Display name and role inside a project. Not public. |
| Anonymous or unregistered users | **Partly** | Gallery visitors need no account. They can view and, if allowed, leave feedback. They cannot upload. |
| Users can connect with strangers | No | Membership is by invitation only. |
| Direct messaging | No | |
| Posting images | **Yes** | Upload to cloud and galleries. |
| Commenting | **Yes** | Project members; gallery visitors when allowed. |
| Sharing content by hyperlink | **Yes** | Gallery links can be forwarded to anyone. This is the main way content could reach people the uploader did not intend, or be used to distribute illegal material. |
| Encrypted content | No end-to-end encryption. Encrypted in transit and at rest by Google Cloud (`site/privacy.html` "Security"). |
| Recommender systems, livestreaming, ephemeral content | No | |
| Business model | Paid plans (Pro, Pro Cloud) via Paddle; no advertising. Cloud storage only on paid plans. Accounts require email sign-in (Google, Apple or email and password via Firebase Authentication). |

### 1.3 Size and users

| Item | Value |
|---|---|
| UK monthly active users of the user-to-user features | **ASSUMPTION — [OWNER: fill in]**. Before launch this is close to zero. Give an estimate for the first 12 months. |
| Total UK users of the app (including local-only users, who are out of scope) | **ASSUMPTION — [OWNER]** |
| Expected galleries published per month | **ASSUMPTION — [OWNER]** |
| Expected images shared per month (gallery and cloud previews) | **ASSUMPTION — [OWNER]**. InFlight does not scan them (see section 3). |
| Staff | 1 (sole trader) **[OWNER: confirm]** |
| Is the service "large" under Ofcom's codes (more than 7 million UK monthly users)? | No, on any realistic estimate. **LAW: CHECK** threshold. |

### 1.4 Who uses it

Photographers (amateur and professional) and the clients, colleagues and friends they invite or send gallery links to. Accounts, sharing and cloud storage are for people aged 18 or over (`site/terms.html` §6, `site/privacy.html` "Children", from 27 Nov 2026). Sharing happens only when a user chooses to share a project or publish a gallery. There is **no age check in the code** (searched `src/`, `services/control-plane/src/` and `site/` on 26 Nov 2026: the only mentions of age are the policy pages). Gallery visitors can be any age. See `childrens-access-assessment.md`.

## 2. Step 1 (continued) and step 2: each kind of illegal content, likelihood and impact

Scale used: **Negligible / Low / Medium / High**, for likelihood and for impact, then an overall risk level. "Likelihood" here means the chance that this kind of illegal content appears on, or the offence is committed through, the user-to-user parts of InFlight, before the measures in section 3 are counted where noted.

Evidence available: the code, the feature design, and Ofcom's published view of risk factors. **There is no incident data yet**: the online features have not opened to the public. Every likelihood below is a judgement and must be re-checked with real data at the first review.

### 2.1 Summary table

| # | Priority illegal harm | Likelihood | Impact | Overall risk | Main reasons |
|---|---|---|---|---|---|
| 1 | **CSEA: image-based child sexual abuse material (CSAM)** | Medium | High | **High** (treat as high) | File-storage and sharing plus shareable links is the risk profile Ofcom names for CSAM. Small services are used to store and pass on CSAM. Impact on victims is severe. |
| 2 | **CSEA: CSAM URLs** | Low | High | Medium | Text comments could carry links to CSAM. No URL checks on comment text. |
| 3 | **CSEA: grooming** | Low | High | Medium | No contact with strangers, no messaging, no discovery. A child could be invited into a project by an adult who already knows them, then contacted through comments. 13–17s may hold accounts. |
| 4 | **Intimate image abuse** (sharing or threatening to share intimate images without consent) | Medium | High | **High** (treat as medium–high) | Galleries let anyone share photos by link with anyone. Boudoir and portrait photography is ordinary work, so intimate images of adults will be uploaded lawfully; non-consensual sharing is possible. |
| 5 | **Extreme pornography** | Low | Medium | Low–Medium | Possible in galleries. Not the purpose of the service. |
| 6 | **Terrorism** | Low | High | Medium | Photo sharing by link could carry propaganda images. No public reach or feed. |
| 7 | **Harassment, stalking, threats and abuse** | Low | Medium | Low–Medium | Only within invited projects and between photographer and client. A gallery could publish photos of someone taken covertly to harass them. |
| 8 | **Controlling or coercive behaviour** | Low | Medium | Low | Shared project access could be used to monitor a partner's photos; limited by invite-only design and the owner's control of membership. |
| 9 | **Hate** | Low | Medium | Low | No public reach. |
| 10 | **Fraud and financial offences** | Low–Medium | Medium | Medium | Gallery links could imitate a photographer and be used in phishing (for example a fake "your photos are ready" link). Invitation emails could be abused for spam or phishing. Payment is through Paddle, not InFlight. |
| 11 | **Sexual exploitation of adults** | Low | High | Low–Medium | Galleries could advertise sexual services with images. |
| 12 | **Human trafficking / unlawful immigration** | Negligible–Low | High | Low | No marketplace or contact features. |
| 13 | **Proceeds of crime; drugs; firearms, knives and weapons** | Low | Medium | Low | No marketplace. Images alone rarely amount to these offences. |
| 14 | **Encouraging or assisting suicide (or serious self-harm)** | Low | High | Low–Medium | No public reach; comments between known people. |
| 15 | **Foreign interference** | Negligible | Medium | Negligible | No public reach. |
| 16 | **Animal cruelty** | Low | Medium | Low | Wildlife photography is a core use; cruelty images are possible but not expected. |
| 17 | **Cyberflashing** (sending a photo of genitals to cause alarm or for gratification) | Low | Medium | Low | Possible through a gallery link sent to someone, or a project invite. No unsolicited messaging. |
| — | Non-priority illegal content (for example copyright infringement, defamation, privacy offences) | Medium (copyright) | Low–Medium | Low–Medium | Photographers sharing other people's work is the most likely breach. Copyright is not an OSA priority harm but is covered by the acceptable use policy and the report form category `copyright`. |

**LAW: CHECK** that this list matches Ofcom's current list of 17 priority illegal harms and the sub-categories of CSEA.

### 2.2 Notes on the higher risks

**1. Image-based CSAM.** The risk is not from the core purpose (photo editing) but from the online features being usable as storage and distribution. Shareable gallery links that need no account are the main concern. The cloud store is limited to invited members, which lowers but does not remove the risk. Impact: the gravest of any harm here; each viewing re-victimises the child.

**3. Grooming.** The design removes the usual paths (stranger contact, discovery, private messaging). The remaining path is an adult inviting a child they already know into a project and using photo comments. The terms now require account holders to be 18 or over (27 Nov 2026). There is no age check, so a child could still join by lying about their age.

**4. Intimate image abuse.** InFlight cannot tell consent from an image, and it does not scan images. A report form category `intimate-image-abuse` exists and marks the report urgent.

**10. Fraud.** Gallery pages carry the photographer's chosen name. **UNVERIFIED** whether gallery names or invitation emails are checked for impersonation or for links. Rate limits exist on gallery and report routes (`galleryLimiter`, `reportLimiter` in `app.ts`).

## 3. Step 3: measures in place

Each line says what the code does and where. "Live?" says whether it is switched on in production today.

**InFlight does not scan photos (owner, 27 Nov 2026).** Automated hash matching (PhotoDNA, IWF hash list), the AI classifier (Cloud Vision SafeSearch), automatic NCMEC CyberTipline reporting and evidence keeping were removed from the code and infrastructure, because InFlight did not qualify for access to the hash lists. Illegal content reaches a person only through reports.

| Measure | What it does | Code | Live? |
|---|---|---|---|
| **No automated image scanning** | Shared and cloud pictures are published without any image check. Local photos and safe copy are never seen by InFlight. | `services/control-plane/src/routesCollab.ts` gallery and cloud commit routes; `services/control-plane/test/content-safety.test.ts` | Yes. |
| **Report a gallery (user reporting and complaints)** | Every gallery page has *Report this gallery*. No account needed. Categories: child-sexual-abuse, intimate-image-abuse, terrorism-or-violence, harassment-or-privacy, copyright, other-illegal, policy-breach. Reporter gets a reference and a receipt to check the outcome. Rate limited. | `/v1/gallery/report`, `/v1/gallery/report/status` in `routesGeneral.ts`; `contentSafety.ts` `addNotice()`, `noticeStatus()`; `site/gallery.html` | Yes, once galleries are switched on. |
| **Urgent handling** | Child-sexual-abuse, intimate-image-abuse and terrorism-or-violence reports are marked urgent and sorted first. A child-sexual-abuse report takes the gallery down at once until reviewed. | `contentSafety.ts` `addNotice()` (`urgent`), `notices()` sort; `/v1/gallery/report` (`setHold`) | Yes, with galleries. |
| **CSAM handling on a report** | The admin removes the photo or revokes the gallery, suspends the account, and reports by hand to the NCA and the IWF. No copy is kept unless they ask. Admins see report details only; no route signs a link for them to view a reported picture. | `/v1/admin/safety/notices/:id/decide` in `routesAdmin.ts`; `site/admin.html` Safety panel; `docs/safety/README.md` | Manual process. **Not yet written down as a step-by-step procedure [OWNER].** |
| **Suspended accounts are locked out** | A suspended account fails sign-in checks on the service, and every client gallery it created stops serving. | `ownerSuspended` in `appContext.ts`; `gallery.ts` `open()` | Yes. |
| **Decisions with reasons (statement of reasons)** | Admin chooses no action, remove photo or revoke gallery, with a reason the reporter and owner both see. | `contentSafety.ts` `decideNotice()`; `/v1/admin/safety/*` and `/v1/me/safety` | Yes, with galleries. The app does not show the owner's list yet. |
| **Audit log** | Report decisions are written to the audit log. | `adminDone(...)` in `routesAdmin.ts`; `/v1/gallery/report` | Yes. |
| **Invite-only projects** | No stranger contact, no discovery. | `collaboration.ts` | Yes. |
| **Gallery limits** | Link is unguessable, only its hash is stored; optional password; expires in at most 90 days; previews deleted on revoke or expiry; bucket deletes gallery files older than 90 days. | `gallery.ts` header and constants; `infra/gcp/gallery.tf` | Yes, with galleries. |
| **Accounts are 18+** | Terms and privacy notice require account holders, sharers and buyers to be 18 or over. No age check. | `site/terms.html` §6, `site/privacy.html` | Published as pre-release drafts. |
| **Terms and acceptable use policy** | Prohibit CSAM, intimate image abuse, terrorist content, harassment, impersonation, spam and phishing. Explain reporting, removal and suspension. | `site/acceptable-use.html`, `site/terms.html` §10–11 | Published as pre-release drafts. |
| **Point of contact** | hello@inflight.studio for users and authorities. | `site/acceptable-use.html` | Yes, once PR #1791 merges. |
| **Rate limits** | On gallery open, feedback, report and report status. | `galleryLimiter`, `reportLimiter` | Yes. |

### 3.1 Ofcom codes of practice: how the measures map

**LAW: CHECK.** Ofcom's Illegal Content Codes for user-to-user services set measures by size and risk level. For a small service that is medium or high risk for CSAM (as this assessment finds), the codes the solicitor should check against include, in summary:

- a named person accountable for illegal content duties (governance) — the owner;
- content moderation that can take down illegal content swiftly — admin safety page and gallery hold;
- easy-to-find, easy-to-use reporting and complaints, with appeals — gallery report form and receipts; there is no appeal route yet (see gaps);
- terms of service that explain how users are protected — acceptable use policy;
- removing accounts of proscribed organisations, and blocking accounts that share CSAM — suspension by an admin after a report;
- **hash matching for CSAM on file-storage and file-sharing services at risk of image-based CSAM** — **not done**: InFlight did not qualify for hash list access and does not scan. **LAW: CHECK** whether this code measure applies to InFlight at its size and risk level, and if so what Ofcom expects instead;
- CSAM URL detection — **not built** (see gaps);
- default settings protecting child users from strangers — invite-only design meets the aim; there is no age check.

## 4. Gaps and what to do about them

| # | Gap | Risk it leaves | Proposed action | Owner |
|---|---|---|---|---|
| G1 | **No automated detection of CSAM.** Hash matching and the AI classifier were removed (27 Nov 2026). | Known CSAM can be shared until someone reports it. | **Solicitor to confirm** whether Ofcom's hash-matching measure applies to InFlight. Register with the IWF and ask what they offer a small UK service. Consider keeping galleries invite-only or password-only at launch. | Owner / solicitor |
| G2 | **NCA and IWF reporting is by hand.** | Missed or late report. | Write a short step-by-step for a CSAM report (remove, suspend, report to the NCA and IWF, keep no copies) and keep it with this assessment. Solicitor to confirm whether OSA section 66 reporting regulations are in force and what they require. | Owner / solicitor |
| G3 | **No reporting form for shared projects.** Members can only report by email. | Harder for a project member to report grooming or harassment. | Add *Report* to shared projects and comments, using the same notice flow. | Frontend + backend lanes |
| G4 | **Text is not checked.** Comments and gallery visitor feedback are not checked for CSAM URLs, grooming or threats. | CSAM URLs and grooming through comments. | A report button on comments. | Later |
| G5 | **No age check.** Accounts are 18+ in the terms; nothing in the code checks age. | A child could join by lying about their age. | Solicitor to advise whether self-declaration is enough (`childrens-access-assessment.md`). | Owner / solicitor |
| G6 | **No appeal route for gallery owners.** Owners see the decision and reason at `/v1/me/safety`, but cannot ask for another look except by email. | Unfair removals are harder to put right. | Add an appeal button; show the list in the app; email outcomes. | Frontend lane |
| G7 | **One-person moderation.** All reports are handled by the owner. | Slow response when the owner is away. | Set and publish a target response time (for example urgent reports within 24 hours) **[OWNER]**; arrange cover or pause galleries during absence. | Owner |
| G8 | **Live service not tested end to end.** Nothing in this assessment was checked on the live service. | Measures may behave differently live. | Make a test gallery, report it, and decide the report from /admin → Safety; record the result here. | Owner + Claude worker |

## 5. Overall risk level

Without automated detection, the service is judged **medium risk for image-based CSAM and intimate image abuse** once galleries open, and **low** for the other harms. It is a small service run by one person: sharing happens only when a user chooses it, accounts are 18+, projects are invite-only, gallery links are unguessable and expire within 90 days, and there is no public feed, search, profiles or messaging between strangers. The main controls are invite-only projects, unguessable expiring gallery links, the report form that takes a gallery down at once on a CSAM report, and account suspension. **[OWNER/solicitor: agree or change, and decide whether galleries may open on this basis.]**

## 6. Step 4: reporting and governance

- Accountable person: **[OWNER name]**. Reviews this assessment and every open report.
- Where reports are handled: /admin → Safety (`/v1/admin/safety`), details only.
- Records: this file in the repository (version history in Git) plus a signed copy kept by the owner **[OWNER: where]**.
- Target response times: **[OWNER: fill in]**, for example urgent reports within 24 hours, others within 5 working days.

## 7. Review

Review this assessment:

- **before** shared projects, client galleries or cloud storage open to the public;
- within **3 months** of opening, using real report and case data;
- then at least **every 12 months** (**[OWNER: first annual date]**);
- and **before** any significant change, including: messaging between users; public galleries, profiles or search; video; changing the minimum age; adding any automated check; passing 50,000 UK monthly users of the online features **[OWNER: pick a threshold]**; or Ofcom publishing new codes or guidance. **LAW: CHECK** Ofcom's rule on reassessing before a significant change.

## 8. Sign-off

| | |
|---|---|
| Name | David Leitch |
| Role | Sole trader, trading as InFlight; person accountable for online safety |
| Signature | ______________________ |
| Date | ______________________ |
| Solicitor reviewed (name, firm, date) | ______________________ |
