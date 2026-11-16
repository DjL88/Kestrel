# Kestrel for Claude and other AI assistants (MCP)

A small program, run on your own computer by the assistant app, that lets an assistant such as Claude look at your Kestrel projects and **suggest** changes. It is off until you set it up, it reads only the project files in a sync folder you choose, and it never changes a project or touches a photograph.

## What it can see
Only what Kestrel writes into a sync folder when you use **Sync folder or cloud**: each project's photo names, your decisions (keep, reject, to review), ratings, tags and edit settings. **No pixels and no original files.** To let it see a project, send that project to the folder.

## Set up (Claude Desktop)
1. In Kestrel, open a project, **Sync folder or cloud** and **Send this project to a folder**, choosing a folder on this computer (for example `~/Kestrel Sync`).
2. In Claude Desktop, open Settings, Developer, Edit config, and add:
```json
{
  "mcpServers": {
    "kestrel": {
      "command": "npx",
      "args": ["tsx", "/path/to/kestrel/tools/mcp/kestrel-mcp.ts", "/Users/you/Kestrel Sync"]
    }
  }
}
```
3. Restart Claude Desktop. Ask, for example: "Which of my kite photos are kept but unrated?" or "Suggest ratings for the keepers in Kite day."

(For now this runs from the Kestrel source folder with Node installed. Bundling it inside the desktop app is a later step.)

## Tools
| Tool | What it does |
| --- | --- |
| `list_projects` | The projects in the folder with kept, rejected and to-review counts |
| `get_project` | One project's title, save time and counts |
| `find_photos` | Photos by decision, minimum rating, tag, or whether they are edited (paged) |
| `get_edit` | The saved edit settings for one photo |
| `propose_changes` | **Only with `--allow-proposals`.** Saves suggested decisions, ratings or tags, each with a reason, as a file in `kestrel/v1/proposals/<project>/` |

## Safety
- **Read-only by default.** Proposals are a separate switch (add `"--allow-proposals"` to `args`).
- **Proposals are suggestions, not changes.** They go in their own folder; the project file is never edited. Kestrel does not yet show or apply proposals: that review screen is the next step, and nothing is applied without you.
- Project names are checked, so an assistant cannot read outside the Kestrel folder. Each suggestion must name a real photo, be a whole-number rating from 0 to 5, and give a reason.
- No network access, no photographs, no other files.
- A cloud assistant that uploads what it reads sends it to that provider. Only send a project you are happy for the assistant's provider to see.
