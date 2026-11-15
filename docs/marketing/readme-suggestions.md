# README and repo page: proposed changes

Proposals only, except §6's description and two of §7's topic changes: on 2026-11-15 the description was set to the proposed one, `ai-text-humanizer` and `ai-writing-detection` were removed and `markdown-editor` was added (approved by Vadim). The social preview upload and everything else here are still open. GitHub is the landing page for every post, so these are about the first screen. docs/readme-brief.md §9 says the page has one action, `npx stilura`, with the desktop download second. Every change below keeps that order; the star line sits at the bottom, not next to the command.

## 1. One-line hook above the GIF

Current line under the title:

> A local writing editor with AI continuations, answers and rewrites beside your text. Preview new wording, then accept it into your draft.

Proposed (pick one):

- **A.** `A local Markdown editor where AI edits the text you select, and nothing lands until you press Tab.`
- **B.** `AI rewrites inside your Markdown file, on the words you select. You pick the version, or keep yours.`

Keep the existing second sentence if you want the "preview, then accept" detail, but the first line should say what changes for the reader before the GIF plays. Both options avoid claims the brief rules out (no quality or detector claims).

## 2. "Who it's for" line, right under the GIF

```markdown
For people who write posts, docs and newsletters with AI nearby and want help with a sentence, not a rewrite of the whole draft.
```

This matches the brief's reader (§1) and its "Not for: people who want AI to write the text for them."

## 3. Keep `npx stilura` as the first thing after that

No change to the "Run" section. It already leads with the command.

## 4. Star line, at the end of the README (above License)

```markdown
If Stilura is useful to you, a star helps other writers find it. Bugs and ideas go in [Issues](https://github.com/vadimchirkov/stilura/issues).
```

Not near the top: the brief's one action is running it.

## 5. Link to the slop bingo

In the "Settings and files" section, after the `style.md` sentence:

```markdown
The default `style.md` lists common AI-writing patterns. As a printable cheat sheet: [AI slop bingo](docs/marketing/assets/slop-bingo.png).
```

Only after `docs/marketing/` is merged to `main`; otherwise the link 404s on GitHub.

## 6. GitHub "About" fields

| Field | Now (read 2026-11-15 via the GitHub API) | Proposed |
|---|---|---|
| Description | "Local vibe writer that writes with you." | "AI-assisted text editor that writes with you." |
| Website | https://www.npmjs.com/package/stilura | keep, or point to the Releases page if most visitors want the desktop app |
| Social preview | not visible through the public API; check Settings | upload `docs/marketing/assets/og-image.png` (1280x640) in Settings → Social preview |

"Writes with you" conflicts with the brief's "Not for: people who want AI to write the text for them."

## 7. Repo topics

Current topics include two that contradict the do-not-claim list:

- `ai-text-humanizer`: implies making AI text pass as human. Remove.
- `ai-writing-detection`: Stilura is not a detector (brief §7). Remove.

Proposed full list (GitHub allows 20):

```
markdown-editor, writing, writing-tool, writing-assistant, ai-writing, llm-tools,
local-first, codemirror, tauri, desktop-app, chatgpt, claude-code, style-guide,
markdown, open-source, ai-slop
```

Keep `ai-slop` only if you're comfortable being found by people searching that phrase; it matches the demo.

## 8. Brief housekeeping (not README)

docs/readme-brief.md §4 and §8 still describe highlighting generic phrases with named patterns and a "signal count". The 0.7.0 changelog removed the Review API and style scoring. Update the brief before the next README pass so nobody writes copy from the old feature list.

## Check against docs/readme-brief.md

- One action stays `npx stilura`, desktop second: yes (sections 3, 4).
- No accuracy, time-saved, "less AI-like" or detector claims: yes; two topics that implied them are flagged for removal.
- Starts from the reader's problem: the hook (1) and "who it's for" (2) do; the GIF shows the problem being fixed.
