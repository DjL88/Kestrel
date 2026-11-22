# AI integration (design, nothing built yet)

Aim: let an assistant such as Claude work *with* Kestrel: "review this shoot, choose the strongest 10 bird photos, recover the highlights and protect feather detail". Provider-neutral, local first, and always under the person's control.

## Principles
- **Off by default.** Turned on per session by the person, with a visible indicator while connected.
- **Read first, write later.** Start with read-only tools. Editing tools come after, as proposals.
- **Proposals, not changes.** An assistant never edits directly: it submits a proposed edit recipe. Kestrel shows before and after; the person approves; it lands in normal history and can be undone.
- **No unrestricted access.** No filesystem or raw-library access. The assistant sees only what a tool returns, and only for the photos the person selected.
- **No silent uploads.** Pixels reach an external model only as reduced-size previews the person chose, after a consent screen that names the destination. Metadata-only reasoning is the default.
- **Originals are never touched.** All results are recipes.
- **Separate billing.** A person's Claude (or other provider) subscription is not a Kestrel subscription; Kestrel entitlements are checked separately. Free has no hosted AI; Paid has on-device intelligence; hosted AI belongs to the Cloud subscription.

## How: MCP (Model Context Protocol)
The desktop app can run a local MCP server. Transport: stdio launched by the assistant app, or a localhost port with a per-session token (never open to the network). Tools, in order of release:

| Phase | Tool | What it does |
| --- | --- | --- |
| 1 read | `list_projects`, `get_selection` | What is open and selected (ids, names, ratings, tags) |
| 1 read | `get_photo_info` | Capture settings, camera, lens, existing tags (no pixels) |
| 1 read | `get_edit` | The current edit recipe and history |
| 2 preview | `render_preview` | A reduced preview, only for selected photos and only with consent |
| 2 preview | `compare` | Before and after of a proposed recipe |
| 3 propose | `propose_edit` | Submit a recipe; Kestrel shows it and waits for approval |
| 3 propose | `propose_ratings` | Suggest Keep, Reject, stars and tags for a set |
| 3 apply | `apply_approved` | Applies only what the person approved, as one undoable step |

Every call is logged locally in a visible activity list, so the person can see what the assistant asked for.

## Cloud API (later, for subscribers)
The same tool definitions are exposed by the cloud API (OAuth-style tokens scoped to an account and to read, propose or apply), so a web assistant can work on synced recipes and previews. Server-side enforcement is independent of the app (`commercialAccess.ts` is only the UI's view).

## Owner direction — one engine API, device and cloud alike (22 Nov 2026)

The frontend should not know or care whether an engine runs on-device or online: it calls one API per
capability (RAW develop, scene/vision read, subject/species ID, denoise, mask, upscale), and the engine
behind that call can be local (today: `photoCheckStore`/`smolvlmRuntime`, `objectDetector`, `naturalChromaDenoiseLinear`,
`observedMaskProposal`, `upscaleTiles`) or remote (Gemini, BYO AI, a future MCP-exposed tool), without the
caller changing. None of today's engines are actually shaped this way yet — each has its own bespoke
function signature, called directly from providers/components. Treat this as the target shape for new
engine work, not a reason to pause and refactor all six at once.

**BYO AI's role is narrower than "another provider": it is an interpretive/calibration layer over the
device engines**, not an independent source of edits. It reads what the on-device engines already found
(scene facts, subject ROI, mask geometry, measured colour/chroma) and helps interpret or correct it — and,
for consenting test users, its corrections are a signal for tuning the on-device models' own balance over
time. It should not bypass the device engines and reason from a raw photo alone. MCP (today: a standalone
read-only script, `tools/mcp/kestrel-mcp.ts`) should grow toward the same role — an external reviewer/
instructor of what the in-app engines already produced, per the Cloud API table above, not a parallel path.

**Output shape: offer the person a choice, don't pick for them.** Where an engine's suggestion has real
spread (an edit recipe, a Look, a crop), surface the top three ranked candidates rather than committing to
one. Exactly how many candidates and how they're scored (confidence, diversity, or something else) is not
decided — the first slice that does this should say explicitly which it picked and why.

## Open questions
- Which assistant clients to test first (Claude Desktop and Claude Code via MCP).
- Whether `propose_ratings` should be allowed to act on a whole shoot at once, or in batches of ten.
- Limits and pricing for hosted analysis (cost per photo, monthly allowance).
- Exact shape of the "one engine API" above: a shared TypeScript interface per capability? A queued
  request/result pair through `taskStore` so device and cloud calls look identical to the UI? Not decided.
- How "top three candidates" scoring works, and whether it applies to every engine or only some.
