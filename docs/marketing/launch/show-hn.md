# Show HN

When: Tuesday or Wednesday, 9:00 AM PT, on a day you can stay in the thread for six hours (channels.md). Don't ask anyone to upvote.

## Title (≤80 characters)

```
Show HN: Stilura – local Markdown editor with in-place AI rewrites
```

URL field: `https://github.com/vadimchirkov/stilura`

The README opens with docs/demo.gif, so that's the first thing people see. No landing page.

## First comment

```
Hi HN, I'm Vadim. Stilura is a Markdown editor that runs on your machine,
either `npx stilura` or a desktop build from the Releases page. The AI works
inside the text, not in a chat panel next to it.

You select a sentence, hit Cmd/Ctrl+K and say what you want. The options show
up where the sentence was. Arrow keys flip between them, Tab keeps one, Esc
keeps yours. Typing /something at the end of a line and pressing Enter writes
there instead, and R asks for another take. If you stop typing for a moment
you get a gray continuation, which you can take or ignore.

None of that touches draft.md until you accept it. The draft is a plain
Markdown file in the folder you ran it from. Next to it sits a style.md with
voice rules; the default one is a list of AI-writing tells adapted from
Wikipedia's "Signs of AI writing" page. Edit it while the app is open and
the next request uses it.

Models: ChatGPT Plus/Pro sign-in, or Claude Code on a Pro/Max plan through
the ACP adapter. API keys work too. I wanted to use the plans I already pay
for.

What it doesn't do. It doesn't run models locally, so when you ask for a
rewrite your text goes to the provider you picked. It isn't an AI detector
and gives no score. I haven't measured output quality at all, and the GIF is
a scripted animation of the UI, not a screen recording. The Chrome extension
in the repo is load-unpacked only.

Node HTTP server, CodeMirror 6, Tauri for desktop. Spelling and grammar run
offline through Harper compiled to WASM (about 20 MB, cached), which replaced
Hunspell in 0.7.2. There's a small localhost API so Claude Code can read and
edit the open draft. MIT. First commit was September 1, under the name Litura.

Mostly I want to hear where the inline flow gets in your way.
```

## Prepared answers (write them fresh when asked)

- **"Local but no local models?"** Right. ChatGPT sign-in, Claude Code or API keys today. Don't promise a date.
- **"Why not Cursor / Copilot in a .md file?"** The writing actions are built for prose: options you flip through, `/` requests, `style.md`, nothing saved until Tab. Don't knock the other tools.
- **"Does it make text undetectable?"** No, and it isn't built for that.
- **"Why not an Obsidian plugin?"** Your real reason.
- **"Privacy?"** Editor and file are local; model requests go to the provider you chose. Browser storage keeps a recovery copy.
