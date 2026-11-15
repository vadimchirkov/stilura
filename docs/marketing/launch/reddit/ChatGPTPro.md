# r/ChatGPTPro

Rule 3: explain what you made, disclose it's yours, stay in the conversation, keep self-promotion under 10% of your activity here. Chrome extension posts must link the full source on GitHub. No selling. Titles: no clickbait, all caps, emoji or URLs. Pick an accurate flair.

Angle: a workflow post for people who already pay for Plus/Pro, not an announcement.

## Title

```
Using my ChatGPT Plus sign-in for rewrites inside a local Markdown editor instead of the chat window
```

## Body

```
Disclosure: I made the tool in this post. It's free and open source (MIT).

I wanted rewrites on the exact words I'd selected, inside the file. So I built
Stilura, a Markdown editor that runs locally (`npx stilura`, or a desktop
app). You sign in with your Plus or Pro account through a device code; on
first run that's the option it opens with. An API key works if you'd rather.

What I do now: select the sentence that reads wrong, Cmd/Ctrl+K, type
"shorter" or "keep the numbers", and flip through the options with the arrow
keys. Tab keeps one. Esc leaves my original alone.

I also type `/one line on X` at the end of a line and hit Enter, and it
writes there. R gets another take. The folder has a style.md with rules the
model has to follow.

Before you try it: automatic continuations send a lot of small requests, and
a ChatGPT plan counts messages, so heavy use eats into your limits. Those
requests carry draft text to OpenAI. The draft itself is a local draft.md.
It's not a detector or a "humanizer" either.

The Chrome extension for text fields on other sites is in the repo, full
source here: https://github.com/vadimchirkov/stilura/tree/main/extension
(load unpacked for now).

Repo and demo GIF: https://github.com/vadimchirkov/stilura

Do people here still do sentence edits in the chat, or have you moved them
into your editor?
```
