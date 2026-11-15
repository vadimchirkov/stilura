# Stilura: analysis and viral launch plan

Status: plan v1, 2026-11-15. Repo `vadimchirkov/stilura` (2 stars), npm `stilura` 0.7.3.

## 1. What the app is

A local Markdown editor (`npx stilura`, or desktop app for macOS/Windows/Linux, plus a browser extension) with AI inside the text, not in a side chat:

- **Continue**: pause typing, ghost text appears, `Tab` accepts.
- **Change**: select text, `Cmd/Ctrl+K`, ask for a rewrite; flip through options with ↑/↓.
- **Generate**: `/request` + Enter at the end of a line writes in place; `R` regenerates.
- Nothing lands in the draft until you accept it. `style.md` holds your voice rules.
- Uses what you already pay for: ChatGPT Plus/Pro sign-in, Claude Code Pro/Max, or any API key. Offline Harper grammar check, focus mode, document history, MCP tools for slash requests, agent API for Claude Code.

## 2. The demo video (docs/demo.mp4, 28s, 1920x1080, silent)

Story: a slop paragraph ("In today's fast-paced AI landscape, Stilura serves as a groundbreaking testament…") is selected, `⌘K` "kill the AI slop", it becomes "Stilura is a local Markdown editor where you keep the last word." Then a `/` request adds a pricing line, `R` regenerates, the author rejects a ghost suggestion with `Esc` and types `npx stilura` themself.

Strong: the hook is the joke everyone already gets (AI slop), the product pitches itself, and the ending makes the brand promise ("you keep the last word").

Weak, fix in cutdowns:
- Text is small mono on beige; on a phone the hook phrase is unreadable.
- Skeleton loading frames eat ~25% of the runtime. Dead air kills retention.
- No caption telling a scroller what they are looking at in the first second.
- The last frame is black (bad thumbnail and bad loop).
- Horizontal only. No 9:16 for TikTok/Reels/Shorts.

## 3. Advantages (what to say, in this order)

1. **AI edits your sentence in place, you choose.** No copy-paste to a chat window.
2. **Anti-slop by design.** Rewrites follow your `style.md`; the demo shows it deleting ChatGPT clichés.
3. **No new subscription.** Your ChatGPT Plus, Claude Pro/Max, or API key.
4. **Local and plain Markdown.** Your file, your folder, one command.
5. Open source (MIT), keyboard-first.

Do not claim: accuracy, time saved, "undetectable", "less AI-like" scores, or AI-detector bypass. No measurements exist (docs/readme-brief.md §6). It is not an AI detector.

## 4. Who uses it

| Segment | Pain | Where they are | Angle |
|---|---|---|---|
| Developers who write (READMEs, blog posts, docs) | Chat tab copy-paste loop, slop in their writing | HN, X dev Twitter, r/programming-adjacent, dev.to, Lobsters | `npx stilura`, local, Markdown, open source |
| Claude Code / ChatGPT power users | Paying for a sub, no good writing UI | r/ClaudeAI, r/ChatGPT, r/ChatGPTPro, X | "Use the Claude Max you already pay for to write" |
| Newsletter writers, bloggers, indie hackers | Want AI help without sounding like AI | X, Indie Hackers, Substack notes | "Kill the slop, keep your voice" |
| PKM / Markdown people | Want AI without leaving Markdown files | r/ObsidianMD, r/Markdown, r/PKMS | Plain `.md` in your folder |
| Local / privacy / self-host crowd | Don't want a SaaS editor | r/LocalLLaMA, r/selfhosted, r/opensource | Local editor, BYO key or model |
| Non-native English writers | Need wording options, not a rewrite of everything | X, Reddit | Pick from options, ↑/↓ |

## 5. The viral idea

**"Slop in, sentence out."** One repeatable format: take a real paragraph of peak AI slop, kill it in Stilura in under 10 seconds, show the before/after. It is funny, everyone has seen the slop, and every post demos the product.

Mechanics that make it spread:
- **Slop Bingo card** (image): "delve", "testament", "fast-paced landscape", "it's important to note", "seamless", em-dash pileups. Shareable on its own; links to Stilura.
- **Challenge**: "Reply with the worst AI paragraph you've seen. I'll clean it live in Stilura." Replies become the next videos.
- **Self-roasting launch post**: the product's own launch copy was de-slopped in the product (true, it is the demo).

## 6. Plan for the implementing agent

All output goes into `docs/marketing/`. **Draft only. Never post, publish, send, sign up, or create accounts.** Publishing is the founder's job; the agent prepares everything so each post is copy-paste ready.

Each step has a check. After a step: run the check, fix what fails, write one line in `docs/marketing/LOG.md` (step, done, what was corrected), then go on.

