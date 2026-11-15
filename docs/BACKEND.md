# What Kestrel will ask of its own backend

A proposal, not built yet. Today the app works fully without any server. Everything here is optional and fails quietly, so the app never depends on it. It is written so the backend can be built to match.

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

Today the user pastes their own key and the app calls Google directly (`geminiTransport`). The app already talks to the helper through one interface (`HelperTransport` in `src/providers/onlineHelper.ts`), so a server version is a second implementation, not a rewrite.

`POST /v1/describe` with `Authorization: Bearer <licence or session token>`

Request: `{ "image": "<base64 JPEG, about 640 px, no metadata>" }`
Response, the same shape the app already checks: `{ "kind": "wildlife", "species": "Red kite", "scientific": "Milvus milvus", "confidence": "high", "tags": ["in flight"] }`

The server holds the Google key, picks the model, applies the licence and any allowance, and may cache by image hash. The app still validates every answer exactly as it does now (`parseHelperAnswer`), so a faulty server cannot put markup or a link into a tag. Errors the app understands: 401 (not licensed), 429 (allowance used), anything else (try again later).

Privacy to carry over: the server should not keep the image longer than needed to answer, should say so in its terms, and the consent screen in the app must then name the new destination (consent is versioned, so a change asks again).

## 3. Licence keys and accounts (for later)

- A licence key unlocks downloads and the helper allowance. It is checked by the server, and the app only holds the token it is given.
- Accounts (email and password, or a sign-in provider) come with cloud storage. Passwords are never handled by the app beyond sending them over HTTPS to the server's sign-in route, and are stored only as a slow salted hash on the server.
- Cloud storage, when it comes, should keep the device as the source of truth: decisions, edits and tags sync, originals stay local unless the user chooses otherwise. See `cloud-sync-proposal.md`.
