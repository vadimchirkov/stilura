# Outreach list

15 targets, researched 2026-11-15 from public pages only. Contact routes are the ones each target publishes (submission forms, issue templates, generic hello@ addresses on their own site). No personal emails. Every URL below was opened and returned a live page.

Send in batches (calendar.md): awesome-list PRs first because they last, newsletters after the Show HN day, people last and only with something to show (a star count, a good thread). Don't send the same text twice; each message names something specific about the target. Rewrite in your own words before sending.

## Awesome lists (PRs and issue forms)

### 1. mundimark/awesome-markdown-editors
- URL: https://github.com/mundimark/awesome-markdown-editors (2.3k stars, "Contributions welcome. Anything missing? Send in a pull request.")
- Why: the main list of Markdown editors, with a "Markdown Desktop Editors › Universal" section for cross-platform apps. Stilura has macOS/Windows/Linux builds.
- Ask: PR adding Stilura to "Markdown Desktop Editors › Universal", in the section's format (bold name link, price in parentheses, one-line description).
- PR text:
  > Adds Stilura to Desktop Editors › Universal, next to entries like Caret and Deepdwn. It's a free (MIT) Markdown editor for macOS, Windows and Linux, also runnable with `npx stilura`, with AI rewrites on a selection that only land in the file when accepted. Happy to change the wording or the section if another fits better.

### 2. yowainwright/awesome-writing-tools
- URL: https://github.com/yowainwright/awesome-writing-tools (167 stars, updated 2026-11-06)
- Why: one alphabetical list of tools "for improving written communication"; it already includes write-good, Alex.js and an AI book editor (Chisel), so AI writing tools are in scope.
- Ask: PR adding one alphabetical entry: `**[Stilura](https://github.com/vadimchirkov/stilura):** Local Markdown editor with AI rewrites on the selected text; a style.md file holds the rules for what to avoid.`
- PR text:
  > Adds Stilura between the existing entries in alphabetical order. Like write-good, it targets wordy, generic phrasing, but as an editor: you select a sentence, ask for a rewrite, and choose from options. MIT licensed.

### 3. tehtbl/awesome-note-taking
- URL: https://github.com/tehtbl/awesome-note-taking (1k stars)
- Why: has an "Open Source › Tauri" section with plain-Markdown apps (Stik, Inkwell) and a strict entry format: icons, description ending with a period, `LICENSE` and `Tech/Language` tags.
- Ask: PR to the Tauri section: `- 📖 [Stilura](https://github.com/vadimchirkov/stilura) - Markdown editor with AI rewrites on selected text; drafts stay plain .md files. `MIT` `Tauri/JavaScript``. Check the legend for the right platform icons first.
- PR text:
  > Adds Stilura to Open Source › Tauri. It stores drafts as plain Markdown files in your folder (📖), MIT, Tauri shell with a Node.js server. I followed the entry format in contributing.md; tell me if the icons need changing.

### 4. hesreallyhim/awesome-claude-code
- URL: https://github.com/hesreallyhim/awesome-claude-code (58k stars). Submit only via the issue form: https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml
- Why: the rules require 14+ days since first commit with ongoing development (Stilura: first commit 2026-09-01, 96 commits) or 100 stars, and they "especially welcome" resources built around Claude Code's own features. Stilura ships a skill (`skills/stilura/SKILL.md`) and a localhost API so Claude Code can read and edit the open draft, and it can use a Claude Pro/Max plan through Claude Code.
- Ask: fill the recommendation form (web UI only; the maintainer restricts people who submit any other way).
- Form text:
  > Stilura is a local Markdown editor with a Claude Code skill (skills/stilura/SKILL.md) and HTTP API so Claude Code can read and edit the draft open in the editor, under a revision guard. The editor itself can run rewrites on a Claude Pro/Max plan through Claude Code's ACP adapter. Useful when you write docs or posts next to a Claude Code session.

### 5. ComposioHQ/awesome-claude-skills
- URL: https://github.com/ComposioHQ/awesome-claude-skills (79k stars)
- Why: has a "Communication & Writing" section of skills; CONTRIBUTING.md asks for skills based on "a real use case" with practical examples.
- Ask: PR adding the Stilura skill to "Communication & Writing", after checking that SKILL.md has a worked example (add one to the skill first if not).
- PR text:
  > Adds the Stilura skill to Communication & Writing, near Content Research Writer. It lets Claude Code read and edit a draft that's open in the Stilura editor through a localhost API, following the voice rules in the folder's style.md. Real use: I edit README drafts with Claude Code while the file is open in the editor.

### 6. ikaijua/Awesome-AITools
- URL: https://github.com/ikaijua/Awesome-AITools (6.3k stars, updated daily)
- Why: has a "Writing" table (Notion AI, Obsidian, DeepL Write) with a "Fees" column; an open-source local editor is missing.
- Ask: PR adding a row: `| Stilura | Local Markdown editor with AI rewrites on selected text; uses your ChatGPT/Claude plan or API key | [URL](https://github.com/vadimchirkov/stilura) | Free, open source (MIT); model costs via your own plan or key |`
- PR text:
  > Adds a row to the Writing table. Stilura is an MIT-licensed Markdown editor that sits next to the Obsidian entry in spirit: local files, AI help inline. I filled the Fees column the way the other rows do.

(Later, not now: sindresorhus/awesome-chatgpt has an "Apps" section but requires 20+ stars for GitHub projects. Revisit once the repo passes 20.)

## Newsletters and editorial sites