### Step 1. Messaging kit → `messaging.md`
One-liner (≤12 words), 3 taglines, 30-word and 80-word descriptions, 5 hook lines for short video, FAQ answers from readme-brief §7, the do-not-claim list.
Check: every claim is backed by README/CHANGELOG; nothing from the do-not-claim list; no AI-slop words in our own copy (run the Slop Bingo list against it; Stilura's style rules in `style.md` apply).

### Step 2. Channel research → `channels.md`
Use the browser. For each channel in §4: current self-promotion rules (subreddit sidebar/wiki, HN Show HN guidelines, Product Hunt launch rules), best day/time, what similar launches did (find 3 comparable writing/AI-editor launches on HN/PH/Reddit with their numbers and why they worked or flopped).
Check: every rule has a source URL; any subreddit that bans self-promo is marked "comment-only" or dropped.

### Step 3. Video cutdowns → `video/`
With ffmpeg from `docs/demo.mp4` (do not overwrite it):
- `stilura-9x16.mp4` (1080x1920): crop/scale the text region large, burned-in captions per beat ("AI slop", "⌘K: kill it", "pick a version", "you keep the last word", "npx stilura"), speed up skeleton frames ~3x, no black end frame, loop-clean.
- `stilura-4x5.mp4` (1080x1350) same treatment.
- `stilura-hook-12s.mp4`: only the slop → clean sentence beat.
- `thumb.png`: the before/after frame.
- `scripts.md`: 5 more "Slop in, sentence out" shot scripts (15-25s) the founder can record with the real app, each with a different real-world slop source (corporate blog post, cover letter, README, product description, email).
Check: extract frames (`ffmpeg -vf fps=1`) and look at them; captions readable at phone size, no cropped-off text, duration ≤ target, final frame not black. Use system font available on macOS (e.g. `/System/Library/Fonts/Helvetica.ttc`).

### Step 4. Launch copy → `launch/`
- `show-hn.md`: title (`Show HN: …`, plain, no hype) + first comment (story, what it does, what it doesn't, tech stack, ask for feedback).
- `product-hunt.md`: name, tagline (≤60 chars), description, 5 gallery captions, maker comment.
- `x-thread.md`: 6-8 posts, post 1 = video + hook, last = repo link + challenge.
- `reddit/<subreddit>.md`: one tailored post per allowed subreddit from Step 2, matching each sub's rules and tone.
- `devto-article.md`: "I built an editor that deletes AI slop from my own launch post" (800-1200 words, with the GIF).
Check: each file fits its platform limits (X 280 chars per post, PH tagline 60); each links `https://github.com/vadimchirkov/stilura`; run Step 1's slop check; no two Reddit posts are copies.

### Step 5. Shareable assets → `assets/`
- `slop-bingo.svg` + `.png` (1080x1080): 5x5 grid of real AI-slop phrases, small "cleaned with Stilura · npx stilura" footer.
- `before-after.png` (1200x675): slop paragraph vs the clean line, for X cards.
- `og-image.png` (1280x640) for the GitHub social preview.
Check: open each PNG and look; text legible, nothing cut off, matches the app's beige/mono look.

### Step 6. Repo conversion → `readme-suggestions.md`
GitHub is the landing page. Propose (do not apply) README edits: one-line hook above the GIF, star CTA, "Who it's for" line, link to the slop bingo, repo topics list, GitHub description/website fields.
Check: suggestions respect docs/readme-brief.md (one action: `npx stilura`).

### Step 7. Outreach list → `outreach.md`
Use the browser. 15 targets: newsletters (dev tools, AI tools, writing), YouTubers/X accounts who review writing or dev tools, "awesome-*" lists (awesome-markdown, awesome-writing, etc.) where a PR is welcome. For each: name, public URL, why it fits, the exact ask, and a drafted 3-sentence message. Public info only; no personal emails scraped.
Check: every URL opens; each message mentions something specific about the target.

### Step 8. 14-day calendar and metrics → `calendar.md`
Day-by-day: Day 0 X teaser + bingo, Day 2 Show HN (Tue/Wed ~8am PT), Day 2 X thread, Days 3-7 one subreddit a day, Day 7 Product Hunt (12:01am PT), Day 8 dev.to, Days 8-14 one "Slop in, sentence out" video a day from replies, outreach in batches. Each slot names the exact file to post.
Metrics: GitHub stars, npm weekly downloads (`npm view stilura` / npmjs API), release downloads, HN rank, PH rank, video views and replies. Targets: 300 stars in 14 days, 1k npm downloads.
Check: every file named in the calendar exists; nothing scheduled on a channel marked comment-only.

### Step 9. Final review → `README.md` (index of docs/marketing)
Re-read all files as a skeptical HN reader; fix anything hype-y, false, or slop-like. Index lists every file and what it is for. Log the final pass in LOG.md.
