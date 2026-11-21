# Backend handover (20 November 2026)

Where Kestrel's online side stands, what still needs doing, and who does what. Kestrel itself works fully offline;
everything here is optional for the person using it. Decisions and order of work are in
[ROADMAP.md](ROADMAP.md) ("Hosting on Google Cloud" and "Accounts, licences, payments and the admin console");
exact commands are in [infra/gcp/README.md](../infra/gcp/README.md).

## The shape of it

| Part | What it does | Where |
| --- | --- | --- |
| Website | Product page, downloads, prices, contact form, `/admin` | `site/`, Firebase Hosting |
| Downloads bucket | Installers, `SHA256SUMS.txt`, `latest.json` | Cloud Storage, London |
| Models bucket | ONNX models and a signed list of them | Cloud Storage, London |
| Control plane | Licences, offline grants, devices, AI allowance, payments, contact messages, audit log | `services/control-plane`, Cloud Run + Firestore |
| Admin console | Your view of licensees, devices, usage, payments, messages; issue/revoke keys | `site/admin.html` → control plane |
| App | Reads its Pro status from a signed offline grant; never needs the server to work | `src/core/entitlementGrant.ts`, `useAccess` |

Everything is in the Google Cloud project **`kestrel-hosting`** (billing in GBP, region `europe-west2`, London),
created and changed only with Terraform in `infra/gcp` (state in `gs://kestrel-hosting-kestrel-tfstate/hosting/`).

## Status

**Live (phase 1, since 20 Nov)**
- Website: https://kestrel-hosting-kestrel.web.app (Kestrel branding, download suggested per device, "Coming soon").
- Downloads: `latest.json` says coming soon; `releases/<platform>/` folders are ready. No installers yet.
- Models: 4 ONNX models and `manifest/stable.json` (revision 1), signed with key id `kestrel-2026-11`. Public key
  `fRgITdAJPfCXpyEJ7DZml8316QBUgNlPsc3TPw07ZUw=` (also at `manifest/public-key.json`). Checked from outside: valid
  signature, wrong key refused, downloaded model's size and SHA-256 match.
- Budget alert: £20 a month (emails at 50%, 90%, 100%).

**Deployed (verified 21 Nov 2026 with `gcloud`, read-only)**
- Control plane: Cloud Run service `kestrel-control-plane`, `europe-west2`, revision 00002 (deployed 20 Nov 18:14), Ready, scale 0 to 1, public invoker (it authenticates requests itself). Firestore native database `(default)` in `europe-west2` exists. Secrets attached: signing key, session secret, webhook secret, licence public key, admin allow-list; the Google OAuth client id is set. Only empty-message warnings in the logs over two days. Not checked from the sandbox: the live `/healthz` and the website (egress to `*.run.app` and `*.web.app` is blocked there), so confirm those from your own machine.
- **Licence issuing is OFF.** Secret `kcp-licence-private-key-pem` has no versions and the service has no `KCP_LICENCE_PRIVATE_KEY_PEM`, so `POST /v1/admin/licences/issue` answers `LICENCE_SIGNING_UNAVAILABLE`.
- **Payments are not connected.** Secret `kestrel-sumup-api-key` has no versions.
- **One admin.** The allow-list (`kcp-admin-emails`) holds one Google account. Add more addresses to give others access to the console.