### 7. Console.dev
- URL: https://console.dev/selection-criteria
- Why: features 2-3 developer tools a week, prefers pre-1.0 releases (Stilura is 0.7.3), self-service, actively maintained, good docs. Submissions: "Email hello@console.dev with the details."
- Ask: consider Stilura for a weekly issue.
- Email to hello@console.dev:
  > Stilura is a pre-1.0 (0.7.3), MIT-licensed Markdown editor for developers who write READMEs and posts: `npx stilura`, no signup, AI rewrites on a selection that only land when you press Tab. It also exposes a localhost API so Claude Code can edit the open draft. Repo with a 28-second demo: https://github.com/vadimchirkov/stilura

### 8. Changelog News
- URL: https://changelog.com/news/submit (needs a Changelog sign-in; it asks for URL, title, and "What's interesting about it?")
- Why: "if your fellow devs will find it interesting, submit it"; your own work is welcome; commercial products are not, and Stilura is free.
- Ask: submit the repo link.
- "What's interesting about it?":
  > A Markdown editor where the AI only edits the text you select and nothing reaches the file until you press Tab. It reuses a ChatGPT Plus or Claude Max plan instead of an API bill, runs Harper grammar checks offline in WASM, and the default style.md is a list of AI-writing tells adapted from Wikipedia's "Signs of AI writing".

### 9. Node Weekly (Cooperpress)
- URL: https://nodeweekly.com/ (publisher contact: https://cooperpress.com/contact)
- Why: weekly Node.js links; Stilura is a Node 20+ app started with `npx`, with a plain `node:http` server and a Chrome DevTools-protocol render script for its demo.
- Ask: consider it for the tools section. The site doesn't publish a submission address, so use the Cooperpress contact page or reply to an issue.
- Message:
  > Stilura is an MIT Node.js app you start with `npx stilura`: a local Markdown editor (CodeMirror 6, Tauri desktop shell) with AI rewrites on a selection. Possibly of interest for Node Weekly's tools links. https://github.com/vadimchirkov/stilura

### 10. Dense Discovery (Kai Brach)
- URL: https://www.densediscovery.com/ (contact: hello@densediscovery.com, linked in the site footer)
- Why: weekly, "human-curated, never automated", with a "Tools" section of "apps and sites for better work and play". Its readers care about thoughtful tech, which fits the anti-slop angle.
- Ask: consider Stilura for the Tools section.
- Email:
  > Dense Discovery's "human-curated, never automated" line is why I'm writing: Stilura is a small open-source writing app built so the AI can't rewrite your text unless you pick the change. It runs on your computer, keeps the draft as a plain Markdown file, and its default style rules are a list of chatbot tells. If it fits the Tools section someday: https://github.com/vadimchirkov/stilura

### 11. Ness Labs (Anne-Laure Le Cunff)
- URL: https://nesslabs.com/topic/tools (contact: https://nesslabs.com/contact)
- Why: publishes interviews with makers of tools for thought, including AI writing tools ("Evidence-grounded AI writing with Jim Lau, founder of Flowing"). These may be paid "featured tool" placements; ask before assuming they're editorial.
- Ask: whether Stilura could be considered for a tools interview, and whether those are sponsored.
- Message:
  > I read the Flowing interview on Ness Labs and wanted to ask how tools are chosen for those conversations. I make Stilura, an open-source Markdown editor where AI suggests changes to the sentence you select and you decide what stays; the idea is to keep the writer's own thinking in the draft. If those features are sponsored, no problem, I'd just like to know.

## People who review writing and dev tools

### 12. Nicole van der Hoeven (YouTube)
- URL: https://www.youtube.com/@nicolevdh ("I talk about learning in public, taking notes, and making cool stuff")
- Why: Markdown-first note-taking videos (Obsidian, plain .md files), developer advocate; her audience writes in Markdown.
- Ask: nothing beyond a look. Mention it only in a reply to a relevant video or post of hers, not a cold DM.
- Message (public reply):
  > Your point about notes only needing to be useful to you, not organized, is how I ended up building Stilura: a plain-Markdown editor where AI can suggest a rewrite of one sentence and nothing changes unless you accept it. If you ever compare writing setups, I'd be glad to hear what breaks for you: https://github.com/vadimchirkov/stilura

### 13. Simon Willison (blog)
- URL: https://simonwillison.net/ (he writes often about Claude Code and LLM tools)
- Why: his readers are the HN/dev audience, and he writes about tools that wire LLMs into existing workflows (his own `llm` CLI).
- Ask: only if he's written about AI writing tools that week; a short public reply with the link, no follow-up.
- Message:
  > Related to your notes on Claude Code: I built a Markdown editor that calls Claude Code over ACP for sentence-level rewrites, text-only with no tools, so a Max plan covers the writing too. The default style rules are adapted from Wikipedia's "Signs of AI writing". https://github.com/vadimchirkov/stilura

### 14. Hacker News readers who asked for this
- URL: https://news.ycombinator.com/item?id=48675435 (OpenKnowledge Show HN, 381 points)
- Why: commenters there asked for local, Markdown-first, AI-integrated editors on Windows/Linux, not only macOS. Reply only where someone asked a question Stilura answers, after your own Show HN.
- Ask: none; answer the question.
- Message (reply to a specific comment):
  > If you need Windows or Linux: Stilura is an MIT Markdown editor with builds for all three, AI rewrites on a selection, and plain .md files. (I made it.) https://github.com/vadimchirkov/stilura

### 15. DEV community: the #writing tag
- URL: https://dev.to/t/writing
- Why: people there write posts about writing better technical prose; a comment that answers their question is welcome, a link drop isn't.
- Ask: none; after the dev.to article (Day 8) is up, reply to two or three recent #writing posts where a style.md-style checklist would help, link only if asked.
- Message:
  > I keep a style.md of phrases I want out of my drafts ("serves as", "it's important to note", lists of three). It helps to make the checklist something your editor reads, not something you remember.
