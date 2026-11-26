# InFlight: illegal content risk assessment (UK Online Safety Act 2023)

> **DRAFT for a solicitor's review. Not legal advice. Not yet signed.**
> Written on 26 November 2026 by a Claude session from what the code on `main` (commit `aadaa2d3`) does. The owner must check every statement, fill in the blanks marked **[OWNER]**, and sign it before shared projects, client galleries or cloud storage open to UK users.
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
| Version | 0.1 draft |
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
| Expected images checked per month (gallery and cloud previews) | **ASSUMPTION — [OWNER]**. This also sets the SafeSearch cost: about $1.50 per 1,000 images after the first 1,000 a month (owner's figure, 26 Nov 2026). |
| Staff | 1 (sole trader) **[OWNER: confirm]** |
| Is the service "large" under Ofcom's codes (more than 7 million UK monthly users)? | No, on any realistic estimate. **LAW: CHECK** threshold. |

### 1.4 Who uses it

Photographers (amateur and professional) and the clients, colleagues and friends they invite or send gallery links to. Accounts are allowed from age 13 (`site/terms.html` §6, `site/privacy.html` "Children"). There is **no age check in the code** (searched `src/`, `services/control-plane/src/` and `site/` on 26 Nov 2026: the only mentions of age are the policy pages). Gallery visitors can be any age. See `childrens-access-assessment.md`.

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

**3. Grooming.** The design removes the usual paths (stranger contact, discovery, private messaging). The remaining path is an adult inviting a child they already know into a project and using photo comments. Because the terms allow 13–17 year olds to hold accounts and there is no age check, the service cannot tell which members are children.

**4. Intimate image abuse.** InFlight cannot tell consent from an image. The SafeSearch classifier (section 3) holds explicit adult content back from sharing for review, which reduces quick non-consensual sharing but will also hold lawful boudoir and art work. A report form category `intimate-image-abuse` exists and marks the report urgent.

**10. Fraud.** Gallery pages carry the photographer's chosen name. **UNVERIFIED** whether gallery names or invitation emails are checked for impersonation or for links. Rate limits exist on gallery and report routes (`galleryLimiter`, `reportLimiter` in `app.ts`).

## 3. Step 3: measures in place

Each line says what the code does and where. "Live?" says whether it is switched on in production today.

| Measure | What it does | Code | Live? |
|---|---|---|---|
| **Only shared and cloud photos are checked** | Gallery previews and cloud previews and filmstrip pictures are checked before anyone else can see them. Local photos and safe copy (a person's own private backup) are never checked. | `services/control-plane/src/contentSafety.ts` (`SafetyService.check`); called from `app.ts` `safetyCheck()` at the gallery commit and cloud commit routes | Code is built. |
| **Fails closed in production** | In production, publishing to galleries and cloud is refused with `SAFETY_NOT_CONFIGURED` until at least one hash checker is set up. If a checker cannot answer, nothing is published and the person can retry (`SAFETY_CHECK_UNAVAILABLE`). | `app.ts` `safetyCheck()` (`requireAdminSwitch`), `contentSafety.ts` `check()`; tested in `services/control-plane/test/content-safety.test.ts` | Yes: sharing cannot open unscanned. |
| **Hash matching for known CSAM: PhotoDNA** | Each picture is sent to Microsoft PhotoDNA Cloud Service. A match blocks it. Catches resized and lightly altered copies. Pictures over 4 MB are refused with a plain message. | `contentSafety.ts` `PhotoDnaMatcher`; wired in `services/control-plane/src/wiring.ts` `buildSafety()` from `KCP_PHOTODNA_KEY_SECRET` | **No.** Needs the Microsoft application (see `photodna-application-draft.md`). |
| **Hash matching: exact-hash list (for example IWF)** | MD5, SHA-1 or SHA-256 list match. Catches only identical files. | `contentSafety.ts` `ExactHashListMatcher`; `wiring.ts` from `KCP_SAFETY_HASH_LIST_FILE` | **No.** Optional; needs IWF membership. |
| **On a hash match** | The shared copy is deleted; the bytes move to a private evidence key (`evidence/<case>`) kept one year; the account is suspended; that gallery is taken down; a CyberTipline report is filed if the connection is set up, otherwise the case waits for a manual report; UK cases are marked "NCA manual". | `contentSafety.ts` `check()`, `openCase()`, `report()`; `app.ts` `safetyCheck()` (suspension via `store.setAccountStatus`, gallery hold via `setHold`) | Only once a hash checker is live. |
| **Suspended accounts are locked out** | A suspended account fails sign-in checks on the service. | `app.ts` (checks of `account.status !== 'active'`, about lines 451, 474, 2301) | Yes. |
| **AI classifier: Google Cloud Vision SafeSearch** | Explicit adult content (LIKELY or more) or graphic violence (VERY_LIKELY) is held back from sharing and opens a review case. "Racy" alone never flags. Never reported, never suspends. Uploader sees the reason and can appeal. | `contentSafety.ts` `CloudVisionSafeSearch`, `safeSearchVerdict`; `wiring.ts` (`KCP_SAFESEARCH_ENABLED=1`) | **No.** Owner approved the cost on 26 Nov 2026. Steps in `safesearch-switch-on.md`. |
| **Nobody views flagged pictures** | Admin sees metadata only. No route signs a link to a held picture or to evidence. | `contentSafety.ts` `caseSummary()`; `/v1/admin/safety` in `app.ts` | Yes (by design of the routes). |
| **Report a gallery (user reporting and complaints)** | Every gallery page has *Report this gallery*. No account needed. Categories: child-sexual-abuse, intimate-image-abuse, terrorism-or-violence, harassment-or-privacy, copyright, other-illegal, policy-breach. Reporter gets a reference and a receipt to check the outcome. Rate limited. | `/v1/gallery/report`, `/v1/gallery/report/status` in `app.ts`; `contentSafety.ts` `addNotice()`, `noticeStatus()`; `site/gallery.html` | Yes, once galleries are switched on. |
| **Urgent handling** | Child-sexual-abuse, intimate-image-abuse and terrorism-or-violence reports are marked urgent and sorted first. A child-sexual-abuse report takes the gallery down at once until reviewed. | `contentSafety.ts` `addNotice()` (`urgent`), `notices()` sort; `app.ts` `/v1/gallery/report` (`setHold`) | Yes, with galleries. |
| **Decisions with reasons (statement of reasons)** | Admin chooses no action, remove photo or revoke gallery, with a reason the reporter and owner both see. AI-flag decisions are recorded with a reason; uploader can appeal. | `contentSafety.ts` `decideNotice()`, `decide()`, `appeal()`, `statementFor()`; `/v1/admin/safety/*` and `/v1/me/safety*` in `app.ts` | Yes, with galleries. The app does not show the uploader's safety list yet (`docs/SAFETY-SETUP.md` "Not done yet"). |
| **Audit log** | Hash matches, AI flags and reports are written to the audit log. | `app.ts` `audit(...)` calls in `safetyCheck()` and `/v1/gallery/report` | Yes. |
| **Invite-only projects** | No stranger contact, no discovery. | `collaboration.ts` | Yes. |
| **Gallery limits** | Link is unguessable, only its hash is stored; optional password; expires in at most 90 days; previews deleted on revoke or expiry; bucket deletes gallery files older than 90 days. | `gallery.ts` header and constants; `infra/gcp/gallery.tf` | Yes, with galleries. |
| **Originals stored only behind a checked preview** | RAW originals cannot be hashed; an original is accepted only after its preview passed. | `app.ts` cloud commit route (`PREVIEW_FIRST`) | Yes, once a hash checker is live. |
| **Terms and acceptable use policy** | Prohibit CSAM, intimate image abuse, terrorist content, harassment, impersonation, spam and phishing. Explain checks, reporting and suspension. | `site/acceptable-use.html`, `site/terms.html` §10–11 | Published as pre-release drafts. |
| **Point of contact** | david@djleitch.co.uk for users and authorities. | `site/acceptable-use.html` | Yes. **Suggest** a dedicated safety address. |
| **Rate limits** | On gallery open, feedback, report and report status. | `app.ts` `galleryLimiter`, `reportLimiter` | Yes. |

### 3.1 Ofcom codes of practice: how the measures map

**LAW: CHECK.** Ofcom's Illegal Content Codes for user-to-user services set measures by size and risk level. For a small service that is medium or high risk for CSAM (as this assessment finds), the codes the solicitor should check against include, in summary:

- a named person accountable for illegal content duties (governance) — the owner;
- content moderation that can take down illegal content swiftly — admin safety page and gallery hold;
- easy-to-find, easy-to-use reporting and complaints, with appeals — gallery report form, receipts, appeals for AI flags;
- terms of service that explain how users are protected — acceptable use policy;
- removing accounts of proscribed organisations, and blocking accounts that share CSAM — suspension on hash match;
- **hash matching for CSAM on file-storage and file-sharing services at risk of image-based CSAM** — PhotoDNA (not live yet; see gaps). **LAW: CHECK** whether the size threshold in the code applies to InFlight; it is the right measure either way and the owner has chosen to require it;
- CSAM URL detection — **not built** (see gaps);
- default settings protecting child users from strangers — invite-only design meets the aim; there is no age check.

## 4. Gaps and what to do about them

| # | Gap | Risk it leaves | Proposed action | Owner |
|---|---|---|---|---|
| G1 | **No hash checker is live.** PhotoDNA and NCMEC are not set up. | Sharing stays closed in production (fails closed), so no exposure yet, but sharing cannot open. | Apply to Microsoft (`photodna-application-draft.md`) and NCMEC (`ncmec-esp-registration-draft.md`). | Owner |
| G2 | **NCMEC client never run against NCMEC.** | A real case might not be reported automatically. | Run one report against NCMEC's test service before production (`docs/SAFETY-SETUP.md` step 2). Until then, report by hand from /admin → Safety. | Claude worker after NCMEC credentials |
| G3 | **No Terraform variable for SafeSearch, PhotoDNA, the hash list or NCMEC.** `infra/gcp/control-plane.tf` sets none of `KCP_SAFESEARCH_ENABLED`, `KCP_PHOTODNA_KEY_SECRET`, `KCP_NCMEC_*`, and `infra/gcp/switch-features.sh` does not allow them. A value set by hand with gcloud would be removed by the next Terraform apply. Cloud Vision API is not in the Terraform services list. | Checks could silently switch off after a deploy (sharing would then fail closed for hash checks, but SafeSearch would just stop). | Backend lane adds the variables (exact change in `safesearch-switch-on.md`). | Backend lane |
| G4 | **NCA reporting is manual.** UK hash-match cases are marked "NCA manual". | Missed or late NCA report. | Solicitor to confirm whether OSA section 66 reporting regulations are in force and what they require. Until a direct route exists, report by hand and press *NCA report made*. | Owner / solicitor |
| G5 | **Holding CSAM evidence in the UK.** Evidence is kept one year in a UK bucket, matching US law (18 U.S.C. 2258A). Possessing or copying indecent images of children is an offence in England and Wales, with narrow defences. | Legal exposure for the owner. | **Solicitor must advise** whether keeping evidence and uploading it to NCMEC is lawful for a UK sole trader, and on what basis; change retention if needed. | Solicitor |
| G6 | **Only the gallery in which the match happened is taken down.** Other galleries of the same suspended account keep serving: `GalleryStore.open()` in `gallery.ts` checks the gallery's own `safetyHold` and expiry but not whether its owner is suspended, and `/v1/gallery/open` in `app.ts` adds no account check. (Found by reading the code; not tested.) | Other material from the same account stays reachable by link. | On a hash match, hold every gallery the account created, or make `open()` refuse galleries of suspended accounts. | Backend lane |
| G7 | **No reporting form for shared projects.** Members can only report by email. | Harder for a project member (possibly a child) to report grooming or harassment. | Add *Report* to shared projects and comments, using the same notice flow. | Frontend + backend lanes |
| G8 | **Text is not checked.** Comments and gallery visitor feedback are not scanned for CSAM URLs, grooming or threats. | CSAM URLs and grooming through comments. | Proportionate first step: CSAM URL list check on comment text (IWF URL list needs membership), and a report button on comments. | Later |
| G9 | **No age check.** Terms allow 13+; nothing in the code checks age. | Cannot apply extra protection to child users. | Decide 13+ or 18+ (`childrens-access-assessment.md`). | Owner |
| G10 | **Subprocessors and privacy page do not name Microsoft (PhotoDNA) or Google Cloud Vision (SafeSearch).** `site/subprocessors.html` and `site/privacy.html` have no mention. | Privacy notice incomplete once the checks go live. | Add both before switching them on. | Owner / site lane |
| G11 | **No email to reporter or uploader.** Outcomes are only on the receipt page or `/v1/me/safety`; the app does not show that list yet. | People may not learn of decisions. | Show the safety list in the app; email outcomes. | Frontend lane |
| G12 | **SafeSearch cost is not under the spend guard.** **UNVERIFIED**: `services/control-plane/src/spendGuard.ts` has no mention of safety or Vision. | Unexpected cost if uploads spike. | Watch the Google budget alert; consider a monthly cap. | Owner / backend lane |
| G13 | **One-person moderation.** All reports and cases are handled by the owner. | Slow response when the owner is away. | Set and publish a target response time (for example urgent reports within 24 hours) **[OWNER]**; arrange cover or pause galleries during absence. | Owner |
| G14 | **Evidence is in the gallery bucket, not a locked-retention bucket.** | Evidence could be deleted by mistake. | Separate bucket with locked retention (`docs/SAFETY-SETUP.md` "Not done yet"). Depends on G5. | Backend lane |
| G15 | **Live service not tested end to end.** Nothing in this assessment was checked on the live service. | Measures may behave differently live. | Run the checks in `docs/SAFETY-SETUP.md` "Checking it works once set up" and record the results here. | Owner + Claude worker |

## 5. Overall risk level

Before the gaps above are closed, the service is **high risk for image-based CSAM** and **medium to high risk for intimate image abuse**, and **medium or lower** for the other harms. It is not open: production refuses to publish shared or cloud photos until a hash checker is configured (`app.ts` `safetyCheck()`).

With PhotoDNA, NCMEC reporting and SafeSearch live (G1–G3), and the report form in place, the residual risk is judged **medium for CSAM** and **medium for intimate image abuse**, mainly because new (unhashed) material and text-based harms are not detected automatically. **[OWNER/solicitor: agree or change.]**

## 6. Step 4: reporting and governance

- Accountable person: **[OWNER name]**. Reviews this assessment and every open safety case.
- Where cases are handled: /admin → Safety (`/v1/admin/safety` in `app.ts`), metadata only.
- Records: this file in the repository (version history in Git) plus a signed copy kept by the owner **[OWNER: where]**.
- Target response times: **[OWNER: fill in]**, for example urgent reports within 24 hours, others within 5 working days.

## 7. Review

Review this assessment:

- **before** shared projects, client galleries or cloud storage open to the public;
- within **3 months** of opening, using real report and case data;
- then at least **every 12 months** (**[OWNER: first annual date]**);
- and **before** any significant change, including: messaging between users; public galleries, profiles or search; video; raising or lowering the minimum age; switching a checker off; passing 50,000 UK monthly users of the online features **[OWNER: pick a threshold]**; or Ofcom publishing new codes or guidance. **LAW: CHECK** Ofcom's rule on reassessing before a significant change.

## 8. Sign-off

| | |
|---|---|
| Name | David Leitch |
| Role | Sole trader, trading as InFlight; person accountable for online safety |
| Signature | ______________________ |
| Date | ______________________ |
| Solicitor reviewed (name, firm, date) | ______________________ |