**Merged earlier (now deployed above)**
- Control plane on Firestore, Cloud Run, Artifact Registry and its secrets in Terraform (#535).
- Admin console with Google sign-in (allow-list), gift keys, revoke, usage, payments, contact inbox, tax, audit (#584).
- Contact form on the website, wired to the admin inbox (#586).
- Pro pricing, tax administration and the SumUp groundwork (#547).

**In progress (licensing session)**
1. App ↔ backend: Settings → Licence (enter key, status, devices, deactivate), offline grant stored and renewed,
   Pro features read from it, models fetched from the signed bucket (bundled models stay as the offline fallback).
2. Accounts: Sign in with Apple, Google or an email link, only to buy Pro or use it on several devices.
3. SumUp Hosted Checkout for the one-off licence (webhook is the source of truth).
4. Website: no GitHub or beta links, translations, regional prices (£29 / €29 / $29, tidy prices elsewhere), how-to.

## What only you can do (in this order)

1. **Keep offline copies of the signing keys** (a password manager is fine). Losing one means an app update to change
   the key the app trusts.
   - Model list key: in Secret Manager `kestrel-manifest-signing-key`
     (`gcloud secrets versions access latest --secret=kestrel-manifest-signing-key` in Cloud Shell prints it).
   - Licence key: `~/.kestrel-signing/licence.key.pem` on your Mac (its public half is pinned in
     `src/core/licence.ts`).
   - Desktop update key: `~/.kestrel-signing/kestrel.key` on your Mac (see [DESKTOP.md](DESKTOP.md)).
2. **Google OAuth client for `/admin`** (console: APIs & Services → OAuth consent screen, then Credentials). Steps in
   `infra/gcp/README.md` → "The admin console". The client ID is public.
3. **Your email on the admin allow-list** (secret `kcp-admin-emails`). The service won't start without it.
4. **Deploy the control plane** with the coordinator: secrets filled, image built with Cloud Build, Terraform applied
   (`infra/gcp/README.md` → "Phase 2"). Decide whether the server may issue gift keys
   (`licence_issuing_enabled`; it then needs the licence private key in Secret Manager).
5. **SumUp**: create the online-payments API key in your SumUp account and add it to Secret Manager (the licensing PR
   will name the secret). Register the website domain for Apple Pay with SumUp's instructions.
6. **Contact email**: choose Gmail sign-in (OAuth) or an app password stored in Secret Manager; the contact PR says
   which. Until then, the admin console is the inbox.
7. **Tax**: confirm UK VAT and EU non-Union OSS with an accountant before taking payments (SumUp is a payment
   processor, not the legal seller). Prices are shown "before any local tax" until then.
8. **App stores**: in-app purchase products for the one-off licence in App Store Connect and Google Play Console, when
   the mobile apps are ready.

## How work is merged

One coordinator session merges to `main`. Other sessions push their own branch and open a PR. The coordinator runs
`npm ci`, `npm run lint`, `npm test`, `npm --prefix services/control-plane run lint` and its tests, and Playwright
for app screens, then merges and applies any Google Cloud change only with your approval. Tests use `node:test`
(Jest-style `expect` from `src/core/testExpect.ts`, never `vitest`).

## Known issues today

- `main` is red from an unreviewed HEIC work-in-progress merge (#581): a missing type declaration and one HEIC
  capture-time test. The HEIC agent is fixing it.
- #561, #562 and #563 conflict with `main` and wait for their authors to rebase.
- The C: drive is nearly full (single-digit GB). Rust builds need about 15 GB free; see `docs/INSTALL-FROM-SOURCE.md`.
- Several sessions merged in parallel today and broke `main` three times; the one-coordinator rule exists for that.


## Turning on licence creation and adding people (needs the owner)

1. **Add the licence private key.** From the Mac that holds it: `gcloud secrets versions add kcp-licence-private-key-pem --project kestrel-hosting --data-file="$HOME/.kestrel-signing/licence.key.pem"`. Its public half must equal `LICENCE_PUBLIC_KEY` in `src/core/licence.ts`; a different key would make every issued licence fail in the app. Do not generate a new pair unless an app update is planned.
2. **Apply with issuing on.** `terraform -chdir=infra/gcp plan` then `apply` with `-var licence_issuing_enabled=true` (plus the existing image and client-id variables, see `infra/gcp/README.md`). Review the plan first: it should only grant the service account access to that secret and add the environment variable.
3. **Add admins.** Add a new version of `kcp-admin-emails` with the full comma-separated list of Google addresses, then redeploy or restart the service so it reads it. Every admin can issue and revoke licences, and each action is written to the audit log, so keep the list short.
4. **Check.** Sign in at `/admin` with an allow-listed account, issue a test key, activate it in a development build, then revoke it.
