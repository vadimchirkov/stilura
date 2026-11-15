# "Slop in, sentence out": five more shots

Each script is one take in the real app, 15-25 seconds, silent, captions burned in afterwards. Same structure every time so the series is recognizable:

1. **0-2 s** slop paragraph already on screen, caption names the source ("A corporate blog post").
2. **2-8 s** select, `⌘K`, type the request, Enter.
3. **8-14 s** preview appears, `↓` once or twice to show options, `Tab`.
4. **14-20 s** one more small move (a `/` line, an `Esc` on a ghost suggestion, or typing a word by hand).
5. **last 2 s** hold on the finished text. Caption: `npx stilura`.

## Recording rules

- **Record for vertical.** Make the editor window about 860 px wide so the column narrows to 52 characters, as in `stilura-9x16.mp4`. Lines then wrap short and the text can fill a 1080 px wide frame.
- **Use real model output.** The README demo is a scripted animation of the editor (`artifact/demo.html`, rendered by `scripts/render-demo.mjs`) with fixed text. These shots should not be: record the live model and keep whatever it gives you, even if it takes two tries. If the result is bad, that's a take you don't post, not a result you script. Say in the post which model you used.
- Paste the slop text below as the starting draft. It is written by us as a typical example; it does not quote any real person or company.
- Leave 0.5 s before each `Tab` so viewers can read the preview.
- Light theme, no notifications, no other windows.
- The current cutdowns come from `node docs/marketing/video/render-narrow.mjs 9x16` (and `4x5`), then `python3 docs/marketing/video/build-cutdowns.py`. For a screen recording, point `build()` at your file and edit the skeleton windows and beats at the top.

## 1. Corporate blog post

Caption at 0 s: **A corporate blog post**

Starting draft:

```text
In an ever-evolving digital landscape, our team is thrilled to announce a groundbreaking partnership that underscores our unwavering commitment to innovation, empowering customers to unlock new possibilities.
```

Actions: select all, `⌘K`, type `what actually happened? one sentence`. Show 2 options with `↓`, `Tab` the plainest one. Then select the company-name placeholder in the result and type the real name yourself.

Beat captions: "A corporate blog post" / "⌘K: what happened?" / "pick one" / "names are yours to type" / "npx stilura"

Note: the model can't know the partner's name, so the plain version will be vague. That is the point of the last beat: you add the fact.

## 2. Cover letter

Caption at 0 s: **A cover letter**

Starting draft:

```text
I am writing to express my deep passion for this exciting opportunity. As a highly motivated, results-driven professional, I thrive in fast-paced environments and am eager to leverage my skills to drive impactful outcomes.
```

Actions: select the second sentence only, `⌘K`, `cut the adjectives. keep it about me`. `↓` through options, `Tab`. Then on a new line type `/one sentence about the bug tracker I rebuilt at my last job` + Enter, `R` once, `Tab`.

Beat captions: "A cover letter" / "⌘K: cut the adjectives" / "pick a version" / "/ adds a real detail" / "npx stilura"

Note: the `/` request includes the concrete fact in the prompt. Don't let the video suggest the model invents your experience.

## 3. README intro

Caption at 0 s: **A README intro**

Starting draft:

```text
## Introduction

Welcome to FlowSync! FlowSync is a powerful, seamless, and robust solution designed to revolutionize the way you manage your workflows. Whether you're a developer, a team lead, or an enterprise, FlowSync has you covered.
```

Actions: select the paragraph, `⌘K`, `say what it does in one line`. `Tab`. Pause until a ghost continuation appears, press `Esc`, and type the install command yourself: `npm install flowsync`.

Beat captions: "A README intro" / "⌘K: one line" / "keep it" / "Esc: no thanks" / "npx stilura"

## 4. Product description

Caption at 0 s: **A product description**

Starting draft:

```text
Elevate your morning ritual with our artisanal ceramic mug, meticulously crafted to deliver an unparalleled coffee experience. Its timeless design seamlessly blends form and function.
```

Actions: select all, `⌘K`, `what is it, how big, what's it made of`. Show 3 options with `↓ ↓`, `Tab`. Then select one word and `⌘K` `synonyms` to show the question mode, `Esc` without changing it.

Beat captions: "A product description" / "⌘K: just the facts" / "pick one" / "or just ask" / "npx stilura"

Note: put the real size (e.g. "350 ml, stoneware") in the draft before recording so the model has facts to use. `style.md` tells it not to invent numbers.

## 5. Email to a colleague

Caption at 0 s: **An email**

Starting draft:

```text
Hi Sam,

I hope this email finds you well! I just wanted to circle back and touch base regarding the Q3 roadmap. It's important to note that we should align on priorities moving forward. Let me know your thoughts!
```

Actions: select from "I hope" to the end, `⌘K`, `say it like a person. one question`. `Tab`. Then type `Thanks,` and your name.

Beat captions: "An email" / "⌘K: like a person" / "keep it" / "sign it yourself" / "npx stilura"

## Captions to post with each video

Keep it to one line plus the link. Examples:

- "Corporate blog post in, one sentence out. Local Markdown editor, open source: github.com/vadimchirkov/stilura"
- "Cover letter slop, fixed in place with ⌘K. You pick the version. github.com/vadimchirkov/stilura"

Don't add claims to the caption that the video doesn't show.
