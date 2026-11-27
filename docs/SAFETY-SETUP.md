# Safety on shared and cloud photos: what is built

Not legal advice. The policy people agree to is `/acceptable-use` (site/acceptable-use.html). The code is `services/control-plane/src/contentSafety.ts`. The paperwork is in `docs/safety/README.md`.

- **No scanning.** InFlight does not check, scan or hash any photo (removed 27 November 2026). Photos on a device, local editing and safe copy are never seen by InFlight. Sharing happens only when a user shares a project or publishes a gallery.
- **Report a gallery** (EU DSA notice and action, UK Online Safety Act reporting). Every client gallery has a *Report this gallery* form: no account, category, explanation, optional name and email, good-faith statement. The reporter gets a reference and a receipt to check the outcome. A child sexual abuse report takes the gallery down at once until reviewed.
- **Deciding a report.** In /admin → Safety choose no action, remove the photo, or revoke the gallery, with a reason that the reporter and the gallery owner both see. Admins see report details only; no route opens a reported picture.
- **Child sexual abuse material.** Remove it, suspend the account, and report it by hand to the NCA and the IWF (`docs/safety/README.md`). Keep no copies.
- **Suspended accounts.** Every gallery a suspended account created stops serving.

## Checking it works

Make a test gallery with a synthetic photo, report it from the gallery page, and decide the report in /admin → Safety. The reporter's receipt page and `/v1/me/safety` should both show the outcome and reason.
