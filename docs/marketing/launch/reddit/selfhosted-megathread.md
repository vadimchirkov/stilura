# r/selfhosted: New Project Megathread only

> **Before posting:** HN, DEV and several subreddits remove AI-written posts. This comment was reworked to sound less generated, which lowers the risk but doesn't remove it. Reword it yourself before you post.

Projects younger than 3 months go only in the current "New Project Megathread" (Stilura's first commit: 2026-09-01, so until 2026-12-01). "Promoted apps must be production ready and have docs." Low priority: Stilura runs on your own machine but is a desktop-style app, not a server you host for others. Post only if the current megathread takes local apps; otherwise skip.

## Comment

```
Stilura, a local Markdown editor with AI rewrites in place.

`npx stilura` serves the editor on localhost, or there's a Tauri desktop
build for macOS/Windows/Linux. Files stay plain Markdown in your folder
(draft.md, style.md). No account, no cloud sync.

Models are ChatGPT Plus/Pro sign-in, Claude Code on Pro/Max, or an API key,
and requests go to whichever you pick. I haven't documented a local-model
setup yet.

MIT. Docs are the README and SPEC.md (HTTP API, storage).
https://github.com/vadimchirkov/stilura
```
