# r/SideProject

> **Before posting:** HN, DEV and several subreddits remove AI-written posts. This draft was reworked to sound less generated, which lowers the risk but doesn't remove it. Reword it yourself before you post.

No sub-specific promo rule; the sub is for sharing projects. Reddit's ~10% guideline applies. Lead with the GIF; people here like build details.

## Title

```
Stilura: my Markdown editor's demo is it cleaning AI slop out of its own pitch
```

## Body (attach docs/demo.gif as the post image, or link it)

```
The demo opens on a paragraph I wrote to sound as much like ChatGPT as I
could: "In today's fast-paced AI landscape, Stilura serves as a
groundbreaking testament to seamless writing—delving into your workflow."

Select it, Cmd+K, "kill the AI slop. say what it actually is.", Tab. Then one
more Cmd+K on the end of the sentence ("sharper"), down arrow twice, Tab. It
ends as "Stilura is a local Markdown editor where you keep the last word."

The GIF is scripted, so that wording is fixed. In the app the model writes
the options and you'll get different ones.

It runs on your machine: `npx stilura`, or desktop builds for Mac, Windows
and Linux. The AI works on the text you select or on a /request at the end
of a line, and if you pause it offers gray text. Nothing saves until Tab. It
uses your ChatGPT Plus/Pro sign-in or Claude Code on Pro/Max, or an API key.
You don't make an account with me.

Build notes, since people here usually ask:
- Node server and CodeMirror 6 in the browser, Tauri for the desktop app.
  Grammar runs offline with Harper compiled to WASM, ~20 MB, cached after
  the first load.
- First commit 2026-09-01 as "Litura", renamed to Stilura on 2026-10-11,
  0.7.3 now. Solo, MIT.

Is the inline flow obvious from the GIF alone, or does it need a sentence
before it?

https://github.com/vadimchirkov/stilura
```
