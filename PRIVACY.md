# Kite44 privacy

> DRAFT — written from what the code actually does as of 2026-11-17, not a
> lawyer-reviewed policy. Have this checked before publishing it as your real
> privacy policy, and keep it in sync as features change — a privacy page that
> drifts from the code is worse than none.

## The short version

Kite44 is local-first. Your photos, edits and catalogue stay on your device
unless you deliberately send them somewhere. There is no Kite44 account, no
analytics, and no crash reporting anywhere in the app today (verified by
searching the source for telemetry/analytics SDKs — there are none).

## What stays on your device, always

- **Original photos.** Never uploaded, never modified in place. Edits are
  stored as a separate, reversible "recipe" alongside your catalogue.
- **Your catalogue** (ratings, flags, crops, subject names, edit history) —
  IndexedDB in the browser build today; a local file/SQLite catalogue on
  desktop is on the roadmap. Nothing in it leaves your device by default.
- **Your Pro license key**, if you buy one — checked locally (an offline
  signature check), not against a Kite44 server.

## Features that send data somewhere, and exactly what they send

Kite44 has no backend server today. Every one of the following talks directly
from your device to the third party named — never through a Kite44-operated
server, because none exists yet.

- **Online helper (optional, off by default).** If you turn this on and supply
  your own Google Gemini API key, Kite44 sends a small, downscaled JPEG
  (re-drawn through a canvas first, which strips all EXIF/location metadata)
  directly to Google's Gemini API, using your key. Your key is stored locally
  on your device. Kite44's own servers are never involved, because it has
  none. See `src/providers/onlineHelper.ts`.
- **Cloud/NAS connectors (optional, off by default).** If you configure an
  S3-compatible bucket or a WebDAV server for backup or sync, Kite44 talks
  directly to that server with the credentials you provide. Those credentials
  are currently kept in browser storage, not a system keychain — treat them
  with the same care as a password saved in a browser, and expect this to move
  to proper OS-level credential storage before a general release.
- **Species model download (optional).** Downloads a static, checksum-verified
  model file so species suggestions can run fully offline afterwards. No photo
  or personal data is sent to fetch it.

## What we don't do

- No analytics, telemetry, or usage tracking of any kind.
- No account, sign-in, or email required to use Free or Pro.
- No advertising, no data sale, no third-party trackers.
- No generative AI: on-device suggestions (culling, species, auto-edit) only
  score, tag, or propose recipe adjustments — they never create or replace
  pixels you didn't shoot, and the optional online helper only answers
  questions about a photo you send it, it doesn't edit anything.

## If a cloud tier is ever added

Per the product direction in `README.md`: any future paid cloud/sync service
must be opt-in, scoped to exactly what it says it does, and must never upload
originals by default. Free, offline import/edit/export must keep working with
no account and no network connection, forever — a cloud tier is additive, not
a requirement.

## Children's privacy

Kite44 doesn't knowingly collect personal data from anyone, because it
doesn't collect personal data from anyone — there's no account system to
collect it into.

## Questions

Replace this line with a real support contact before publishing: *(add your
support email here)*.
