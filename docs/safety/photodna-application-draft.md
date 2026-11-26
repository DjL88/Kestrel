# Draft answers: Microsoft PhotoDNA Cloud Service application

> **DRAFT for a solicitor's review and the owner's check. Not legal advice.**
> Written 26 November 2026. The questions below are the kind Microsoft's application asks; **the exact form was not opened while writing this** (UNVERIFIED). Copy the answers into whatever the live form asks, at microsoft.com/photodna. Blanks marked **[OWNER]** are the owner's legal and contact details.
> Do not paste secrets into the form. Do not accept Microsoft's terms on the owner's behalf: the owner reads and accepts them.

## Organisation

| Question | Answer |
|---|---|
| Legal name of organisation | David Leitch, trading as InFlight **[OWNER: confirm exactly as registered with HMRC]** |
| Type of organisation | Sole trader (unincorporated), United Kingdom |
| Registered / business address | InFlight, 7 High Street, Kington, HR5 3AX, United Kingdom **[OWNER: confirm]** |
| Country | United Kingdom |
| Website | **[OWNER: public site URL]** |
| Company or VAT number | **[OWNER: if any]** |
| ICO registration | Applied for, pending (application C2096911, from `site/privacy.html`) **[OWNER: add number when issued]** |
| Primary contact (name, role, email, phone) | David Leitch, owner. **[OWNER: dedicated safety email, not a personal address]**, **[OWNER: phone]** |
| Technical contact | Same as above **[OWNER]** |
| Legal contact | **[OWNER: solicitor, if they will act]** |

## The service

**Describe your service.**

> InFlight is a photo workflow app for Windows, macOS and the web. Editing happens on the user's own device. Users with an account can optionally share projects with people they invite by email, store photo previews in the cloud for those projects (Google Cloud, London), and publish client galleries: a set of photo previews behind an unguessable link, optionally password-protected, that expires after at most 90 days. There is no public feed, search, public profile or messaging between strangers.

**What user-generated content do you host?** Still images only: previews (JPEG, up to 8 MB) and small filmstrip pictures of photos that users choose to share or store in the cloud. Optionally the original file, stored only after its preview has passed the checks. Text comments between project members, and feedback from gallery visitors to the photographer.

**How will you use PhotoDNA?**

> Every image a user puts into a client gallery or a shared project's cloud store is sent to PhotoDNA's Match API before anyone else can see it. Images that stay on the user's device are never sent. On a match we block the image, remove the shared copy, preserve the bytes in a private store for one year, suspend the account, take the gallery down, and report the case to NCMEC's CyberTipline (and to the UK National Crime Agency for UK users). No person views a matched image. If PhotoDNA cannot answer, the image is not published and the user may retry: sharing fails closed. In production, sharing cannot open at all until a hash checker is configured.

(Code: `services/control-plane/src/contentSafety.ts` `PhotoDnaMatcher` and `SafetyService.check`; `services/control-plane/src/app.ts` `safetyCheck()`.)

**Which API?** PhotoDNA Cloud Service, Match endpoint (`/photodna/v1.0/Match`), image bytes in the request body, `enhance=false`. Images are at least 50 px and at most 4 MB; larger previews are refused with a message asking for a smaller one.

**Expected volume.** **[OWNER: estimate]** images per month in the first year (for example, under 10,000 a month at launch). Peak **[OWNER]** per day.

**Will you store PhotoDNA hashes?** No. The service stores only the case record (time, account id, project and gallery ids, SHA-256 of the file, PhotoDNA's tracking id and match source). **UNVERIFIED** whether Microsoft's terms need this stated differently.

**How will you report matches?** To NCMEC through the CyberTipline Reporting API, as a registered electronic service provider (registration in progress; see `ncmec-esp-registration-draft.md`). Until that connection is live, each case is reported by hand through NCMEC's CyberTipline and recorded on the case. For UK users the case is also reported to the National Crime Agency **[solicitor: confirm the UK route and whether OSA section 66 regulations are in force]**.

**Do you have a relationship with NCMEC?** Registration as an ESP applied for on **[OWNER: date]**; ESP ID **[OWNER: when issued]**.

**Content moderation process.** One accountable person (the owner) reviews cases in an admin page that shows metadata only; no route can show a matched or held image. Reports from the public come through a *Report this gallery* form on every gallery, with urgent handling for child sexual abuse reports (the gallery is taken down at once).

**Data location and security.** The control plane runs on Google Cloud Run (London); images and evidence are in a private Google Cloud Storage bucket in London; secrets (including the PhotoDNA key) are in Google Secret Manager, never in code. Encrypted in transit and at rest.

**Number of users.** **ASSUMPTION — [OWNER]** expected users of the sharing features in the first 12 months.

## After approval

1. Store the subscription key in Secret Manager as `photodna-key` in project `kestrel-hosting` (the owner adds the value; never in Git or chat).
2. Switch it on with `switch-features.sh` and `{"photodna_key_secret_id":"photodna-key"}` (`infra/gcp/safety.tf`, see `safesearch-switch-on.md`). Terraform sets `KCP_PHOTODNA_KEY_SECRET` and gives the control plane's account read access to that secret. Don't set it by hand with gcloud: the next apply removes it.
3. Test with Microsoft's own test image on a throwaway account (`docs/SAFETY-SETUP.md` "Checking it works once set up").
4. Fill in PhotoDNA's processing region on `site/subprocessors.html` (Microsoft is already named there and in `site/privacy.html`).
