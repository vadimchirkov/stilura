# Messaging kit

> **Before posting anything built from this file:** HN, DEV and several subreddits remove AI-written posts. The hooks were reworked to sound less generated, which lowers the risk but doesn't remove it. Reword them yourself.

Source of truth for every post. If a line here and a post disagree, fix the post. Every claim below points at the file that backs it.

## One-liner (≤12 words)

A local Markdown editor where AI suggests and you decide.

(10 words. Backed by README "Write" section: previews stay outside the draft until `Tab`.)

## Taglines

1. Slop in, sentence out.
2. AI edits the sentence you select. You keep the last word.
3. Write with the ChatGPT or Claude plan you already pay for.

## 30-word description

Stilura is a local Markdown editor with AI inside the text. Select a sentence, press ⌘K, ask for a change, and pick from options. Nothing lands until you press Tab.

(30 words.)

## 80-word description

Stilura is an open-source Markdown editor that runs on your machine with `npx stilura`. The AI works inside your text: pause and a continuation appears, select a passage and press ⌘K to ask for a rewrite, or type `/` and a request at the end of a line. Every result is a preview, and nothing enters `draft.md` until you press Tab. A `style.md` file holds your voice rules. It works with ChatGPT Plus/Pro, Claude Pro/Max, or an API key.

(80 words.)

## Hook lines for short video (first 1-2 seconds, on screen)

1. This is my app's test paragraph. It's slop on purpose.
2. "Serves as a groundbreaking testament." Not in my launch post.
3. Select, ⌘K, say what you want, Tab. It lands in the file, not in a chat.
4. It gives me a few versions. I take one or keep mine.
5. Two ⌘K requests. Slop in, one plain line out.

## FAQ (from docs/readme-brief.md §7, checked against README)

**Does my text leave my machine?**
The editor runs locally and saves to `draft.md` in your folder. When you ask for a continuation or rewrite, that request goes to the model provider you picked. Nothing else is sent.

**Do I need an API key?**
You need some model. Sign in with ChatGPT Plus or Pro, use Claude Code with a Pro or Max plan, or add an API key in Settings.

**Will it rewrite my voice?**
Only the text you select, and only if you accept a preview. `style.md` in your writing folder lists what the model should keep and avoid; edit it and the change applies without a restart.

**Is it an AI detector?**
No. It gives no score and makes no judgment about who wrote a text.

**Is it free?**
The editor is MIT-licensed. Model requests count against whichever plan or API key you connect.

**What platforms?**
`npx stilura` needs Node.js 20+. Desktop builds for macOS, Windows and Linux are on the Releases page. A Chrome extension is in the repo (load unpacked) for text fields on other sites.

## Facts we can state (with source)

| Claim | Source |
|---|---|
| Runs with `npx stilura`, Node 20+, opens on localhost | README "Run" |
| Desktop builds for macOS, Windows, Linux | README "Run" |
| Continue (pause, ghost text, Tab), Change (⌘K, ↑/↓ options), Generate (`/request` + Enter), `R` regenerates, `Esc` dismisses | README "Write" |
| Unaccepted previews stay out of the saved draft | README "Write" |
| Draft is plain `draft.md` in your folder | README "Settings and files" |
| `style.md` sets voice rules, reloads without restart | README "Settings and files" |
| ChatGPT Plus/Pro sign-in; Claude Code Pro/Max; API keys | README "Run", "Claude Code with Pro or Max"; CHANGELOG 0.7.2 |
| Offline grammar check with Harper | CHANGELOG 0.7.2 |
| Focus mode (⌘.), document history, open/create drafts (⌘O) | CHANGELOG 0.7.2, 0.7.3 |
| MCP tools for `/` requests (optional) | README "Optional MCP connections" |
| Local HTTP API for agents such as Claude Code | CLAUDE.md, skills/stilura/SKILL.md, CHANGELOG 0.7.0 |
| MIT license | LICENSE |
| The demo shows the ⌘K / ↓ / `/` / R / Esc flow | docs/demo.gif, artifact/demo.html (scripted, see note below) |

Note on the demo: docs/demo.gif and docs/demo.mp4 are rendered by `scripts/render-demo.mjs` from `artifact/demo.html`, a scripted, frame-by-frame animation that reproduces the editor's look with fixed text (commit ef5683a: "a scripted 28s walkthrough"). It is not a screen recording and no model produced those sentences. Call it "the demo" or "a scripted demo of the flow". Never "watch the AI do this" or "recorded in the app". The five videos in video/scripts.md are where real recordings come in.

## Do-not-claim list

- Accuracy, quality scores, or "better writing" measured in any way. No measurements exist (readme-brief §6).
- Time saved.
- "Undetectable," "passes AI detectors," "less AI-like" scores, or anything about AI detection. It is not a detector.
- "Private" or "nothing leaves your machine." Model requests go to the provider.
- "Free AI." The editor is free; the model is not.
- "Works with any model." Say which: ChatGPT Plus/Pro sign-in, Claude Pro/Max via Claude Code, API keys.
- "Highlights AI patterns" or "names what's wrong." That was the old review feature (readme-brief §4); the Review API was removed in 0.7.0.
- Chrome Web Store availability. The extension is load-unpacked only.
- User counts, testimonials, or press we don't have.

## Our own copy rules

Plain verbs, concrete nouns, one claim per sentence. No "delve," "seamless," "game-changer," "revolutionize," "in today's fast-paced," "testament," "leverage," "unlock," "supercharge," "elevate," "empower," "effortless(ly)," "cutting-edge." One em dash per piece at most. The only place these words appear is inside quoted slop that we are making fun of. Run `docs/marketing/slop-check.sh <file>` before publishing.
