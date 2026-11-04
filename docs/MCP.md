# EasyCut from Claude (MCP server)

People with an EasyCut account can edit videos by talking to their own Claude — claude.ai, the Claude desktop app, or Claude Code. EasyCut does every mechanical step (transcription, silence and filler cuts, captions, B-roll, sound, reframing, rendering). The person's Claude does the creative AI work: it chooses which moments become full-screen animated scenes and writes them, following EasyCut's scene training. That training is the same rules and reference scenes the built-in composer uses, served by the server.

**Why it's cheaper:** a project made this way runs with no model calls on EasyCut's account (`aiMode = "client"`, see `src/lib/llm/server-ai.ts`). The AI part runs on the person's Claude plan. EasyCut's costs for the video are transcription, rendering and storage, a few cents a minute. It still counts against the person's footage minutes, like any video.

## Connecting

The endpoint is `https://<your domain>/api/mcp`. It speaks Streamable HTTP, stateless, with JSON responses. The Settings page shows the exact address and has copy buttons.

| Client | How |
|---|---|
| claude.ai / Claude desktop | Settings → Connectors → *Add custom connector* → paste the address. Claude opens EasyCut's sign-in, the person approves on `/oauth/authorize`, done. |
| Claude Code | Settings → *Make a token*, then run the `claude mcp add --transport http easycut <address> --header "Authorization: Bearer ek_…"` command it shows. |

**Sign-in:**
- When sign-in is on (`CLERK_SECRET_KEY` set), every call needs a token. A request without one gets a `401` with `WWW-Authenticate: Bearer resource_metadata=…`, which is how Claude discovers the OAuth flow:
  - metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`;
  - dynamic client registration at `/api/oauth/register`;
  - PKCE S256 code exchange at `/api/oauth/token`.
- Tokens from either route are listed on the Settings page and can be disconnected there. Only their SHA-256 is stored.
- When sign-in is off, the server is open, like the rest of the app.

## Tools

| Tool | What it does |
|---|---|
| `list_styles` | Edit styles, the 25 scene looks, caption looks |
| `list_projects` | The account's recent projects |
| `create_project` | From a public `video_url` (Google Drive and Dropbox share links work), or returns upload instructions. Always `aiMode: client`. |
| `start_edit` | Starts the pipeline after a separate upload |
| `get_project` | Status, progress, scene slots with the line spoken over each, the video link |
| `get_transcript` | Captions with times in the edited video |
| `set_scenes` | Chooses which moments become animated scenes |
| `get_scene_brief` | The full scene rules + the look's reference scene + timed words for one scene |
| `preview_scene` | Renders 4 frames of Claude's scene and runs every check (audit, real page load, lint, blank test). Returns the frames as an image with the safe area (cyan), the caption band (red) and the like/share corner (dark) drawn on, so Claude can see what the platform and the captions will cover. |
| `submit_scene` | Saves a passing scene for the final render |
| `update_edit` | Caption look, caption fixes, style, layers, music, saved as a new version |
| `render_video` | Renders submitted scenes to clips (worker job `client-scenes`), lays them in, renders the video |

**Prompts:** `edit_video` (the whole flow) and `write_scene` (the rules for one line and look).

**Resources:**
- `easycut://guide/scene-design`, the scene-design skill;
- `easycut://looks/<look>`, each look's style guide and reference scene.

## Files

| Path | What |
|---|---|
| `src/app/api/mcp/route.ts` | HTTP endpoint, auth |
| `src/lib/mcp/server.ts` | JSON-RPC dispatcher, tool / prompt / resource definitions |
| `src/lib/mcp/service.ts` | What each tool does, with the ownership checks |
| `src/lib/mcp/tokens.ts`, `oauth.ts` | Access tokens and the OAuth server |
| `src/worker/client-scenes.ts` | Renders Claude's scenes and the final video |
| `src/components/claude/ClaudePanel.tsx` | The Settings panel |
| `tests/mcp.test.ts` | Token, OAuth, protocol, SSRF and switch tests |
