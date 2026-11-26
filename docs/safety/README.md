# Online safety paperwork: what to read, sign and send

> **DRAFTS for a solicitor's review. Not legal advice.** Written 26 November 2026 by a Claude session from the code on `main`. Nothing here has been sent, signed or switched on.

Sharing, client galleries and cloud storage cannot open in production until a hash checker is set up: the server refuses to publish (`SAFETY_NOT_CONFIGURED`). These papers and applications are what it takes to open them.

## 1. Read (about an hour)

| File | What it is | Your decisions in it |
|---|---|---|
| [illegal-content-risk-assessment.md](illegal-content-risk-assessment.md) | The Online Safety Act risk assessment, in Ofcom's four steps. Every claim about the code names the file. | Fill in user numbers (marked **ASSUMPTION**), response times, review date. Agree the risk levels. Read the gaps table (section 4). |
| [childrens-access-assessment.md](childrens-access-assessment.md) | Can children use InFlight? Today's terms say **13+**, with no age check, so the honest answer is yes. | Choose: keep 13+ (then a children's risk assessment is needed), or 18+ (with or without age checks). |
| [photodna-application-draft.md](photodna-application-draft.md) | Answers for Microsoft's PhotoDNA Cloud Service application. | Your legal name, address, safety email, volumes. |
| [ncmec-esp-registration-draft.md](ncmec-esp-registration-draft.md) | Answers for NCMEC registration (CyberTipline reporting), plus the UK NCA duty. | Contact details, including a law enforcement contact. Four questions for the solicitor at the top. |
| [safesearch-switch-on.md](safesearch-switch-on.md) | How SafeSearch is switched on, and why it needs a small Terraform change first. | None; it is for the backend lane and then you. |

## 2. Give to the solicitor

All five files, plus `site/terms.html`, `site/acceptable-use.html`, `site/privacy.html` and `docs/SAFETY-SETUP.md`. Ask especially about:

1. **Keeping CSAM evidence in the UK for a year and uploading it to NCMEC** (risk assessment gap G5; NCMEC draft question 3). This is the biggest legal question.
2. Whether OSA **section 66** (reporting CSEA to the NCA) is in force, and the right NCA route.
3. Whether **US 18 U.S.C. 2258A** applies to a UK sole trader with US users.
4. Whether the risk levels and the 13+ decision hold up, and which Ofcom codes apply to a service this size.

## 3. Sign (after the solicitor)

- The **illegal content risk assessment** (section 8). Keep a signed copy; Ofcom can ask for it.
- The **children's access assessment**.

## 4. Send

| What | Where | Before you send |
|---|---|---|
| PhotoDNA application | Microsoft, via microsoft.com/photodna | Set up a dedicated safety email first. Read and accept Microsoft's terms yourself. |
| NCMEC ESP registration | NCMEC, via the ESP section of its CyberTipline pages | Same safety email. Have the law enforcement contact ready. |
| Nothing to Ofcom | — | Ofcom does not collect risk assessments by default; keep the record and update it. (**LAW: CHECK**: fees and notification duties apply only above a revenue threshold.) |

## 5. Then (Claude sessions do these, with your go-ahead)

1. Backend lane: add the Terraform switches for SafeSearch, PhotoDNA and NCMEC (`safesearch-switch-on.md`). Without them a deploy silently drops the settings.
2. You: put the PhotoDNA key and NCMEC password in Secret Manager; run `switch-features.sh` with `{"safesearch_enabled":true}` and the PhotoDNA and NCMEC values.
3. A Claude worker: one test report against NCMEC's test service; then the checks in `docs/SAFETY-SETUP.md` "Checking it works once set up". Record the results in the risk assessment.
4. Site: add Microsoft (PhotoDNA) and Google Cloud Vision to the subprocessors and privacy pages.
5. Backend lane: take down every gallery of a suspended account, not just the one with the match (gap G6).
