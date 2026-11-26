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
| [safesearch-switch-on.md](safesearch-switch-on.md) | How SafeSearch, PhotoDNA and NCMEC are switched on with the Terraform switches, and in what order. | When to switch each one on. |

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
| PhotoDNA application | Microsoft, via microsoft.com/photodna | Safety email: inflight-safety@googlegroups.com (Google Group, anyone can post, only the owner reads; set up 26 Nov 2026). Read and accept Microsoft's terms yourself. |
| NCMEC ESP registration | NCMEC, via the ESP section of its CyberTipline pages | Same safety email (inflight-safety@googlegroups.com). Have the law enforcement contact ready. |
| Nothing to Ofcom | — | Ofcom does not collect risk assessments by default; keep the record and update it. (**LAW: CHECK**: fees and notification duties apply only above a revenue threshold.) |

## 5. Then (Claude sessions do these, with your go-ahead)

Done in #1734: the Terraform switches for SafeSearch, PhotoDNA and NCMEC (`infra/gcp/safety.tf`, off by default), a hash match taking down every gallery of the suspended account (gap G6), and PhotoDNA and Cloud Vision named on the subprocessors and privacy pages (gap G10). Still to do:

1. You: deploy the control plane from `main` with `deploy-control-plane.sh`, then run `switch-features.sh` with `{"safesearch_enabled":true}`. Exact steps are in `safesearch-switch-on.md`.
2. You: when Microsoft and NCMEC approve, put the PhotoDNA key and NCMEC password in Secret Manager, then switch them on with the JSON in `safesearch-switch-on.md`. NCMEC stays on its test service.
3. A Claude worker: one test report against NCMEC's test service, then the checks in `docs/SAFETY-SETUP.md` "Checking it works once set up". Record the results in the risk assessment. Only then `{"ncmec_environment":"production"}`.
4. You: fill in PhotoDNA's processing region on the subprocessors page once Microsoft confirms it.
