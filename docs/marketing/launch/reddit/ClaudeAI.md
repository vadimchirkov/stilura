# r/ClaudeAI

Rule 7 (showcase) requires: built with Claude/Claude Code or for Claude by you, a clear description of what was built and **how Claude helped**, "free to try and say so", minimal promo language, no referral links. Feed posts need total karma ≥ 50; below that, post in the Project Showcase hub thread instead. Use the showcase flair.

Counts below come from `git log` on the `harper-and-app-split` branch (96 commits, 2026-09-01 to 2026-11-15): 48 carry a `Co-Authored-By: Claude …` trailer (Opus 5.5: 32, Opus 5: 7, Opus 4.6: 6, Sonnet 5.5: 3). `main` alone has 72 commits, 26 with the trailer (the November work is on this branch), so if you post before merging, either link the branch or change the numbers to match `main`. Re-count on posting day: `git log --format=%B | grep -ci 'co-authored-by:.*claude'`.

## Title

```
I built a Markdown editor with Claude Code that can also use a Claude Pro or Max plan for in-place rewrites (free, MIT)
```

## Body

```
I built Stilura, a local Markdown editor where the model edits the text you
select, in place. Exactly half of its 96 commits have a Claude co-author
trailer, so this seemed like the right sub.

What Claude did, going by those commits:
- Early September (Opus 5): saving drafts to disk with every rewrite behind
  an explicit ask, packaging it for npm, and cutting releases by tag with an
  opt-in update check.
- October (Opus 5.5, Opus 4.6, Sonnet 5.5): the desktop release pipeline
  (Intel Mac build, signing secrets, a fix for a desktop crash on macOS), the
  rename from Litura to Stilura including carrying the old desktop state
  over, margin notes, and two README rewrites.
- November 11-15 (Opus 5.5): offline spelling and grammar with Harper,
  making ChatGPT sign-in the default, merging two settings tabs, a focus
  mode, and splitting up app.js: eight commits that each move one piece
  out of it, plus a test change so a missing section marker fails loudly. It also built the scripted demo in the README.

The other 48 commits have no trailer, including the one that added Claude
Code support.

The Claude part of the product goes both ways. In Settings → Model you can
pick "Claude Code · Pro/Max": Stilura talks to your local Claude Code through
the ACP adapter (@agentclientprotocol/claude-agent-acp), so rewrites, /
generation and Cmd/Ctrl+Enter continuations run on the plan you already have.
Those are text-only sessions with no tools. The other way round, Stilura has
a small localhost API and ships a skill (skills/stilura/SKILL.md), so Claude
Code can read and edit whatever draft is open in the editor.

In the editor: select text, Cmd/Ctrl+K, ask for a change, arrow through the
options, Tab to keep one. A /request at the end of a line writes there. Your
draft.md doesn't change until you accept something.

Free to try: `npx stilura` (Node 20+), or desktop builds for macOS, Windows
and Linux. MIT. It's not an AI detector.

Repo with a short demo GIF: https://github.com/vadimchirkov/stilura
Setup for the Claude part is in the README under "Claude Code with Pro or
Max". If the ACP adapter step confuses you, tell me where.
```
