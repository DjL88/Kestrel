# InFlight: children's access assessment (UK Online Safety Act 2023)

> **DRAFT for a solicitor's review. Not legal advice. Not yet signed.**
> Written 26 November 2026 from the code on `main` (`aadaa2d3`) and the site pages. **LAW: CHECK** marks points the solicitor should confirm against Ofcom's current Children's Access Assessments guidance.

## Minimum age today: 13+

The terms and privacy notice set **13 or over** to create an account, and 18 or over (or a parent's or guardian's permission) to buy:

- `site/terms.html` §6 Accounts: "You must be at least 13 to make an account, and at least 18, or have a parent's or guardian's permission, to buy."
- `site/privacy.html` "Children": "You must be 13 or over to create an account."

So InFlight is **13+, not 18+**. 13–17 year olds are allowed users of the shared and cloud features.

**There is no age check in the code.** On 26 Nov 2026 the only mentions of a minimum age in `src/`, `services/control-plane/src/` and `site/` are the two policy sentences above. Sign-up through Firebase Authentication (Google, Apple, or email and password) asks for no date of birth. Gallery visitors need no account at all, so a child of any age can open a gallery link sent to them.

## Stage 1: is it possible for children to access the service?

**Yes.** Ofcom's guidance is that a service can answer "no" only if it uses highly effective age assurance so that children cannot normally access it. **LAW: CHECK.** InFlight has no age assurance, and its own terms admit 13–17s.

## Stage 2: the child user condition

The condition is met if the service has a significant number of child users in the UK, **or** is of a kind likely to attract a significant number of child users. **LAW: CHECK** Ofcom's reading of "significant" (it can be a small number in absolute or relative terms).

| Question | Answer |
|---|---|
| Evidence of how many UK users are under 18 | **None yet**: the online features are not open. **ASSUMPTION — [OWNER]**: expected share of under-18 users. |
| Is the service of a kind likely to attract children? | Partly. It is a photo editing and client delivery tool aimed at photographers, priced for hobbyists and professionals. Teenage photographers (school, clubs, wildlife) are a plausible audience, and the terms invite them from 13. Gallery links reach clients and families, including children. |
| Is the service designed or marketed for children? | No (`site/privacy.html`: "InFlight is not aimed at children"). |

**Provisional conclusion:** because the terms permit 13–17 year olds and there is no age assurance, InFlight should **treat the child user condition as met** and the user-to-user parts as **likely to be accessed by children**. That brings in the children's risk assessment and the protection-of-children duties (**LAW: CHECK** which duties and codes apply to a small service).

## The owner's choice

1. **Keep 13+.** Then carry out a children's risk assessment for the shared and gallery features (separate document, not drafted yet) and apply Ofcom's children's code measures that fit a small, invite-only service. The invite-only design already removes stranger contact; the main extra work is protection from harmful (not only illegal) content and child-friendly reporting.
2. **Raise accounts with online features to 18+.** Change the terms and privacy notice. This alone does **not** let you answer "no" at stage 1 unless highly effective age assurance is added (for example a third-party age check at sign-up for sharing and cloud). Without it, you could still argue at stage 2 that there is no significant number of child users, but you would need evidence, and the gallery-visitor route stays open to any age. **LAW: CHECK.**
3. **18+ with age assurance for sharing and cloud only.** Local editing stays account-free and is outside the Act. Strongest position; adds cost and a third-party processor.

**Decision (owner, 26 Nov 2026): option 1, keep 13+.** A children's risk assessment for the shared and gallery features is therefore needed before those features open to UK users (not drafted yet). For the solicitor: the age rules in other regions (EU digital consent ages of 13 to 16 by country, the UK Children's Code, Australia's under-16 social media rule).

**How age is handled (owner, 26 Nov 2026): 13+ by self-declaration only, with no age-check process.** The terms say 13+, and nothing in sign-up asks for or checks an age. What follows from that:

- **Stage 1 stays "yes".** Without highly effective age assurance, InFlight cannot say children are unable to use the service, and self-declaration does not count as age assurance. **LAW: CHECK.**
- **The service does not know which users are children.** So the children's risk assessment must treat **every** account holder and **every** gallery visitor as possibly under 18. Protections cannot be switched on "for child accounts only". They have to be the default for everyone, or built into the design: invite-only projects, no stranger contact, no public discovery.
- **Under-13s may still sign up** by giving a false answer, and anyone of any age can open a gallery link. The children's risk assessment should weigh that, and say what happens when InFlight learns a user is under 13 (the privacy notice already says the data is deleted).
- **The children's risk assessment needs to cover** content harmful to children that is not illegal, such as pornography and self-harm material in galleries. It should also cover how a child reports something, and whether the SafeSearch hold (explicit adult content held for review) is enough as a default for all users. **LAW: CHECK** which of Ofcom's Protection of Children Codes measures apply to a small service at the risk levels found.
- **If this changes** (for example an age check for sharing, or 18+), redo this assessment and the children's risk assessment before the change goes live.

Signed copies of this assessment, and later the children's risk assessment, are kept in /admin → Compliance documents (`compliance-documents.md`).

## Review

Repeat this assessment within 12 months, and before any change to the minimum age, sign-up, galleries (for example public galleries), or marketing to schools or young people. **LAW: CHECK** Ofcom's review interval.

## Sign-off

| | |
|---|---|
| Name | David Leitch, trading as InFlight |
| Outcome chosen | Option 1: 13+ by self-declaration only, no age-check process (owner, 26 Nov 2026) |
| Signature / date | ______________________ |
| Solicitor reviewed | ______________________ |
