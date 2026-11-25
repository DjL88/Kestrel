# Safety checks on shared and cloud photos: what Dave sets up

Not legal advice. This is what the code does and the outside steps it needs. The policy people agree to is `/acceptable-use` (site/acceptable-use.html). The code is `services/control-plane/src/contentSafety.ts`.

## What is built

- **Only shared and cloud photos are checked.** A picture is checked when it is published to a client gallery (preview and filmstrip picture) or stored in a shared project's cloud store (preview and filmstrip picture). Photos on a device, local editing, and safe copy (a person's own private backup) are never checked or sent anywhere.
- **Known child sexual abuse material: hash matching.** Before anyone else can see it, the picture is matched against PhotoDNA and/or an exact-hash list. A match:
  - blocks it (the shared copy is removed);
  - moves the bytes to a private evidence key in the same UK bucket (`evidence/<case>`), kept at least a year (US law asks for a year after a report);
  - suspends the account and takes the gallery down;
  - files a CyberTipline report with NCMEC when the connection is set up (otherwise the case waits in **/admin → Safety** for a report by hand);
  - marks UK uploads for a direct NCA report as well.
- **Other unsafe content: Google Cloud Vision SafeSearch.** Explicit adult content (likely or more) or graphic violence (very likely) is held back from sharing and opens a review case. "Racy" alone never flags. An AI flag is **never reported** and never suspends anyone. The uploader sees the reason and can ask for another look.
- **Nobody views flagged pictures.** /admin → Safety shows details only (when, where, what the checker said). There is no button or route that opens a held or blocked picture or the evidence.
- **Report a gallery** (EU DSA notice and action, UK Online Safety Act reporting). Every client gallery has a *Report this gallery* form: no account, category, explanation, optional name and email, good-faith statement. The reporter gets a reference and a receipt to check the outcome. A child sexual abuse report takes the gallery down at once until reviewed. In /admin → Safety you choose no action, remove the photo, or revoke the gallery, with a reason that the reporter and the gallery owner both see.
- **Fails closed.** If a checker cannot answer, nothing is published and the person can retry. **In production, publishing to galleries and the cloud store is refused until at least one hash check is set up** (`SAFETY_NOT_CONFIGURED`). Development and tests are unchanged.

## What Dave needs to do (in this order)

1. **Hash matching: apply for Microsoft PhotoDNA Cloud Service** (free for qualifying organisations, vetted by Microsoft): microsoft.com/photodna. When approved you get a subscription key.
   - Store it in Secret Manager (for example `photodna-key`) and set `KCP_PHOTODNA_KEY_SECRET=projects/<project>/secrets/photodna-key/versions/latest` on the control plane.
   - PhotoDNA takes pictures up to 4 MB. Gallery previews larger than that are refused with a plain message asking for a smaller preview.
   - Google CSAI Match is for video, so it does not fit photos. Google's Content Safety API is a classifier, not a hash list, so it does not replace this step.
   - Optional, later: **IWF membership** gives the IWF hash list (paid, priced by company size). Put the list in a mounted secret file and set `KCP_SAFETY_HASH_LIST_FILE` (one MD5, SHA-1 or SHA-256 per line) and `KCP_SAFETY_HASH_LIST_SOURCE=iwf`. Exact hashes only catch identical files; PhotoDNA also catches resized copies.
2. **Reporting: register InFlight with NCMEC as an electronic service provider** for CyberTipline reporting (see "ESP" on NCMEC's CyberTipline pages; registration is free). NCMEC gives test credentials first.
   - Put the password in Secret Manager and set `KCP_NCMEC_USERNAME`, `KCP_NCMEC_PASSWORD_SECRET`, `KCP_NCMEC_REPORTER_EMAIL` (a dedicated safety address, not your personal one), `KCP_NCMEC_COMPANY`. It talks to NCMEC's **test** service until you also set `KCP_NCMEC_ENVIRONMENT=production`.
   - Before production, a Claude worker must run one report against NCMEC's test service: the client is written from NCMEC's documented submit, upload and finish steps but has **not been run against NCMEC yet**.
   - NCMEC passes reports to police in other countries, including the NCA.
3. **UK: the NCA.** Check whether the Online Safety Act section 66 reporting regulations are in force. When they are, UK cases must also go to the NCA's reporting service. Until a direct connection exists, each UK case shows "NCA manual" in /admin → Safety: report it there and press *NCA report made*.
4. **AI check: switch on SafeSearch** (a paid Google API, roughly the first 1,000 pictures a month free, then about $1.50 per 1,000; needs your approval as a cost). Enable the Cloud Vision API in the project and set `KCP_SAFESEARCH_ENABLED=1`. The control plane's service account calls it; no key in Git.
5. **UK Online Safety Act paperwork:** write the illegal content risk assessment (Ofcom's guidance and template) before shared galleries open, and keep it up to date. Ofcom's codes expect hash matching for file-storage and file-sharing services at risk of this material, which step 1 covers.
6. **EU Digital Services Act:** the point of contact is on `/acceptable-use`. Notice and action (Art. 16) and statements of reasons (Art. 17) are built. As a micro business, most extra "online platform" duties do not apply yet; check again if InFlight grows past 50 staff or €10m turnover.
7. **Australia and other countries:** check the eSafety Commissioner's industry codes and standards for storage and sharing services before marketing there.
8. **Legal sign-off:** read `/acceptable-use` and this page, and get the terms reviewed before sharing opens.

## Checking it works once set up

- Upload PhotoDNA's own test image (Microsoft provides one with the service) to a test gallery: the publish is refused, a hash-match case appears in /admin → Safety with no picture shown, and the test account is suspended. Use a throwaway account.
- Publish an ordinary photo: it appears in the gallery.
- Report the test gallery from its page: the report appears in /admin → Safety; decide it and check the receipt shows the reason.

## Not done yet

- Evidence sits in the gallery bucket under `evidence/` (private, outside the 90-day gallery rule). A separate bucket with a locked retention policy would be stronger; that is a Terraform change for the backend lane.
- RAW originals cannot be hashed by PhotoDNA. An original is stored only after its preview has passed.
- Safe copy is not checked, because it is a person's own private backup that nobody else sees. Revisit if safe copy ever gets sharing.
- No email goes to the reporter or the uploader yet; both see the outcome through the receipt or in the app's safety list (`GET /v1/me/safety`). The app does not show that list yet.
