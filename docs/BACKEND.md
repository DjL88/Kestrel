# What Kestrel will ask of its own backend

**Built locally, not deployed.** The service is [`services/control-plane`](../services/control-plane/README.md), and its README is the current contract (endpoints, security tests, shared `src/core` modules). Where this proposal and the README differ, the README wins: for example, the manifest is served at `/v1/models/manifest` as a signed envelope, and identification at `/v1/ai/identify`. Core local import, editing and export do not require a Kestrel server. Optional online operations must report success, failure and retry clearly without blocking local work.

## Recommended hosting boundary

The download website and the secrets backend are different things:

| Component | Host / responsibility | Must not contain |
| --- | --- | --- |
| Public website | Static hosting such as the existing Pages workflow: app information, platform availability, privacy/help, links to verified release installers | Provider keys, signing private keys, customer credentials |
| Installers and model files | Versioned release/object storage with checksums, caching and signed application releases | Runtime secrets |
| Optional API | Small HTTPS service or serverless API under a separate origin/path; authenticate users, validate requests, enforce quotas, broker analysis and OAuth | Arbitrary filesystem access, arbitrary user-selected upstream URLs or unrestricted AI tool execution |
| Server secret store | Hosting provider's secret manager/environment injection; scoped AI credentials, OAuth client secrets and webhook verification keys | Anything exported into the frontend build |
| Device credential store | OS-backed secure storage for native third-party refresh tokens; session-only browser credentials until a suitable flow exists | A claim that `localStorage` is encrypted or a system keychain |

`VITE_*` values are public build configuration, **never secrets**. Bundled `.env` files, a desktop executable and a Chrome extension cannot protect a shared provider private key. Installer/update signing keys belong only in the release signing environment; the app holds verification public keys.

Current code: the online helper's bring-your-own-key UI is hidden unless `VITE_SHOW_ONLINE_HELPER=true`; when enabled it can call Google directly. S3/WebDAV connectors are direct, user-configured connections, and remembered credentials use browser storage. Neither is a deployed Kestrel backend. Do not silently migrate those credentials or images to a new server. Local MCP is a separate stdio process, not an internet endpoint.

### Smallest useful backend release

1. Keep the download site static. No backend/account is required just to download an installer or edit local photos.
2. Add an authenticated analysis broker behind the existing `HelperTransport` boundary. Use short-lived session credentials, not the shared provider key or a permanent licence string as a bearer token. Authenticate before expensive decoding or upstream calls; enforce per-user quotas, concurrency, timeouts and strict body/image-size limits.
3. Accept only a deliberately shared, resized, metadata-stripped image. Explain the destination, processing provider, allowance and retention before enabling uploads. Default to no image retention, and do not log payloads, EXIF, provider keys or tokens. Verify provider-side retention rather than promising deletion the service cannot guarantee.
4. Return a versioned, validated result: subject/species suggestions, plain-text opinion and optionally whitelisted numerical recipe proposals. AI has no source-write/delete tool, no cloud credentials and no arbitrary URL-fetch tool. The app validates bounds and applies proposals only under the user's enabled automation/review policy, with undo.
5. Test unauthorised/expired requests, quota exhaustion, oversized or malformed images, provider failure, cancellation and offline operation before enabling the transport in public builds. Missing credentials must disable the online feature with a useful message, not use a bundled key.

Managed storage and accounts should be a later service, not a prerequisite for this broker. Prefer provider OAuth with narrow scopes and revocable tokens where supported; NAS/local folders remain device-side. Choose hosting vendor, budget, data region, authentication and retention policy before deployment. See the [live audit](history/RELEASE-GAP-AUDIT-2026-11.md) (historical; superseded by [ROADMAP.md](ROADMAP.md)) for the release order.

## 1. Updates for models and the species library

Today the species model is fetched from the app's own site (`npm run model:species`) and the species names ship inside the app. With a backend they become downloads that stay on the device and are checked for updates.

The app asks for one small file, at most once a day and only when online:

`GET /v1/manifest.json`

```json
{
  "version": 3,
  "items": [
    { "id": "species-model", "kind": "onnx", "version": "2026.11.1", "url": "/files/bioclip-image-int8.onnx",
      "sha256": "ea40…e8a2", "bytes": 89041951, "license": "MIT", "notice": "/files/bioclip-notice.txt" },
    { "id": "species-library-uk", "kind": "library", "version": "2026.11.2", "url": "/files/species-uk.json",
      "sha256": "…", "bytes": 110612, "needs": { "species-model": "2026.11.1" } }
  ]
}
```

Rules the app will follow:
- It keeps what it already has. Offline, or if the server is down, nothing changes and nothing is reported as an error.
- A new item is downloaded only on the user's say-so for large files (the model), and silently for small ones (the library). Each is checked against its `sha256` and `bytes` before it replaces the old one, and the old one stays until the new one is verified.
- `needs` stops a library being used with a model it was not made for. The vectors in a library only mean something to the model that made them, so the two are updated together.
- Files are served with caching headers and, ideally, range requests so an interrupted download can resume.
- Nothing about the user is sent with the request, beyond what a browser sends to any site.

## 2. The online helper, through the server

In an explicitly enabled bring-your-own-key build, the user supplies a key and the app calls Google directly (`geminiTransport`). This UI is hidden by default. The helper has one interface (`HelperTransport` in `src/providers/onlineHelper.ts`), so a server version can be a second implementation, not a rewrite. Consent must be updated before changing the destination.

Proposed: `POST /v1/describe` with `Authorization: Bearer <short-lived session token>`

Request: `{ "image": "<base64 JPEG, about 640 px, no metadata>" }`
Response, the same shape the app already checks: `{ "kind": "wildlife", "species": "Red kite", "scientific": "Milvus milvus", "confidence": "high", "tags": ["in flight"] }`

The server holds the provider key, picks the model and checks entitlement and allowance. Image/result caching is off unless a retention policy and explicit consent cover it. The app still validates answers with `parseHelperAnswer`, which rejects links/markup in tag fields; this does not establish that a species identification is correct. The transport must map 401 (session expired/not authorised), 429 (allowance used) and provider/network failures into clear user-facing states.

Privacy to carry over: the server should not keep the image longer than needed to answer, should say so in its terms, and the consent screen in the app must then name the new destination (consent is versioned, so a change asks again).

## 3. Licence keys and accounts (for later)

- A licence key unlocks downloads and the helper allowance. It is checked by the server, and the app only holds the token it is given.
- Accounts (email and password, or a sign-in provider) come with cloud storage. Passwords are never handled by the app beyond sending them over HTTPS to the server's sign-in route, and are stored only as a slow salted hash on the server.
- Cloud storage, when it comes, should keep the device as the source of truth: decisions, edits and tags sync, originals stay local unless the user chooses otherwise. See `cloud-sync-proposal.md`.
