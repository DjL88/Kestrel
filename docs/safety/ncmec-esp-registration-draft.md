# Draft answers: NCMEC electronic service provider (ESP) registration, CyberTipline reporting

> **DRAFT for a solicitor's review and the owner's check. Not legal advice.**
> Written 26 November 2026. The fields below are the kind NCMEC asks for when an ESP registers to report through the CyberTipline; **the live registration form was not opened while writing this** (UNVERIFIED). Registration is described on NCMEC's CyberTipline pages for ESPs. Blanks marked **[OWNER]** are the owner's details.

## Before applying: questions for the solicitor

1. **Does US law oblige InFlight to report?** 18 U.S.C. 2258A applies to providers of an electronic communication or remote computing service to the public. InFlight is a UK sole trader that will have US users. Is InFlight a "provider" under 2258A, or is reporting voluntary? Either way, NCMEC accepts reports and passes them to police worldwide, including the NCA.
2. **UK duty: the NCA.** Online Safety Act 2023 section 66 requires UK providers to report detected CSEA content to the National Crime Agency, once the reporting regulations are in force. **Are they in force on the launch date, and what format and deadline do they set?** Does a report to NCMEC satisfy any part of it? (Current code: every UK hash-match case is marked "NCA manual" in /admin → Safety until a direct route exists — `services/control-plane/src/contentSafety.ts` `openCase()`, field `nca`.)
3. **Keeping and sending evidence.** The service keeps the matched image for one year (as 2258A(h) asks after a report) in a private UK bucket, and uploads it to NCMEC with the report. Is that lawful for a UK sole trader under the Protection of Children Act 1978 and the Criminal Justice Act 1988, and on what basis? Should the retention period or location change?
4. **Data protection.** Lawful basis and transfer basis for sending the report (account id, network country, image) to NCMEC in the US.

## Registration details

| Field | Answer |
|---|---|
| Company / ESP name | David Leitch, trading as InFlight **[OWNER: confirm]** |
| Address | InFlight, 7 High Street, Kington, HR5 3AX, United Kingdom **[OWNER: confirm]** |
| Country of incorporation / operation | United Kingdom (sole trader, not incorporated) |
| Website | **[OWNER]** |
| Primary point of contact | David Leitch, owner; **[OWNER: dedicated safety email]**; **[OWNER: phone]** |
| Law enforcement contact (for legal process, preservation and follow-up) | **[OWNER: name, email, phone; and hours]**. NCMEC and police may ask for a 24/7 contact: say honestly what cover a one-person business can give. |
| Service type | Cloud storage and file sharing (still images); client photo galleries shared by link |
| Description | As in `photodna-application-draft.md`, "Describe your service". |
| How CSAM is detected | Microsoft PhotoDNA hash matching (and optionally an exact-hash list such as the IWF's) on every image before it is shared. Also user reports through *Report this gallery*. AI classifier flags (Google Cloud Vision SafeSearch) are **never reported**: they only hold an image back for review. |
| Expected number of reports per year | **ASSUMPTION — [OWNER]**. Probably very few; say so. |
| Reporting method | CyberTipline Reporting API (XML submit, file upload, finish). Manual web reports until the API connection has passed NCMEC's test environment. |
| Data held about a reported user | Account id, sign-in email (held by Firebase Authentication), plan, devices (hashed ids), shared projects, galleries, network country at upload, IP address in server logs for about 30 days (`site/privacy.html` "How long we keep it"). **[Solicitor: confirm what to preserve on request and for how long.]** |
| Preservation | Matched image and case record kept one year from the report (`EVIDENCE_KEEP_MS` in `contentSafety.ts`). |

## What a report from InFlight contains today

From `NcmecCyberTipline.submit()` in `services/control-plane/src/contentSafety.ts`:

- incident type "Child Pornography (possession, manufacture, and distribution)" and the time of the upload;
- reporter: the safety email (`KCP_NCMEC_REPORTER_EMAIL`) and company name (`KCP_NCMEC_COMPANY`);
- reported user: InFlight's account id and, when known, the network country;
- the image file.

It does **not** yet include the user's email address, IP address or the hash-match source, which NCMEC and police usually find useful. **[Solicitor and owner: decide what to add; a Claude worker can extend the XML.]** **NOT RUN**: this client has never been sent to NCMEC's test service.

## After registration

1. NCMEC issues test credentials first. Put the password in Secret Manager (for example `ncmec-password`); the owner adds the value.
2. Set `KCP_NCMEC_USERNAME`, `KCP_NCMEC_PASSWORD_SECRET`, `KCP_NCMEC_REPORTER_EMAIL`, `KCP_NCMEC_COMPANY` (code: `services/control-plane/src/wiring.ts` `buildSafety()`). It talks to `exttest.cybertip.org` until `KCP_NCMEC_ENVIRONMENT=production`. **Needs a Terraform variable first** (see `safesearch-switch-on.md`).
3. A Claude worker runs one test report against NCMEC's test service and records the result. Only then switch to production.
4. Add NCMEC to `site/privacy.html` where it mentions reporting.

## UK: the National Crime Agency

- Until a direct route exists, each UK case shows **NCA manual** in /admin → Safety. Report it through the NCA's route **[solicitor: confirm the correct NCA reporting channel for providers]** and press *NCA report made* (`/v1/admin/safety/cases/:id/manual-report` in `services/control-plane/src/app.ts`).
- If a child is in immediate danger, call 999 first.
- The Internet Watch Foundation takes public reports of CSAM web pages; it is not the provider reporting route.
