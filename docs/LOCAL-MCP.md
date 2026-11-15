# Kestrel → Claude Desktop (local, read-only MCP)

This is a **working local integration**, not the planned cloud/hosted AI subscription. No server, account, paid API, customer database, photo upload or Kestrel-managed service is required. It deliberately does **not** control the live Kestrel window or make edits.

## Get started (macOS and Windows)

1. In Kestrel choose a project, then **Back up project**. Save its `.kestrel.json` file in a private folder you control. This contains photo filenames, camera metadata, flags, tags and edit recipes—but **not the original pixels**. The file is a snapshot: to share later edits, export a fresh backup.
2. Install Node.js 22+ if it is not already available. Clone or download the Kestrel source and find `scripts/kestrel-backup-mcp.mjs`.
3. Add a local MCP server to Claude Desktop's MCP configuration, adapting the full paths:

```json
{
  "mcpServers": {
    "kestrel-readonly": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/Kestrel/scripts/kestrel-backup-mcp.mjs",
        "/absolute/path/to/My Project.kestrel.json"
      ]
    }
  }
}
```

On Windows use Windows paths (escaped backslashes in JSON), such as `C:\\Users\\you\\Pictures\\My Project.kestrel.json`. Follow Claude Desktop's current MCP setup documentation to find its configuration screen or file; Kestrel does not automatically change Claude's settings.

4. Restart/reconnect Claude Desktop and ask: **"Using Kestrel, summarise my keepers and camera settings."** The MCP server reads only the *one selected backup file*. Claude may receive the metadata returned by tools; don't use this bridge for private camera details you do not wish to share with the assistant provider.

## Exact tools available

- `get_project_summary`: project title and number of keepers, rejects and unreviewed photos
- `list_photos`: paginated names, ratings, decisions and labels, optionally filtered by decision
- `get_photo_info`: selected photo's camera, lens and exposure settings, rating and tags; excludes GPS, serial numbers and local file paths
- `get_edit_recipe`: selected photo's reversible edit, framing and focus point

There are **no write tools**. The process runs only over **stdio**, does not listen on a port and makes no network request. The selected backup remains unchanged. The server never opens photo files, scans directories, fetches external APIs or shares photo pixels.

The tool exposes data from a Kestrel backup only after explicit user selection. It is not an automatic connection to the running desktop app. If you move/delete the backup, or it becomes unreadable, the server returns a plain error.

## Limits and privacy

- This tool is for **local, single-user testing**; a future integrated MCP bridge would need an app-managed permission UI and per-session approvals.
- Read requests are capped and records validated before use. No full system paths or EXIF GPS information are returned.
- It is intentionally not capable of opening every Kestrel project, sending images, modifying edits, changing ratings or bypassing local paid access.
- Claude or another assistant may retain or process any metadata you ask it to read under **that provider's** terms. Kestrel itself does not send requests to the provider.
- It doesn't grant hosted AI subscription access or use a cloud service.

Run unit/integration tests with `npm test`, including `src/core/mcpBackupBridge.test.ts` (spawns the real MCP process).
