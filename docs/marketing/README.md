# Stilura launch kit

Drafts and assets for launching Stilura. Nothing here has been posted or sent; the founder publishes everything by hand. Start with `calendar.md`.

Two rules that apply to every post:

1. **Rewrite drafts in your own words.** HN, DEV and several subreddits now remove AI-written posts (see `channels.md`). The drafts have had a pass to sound less generated (first person, repo details, no marketing cadence), which lowers the risk but doesn't remove it. Every draft carries that warning on its first line. Sentences marked `[confirm]` are about your own reasons or habits; keep them only if true.
2. **The README demo is a scripted animation** of the editor (`artifact/demo.html`), not a screen recording. Call it "the demo", never "watch the AI do this". Real recordings come from `video/scripts.md`.

## Files

| File | What it's for |
|---|---|
| `viral-plan.md` | The plan this kit implements (analysis, audience, the "Slop in, sentence out" idea). |
| `LOG.md` | What was made in each step, what each check caught, and how it was fixed. |
| `messaging.md` | Source of truth: one-liner, taglines, 30/80-word descriptions, video hooks, FAQ, claims with sources, the do-not-claim list. |
| `slop-check.sh` | `sh docs/marketing/slop-check.sh FILE...` flags slop words and em-dash pileups in our own copy. Hits inside quoted slop are expected. |
| `channels.md` | Rules for every channel with source URLs, post / megathread-only / comment-only / dropped status, timing data, five comparable launches. |
| `calendar.md` | Day-by-day 14-day schedule naming the file for each slot, a posting-day checklist for Reddit, Day 0 and Day 7 X posts, metrics with commands and baselines. |
| `launch/show-hn.md` | Show HN title and first-comment outline, plus prepared answers. |
| `launch/product-hunt.md` | Name, tagline (57 chars), description (257 chars), gallery order with captions, maker comment. |
| `launch/x-thread.md` | 7-post launch thread (each under 280 chars) ending with the reply challenge. |
| `launch/devto-article.md` | "My editor's test paragraph is AI slop, on purpose": the demo's own before/after, said plainly to be a scripted test paragraph. |
| `launch/reddit/ClaudeAI.md` | r/ClaudeAI showcase post (rule 7), with git-log counts of Claude co-authored commits and what they did; three `[confirm]` spots. |
| `launch/reddit/ChatGPTPro.md` | r/ChatGPTPro workflow post with disclosure. |
| `launch/reddit/SideProject.md` | r/SideProject post built around the demo GIF. |
| `launch/reddit/ChatGPT-megathread.md` | One comment for r/ChatGPT's weekly self-promotion megathread. |
| `launch/reddit/selfhosted-megathread.md` | One comment for r/selfhosted's New Project Megathread (low priority). |
| `video/stilura-9x16.mp4` | 23 s vertical cut (1080x1920) for TikTok, Reels, Shorts: 34ch column, text about 1.5x larger and centred, no key badge, captions per beat, loading frames at 3x, ends on the finished page. |
| `video/stilura-4x5.mp4` | Same cut at 1080x1350 for X and feeds. |
| `video/stilura-hook-12s.mp4` | 12 s, 4:5: just the slop paragraph becoming the clean line. |
| `video/thumb.png` | 1280x720 before/after thumbnail made from demo frames. |
| `video/scripts.md` | Five more 15-25 s "Slop in, sentence out" shots to record in the real app (corporate blog post, cover letter, README, product description, email), with recording rules. |
| `video/render-narrow.mjs` | Renders `artifact/demo.html` in a narrow portrait window to /tmp (never touches `docs/demo.*`). |
| `video/build-cutdowns.py` | Adds captions and speed-ups to those renders and writes the three cutdowns. |
| `assets/slop-bingo.svg`, `.png` | 1080x1080 AI slop bingo card with the `npx stilura` footer. |
| `assets/before-after.png` | 1200x675 card for X link posts. |
| `assets/ph-before-after.png` | 1270x760 version for the Product Hunt gallery. |
| `assets/og-image.png` | 1280x640 GitHub social preview. |
| `outreach.md` | 15 targets (awesome lists, newsletters, people) with URL, fit, the ask and a drafted message. |
| `readme-suggestions.md` | Proposed README, About and topics changes. The description and topic changes were applied on 2026-11-15; the README edits are still proposals. |

## Still to do by hand

- **GitHub social preview.** Settings → General → Social preview → upload `assets/og-image.png` (1280x640). There's no API for it, and the built-in browser wasn't signed in to GitHub, so it wasn't done.
- Reword each draft before posting and settle every `[confirm]`.
- r/ClaudeAI: the "what worked / what you redid by hand" sentence, Pro vs Max, and whether the commit trailers are Claude Code sessions.
- Show HN: your answer to "why not an Obsidian plugin?".
- Day 7 X post in `calendar.md`: paste the Product Hunt link once the launch is scheduled.
- Reddit rules: read each sub's rules yourself on posting day (checklist in `calendar.md`); Reddit blocked every automated read.

## Regenerating the videos

```bash
node docs/marketing/video/render-narrow.mjs 9x16
node docs/marketing/video/render-narrow.mjs 4x5
python3 docs/marketing/video/build-cutdowns.py
```

Needs Google Chrome, ffmpeg and Node 20+. `FFMPEG=/opt/homebrew/bin/ffmpeg` if ffmpeg isn't on PATH.
